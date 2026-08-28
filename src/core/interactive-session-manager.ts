/**
 * Interactive Session Manager for handling long-running interactive processes
 */

import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { InteractiveSession, SessionOutput, SessionInfo, ServerConfig } from '../types/index';
import { CommandGuard, buildFullCommand } from '../security/command-policy';

export interface StartSessionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean | string;
  aiContext?: string;
}

export interface SendInputOptions {
  sessionId: string;
  input: string;
  addNewline?: boolean;
}

export class InteractiveSessionManager {
  private sessions: Map<string, InteractiveSession>;
  private config: ServerConfig['sessions'];
  private cleanupInterval: NodeJS.Timeout;
  private commandGuard?: CommandGuard;

  constructor(config: ServerConfig['sessions'], commandGuard?: CommandGuard) {
    this.sessions = new Map();
    this.config = config;
    this.commandGuard = commandGuard;
    
    // Set up periodic cleanup of expired sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Check every minute
  }

  async startSession(options: StartSessionOptions): Promise<string> {
    if (this.commandGuard) {
      await this.commandGuard(buildFullCommand(options.command, options.args));
    }

    // Check session limit
    if (this.sessions.size >= this.config.maxInteractiveSessions) {
      throw new Error(`Maximum number of interactive sessions (${this.config.maxInteractiveSessions}) reached`);
    }

    const sessionId = uuidv4();
    const startTime = new Date();

    // Determine execution method based on shell option
    let execCommand: string;
    let execArgs: string[];

    if (options.shell !== false) {
      // When shell=true or undefined, let Node.js handle the shell execution
      execCommand = options.command;
      execArgs = options.args || [];
    } else {
      // When shell=false, manually construct shell command
      if (process.platform === 'win32') {
        execCommand = 'cmd.exe';
        execArgs = ['/c', options.command, ...(options.args || [])];
      } else {
        execCommand = '/bin/sh';
        const fullCommand = options.args && options.args.length > 0 
          ? `${options.command} ${options.args.join(' ')}` 
          : options.command;
        execArgs = ['-c', fullCommand];
      }
    }

    // Spawn the process
    const environment: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([_, value]) => value !== undefined)
      ) as Record<string, string>,
      ...options.env,
    };

    const childProcess = spawn(execCommand, execArgs, {
      cwd: options.cwd || process.cwd(),
      env: environment,
      shell: options.shell !== false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Create session object
    const session: InteractiveSession = {
      sessionId,
      command: options.command,
      args: options.args || [],
      process: childProcess,
      startTime,
      lastActivity: startTime,
      cwd: options.cwd || process.cwd(),
      env: environment,
      status: 'running',
      outputBuffer: '',
      errorBuffer: '',
      droppedBytes: 0,
      aiContext: options.aiContext,
    };

    // Set up process event handlers
    this.setupProcessHandlers(session);

    // Store session
    this.sessions.set(sessionId, session);

    return sessionId;
  }

  async sendInput(options: SendInputOptions): Promise<void> {
    if (this.commandGuard) {
      await this.commandGuard(options.input);
    }

    const session = this.sessions.get(options.sessionId);
    if (!session) {
      throw new Error(`Session ${options.sessionId} not found`);
    }

    if (session.status !== 'running') {
      throw new Error(`Session ${options.sessionId} is not running (status: ${session.status})`);
    }

    // Send input to the process
    const input = options.addNewline !== false ? options.input + '\n' : options.input;
    session.process.stdin?.write(input);
    session.lastActivity = new Date();
  }

  async readOutput(sessionId: string): Promise<SessionOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Return the raw buffers verbatim; splitting/joining here corrupts output
    const stdout = session.outputBuffer;
    const stderr = session.errorBuffer;
    const droppedBytes = session.droppedBytes;

    // Clear buffers after reading
    session.outputBuffer = '';
    session.errorBuffer = '';
    session.droppedBytes = 0;

    return {
      sessionId,
      stdout,
      stderr,
      hasMore: session.status === 'running',
      status: session.status,
      droppedBytes,
    };
  }

  async killSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status === 'running') {
      // Try graceful termination first
      session.process.kill('SIGTERM');
      
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (session.status === 'running') {
          session.process.kill('SIGKILL');
        }
      }, 5000);
    }

    // Remove from active sessions
    this.sessions.delete(sessionId);
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(session => ({
      sessionId: session.sessionId,
      command: session.command,
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      status: session.status,
      cwd: session.cwd,
      aiContext: session.aiContext,
    }));
  }

  getSession(sessionId: string): InteractiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  private setupProcessHandlers(session: InteractiveSession): void {
    const { process: childProcess } = session;

    // Decode as UTF-8 so Node re-assembles code points split across chunks
    childProcess.stdout?.setEncoding('utf8');
    childProcess.stderr?.setEncoding('utf8');

    // Handle stdout data
    childProcess.stdout?.on('data', (chunk: string) => {
      session.outputBuffer = this.appendCapped(session, session.outputBuffer, chunk);
      session.lastActivity = new Date();
    });

    // Handle stderr data
    childProcess.stderr?.on('data', (chunk: string) => {
      session.errorBuffer = this.appendCapped(session, session.errorBuffer, chunk);
      session.lastActivity = new Date();
    });

    // Handle process exit
    childProcess.on('close', (code: number | null) => {
      session.status = code === 0 ? 'finished' : 'error';
      session.lastActivity = new Date();
    });

    // Handle process errors
    childProcess.on('error', (error: Error) => {
      session.status = 'error';
      session.errorBuffer = this.appendCapped(session, session.errorBuffer, `Process error: ${error.message}\n`);
      session.lastActivity = new Date();
    });
  }

  /**
   * Append a chunk to a raw output buffer, keeping it under `outputBufferBytes`.
   * Overflow is dropped from the front, preferring a line boundary and never
   * splitting a UTF-8 code point; dropped bytes are counted on the session.
   */
  private appendCapped(session: InteractiveSession, buffer: string, chunk: string): string {
    const text = buffer + chunk;
    const maxBytes = this.config.outputBufferBytes;
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
      return text;
    }

    const bytes = Buffer.from(text, 'utf8');
    let cut = bytes.length - maxBytes;
    const newline = bytes.indexOf(0x0a, cut); // \n is never part of a multi-byte sequence
    if (newline !== -1) {
      cut = newline + 1;
    } else {
      // Single oversized line: keep code points intact by skipping continuation bytes
      while (cut < bytes.length && (bytes[cut] & 0xc0) === 0x80) {
        cut++;
      }
    }

    session.droppedBytes += cut;
    return bytes.subarray(cut).toString('utf8');
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      const timeSinceActivity = now.getTime() - session.lastActivity.getTime();
      
      if (timeSinceActivity > this.config.sessionTimeout) {
        expiredSessions.push(sessionId);
      }
    }

    // Clean up expired sessions
    for (const sessionId of expiredSessions) {
      this.killSession(sessionId).catch(error => {
        console.error(`Error cleaning up expired session ${sessionId}:`, error);
      });
    }
  }

  async shutdown(): Promise<void> {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Kill all active sessions
    const killPromises = Array.from(this.sessions.keys()).map(sessionId => 
      this.killSession(sessionId).catch(error => {
        console.error(`Error killing session ${sessionId} during shutdown:`, error);
      })
    );

    await Promise.all(killPromises);
  }
}
