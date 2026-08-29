/**
 * Interactive Session Manager for handling long-running interactive processes
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { Writable } from 'stream';
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
    const cwd = path.resolve(options.cwd || process.cwd());
    const environment: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([_, value]) => value !== undefined)
      ) as Record<string, string>,
      ...options.env,
    };

    if (this.commandGuard) {
      await this.commandGuard(buildFullCommand(options.command, options.args), cwd, environment);
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
    const childProcess = spawn(execCommand, execArgs, {
      cwd,
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
      cwd,
      env: environment,
      status: 'running',
      outputBuffer: [],
      errorBuffer: [],
      aiContext: options.aiContext,
    };

    // Set up process event handlers
    this.setupProcessHandlers(session);

    // Store session
    this.sessions.set(sessionId, session);

    return sessionId;
  }

  async sendInput(options: SendInputOptions): Promise<void> {
    const session = this.sessions.get(options.sessionId);
    if (!session) {
      throw new Error(`Session ${options.sessionId} not found`);
    }

    if (session.status !== 'running') {
      throw new Error(`Session ${options.sessionId} is not running (status: ${session.status})`);
    }

    const resultingCwd = this.commandGuard
      ? await this.commandGuard(options.input, session.cwd, session.env)
      : undefined;

    // Writing to a child that closed (or never opened) its stdin raises EPIPE. Without this
    // guard + the 'error' listener in setupProcessHandlers it surfaces as an uncaught
    // exception and takes the whole server down.
    const stdin: Writable | null | undefined = session.process.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      throw new Error(`Session ${options.sessionId} stdin is closed`);
    }

    // Send input to the process
    const input = options.addNewline !== false ? options.input + '\n' : options.input;
    await new Promise<void>((resolve, reject) => {
      const settle = (error?: Error | null) => {
        clearTimeout(graceTimer);
        if (error) reject(error); else resolve();
      };
      // Use a bounded wait for the flush. A child that never reads its stdin can leave a
      // backpressured write pending forever, so we stop waiting after the grace period; a late
      // EPIPE still lands on the stdin 'error' handler and fails the next sendInput.
      const graceTimer = setTimeout(() => settle(), 50);
      stdin.write(input, settle);
    });
    if (resultingCwd && options.addNewline !== false) {
      session.cwd = resultingCwd;
      session.env.PWD = resultingCwd;
    }
    session.lastActivity = new Date();
  }

  async readOutput(sessionId: string): Promise<SessionOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Get buffered output
    const stdout = session.outputBuffer.join('\n');
    const stderr = session.errorBuffer.join('\n');

    // Clear buffers after reading
    session.outputBuffer = [];
    session.errorBuffer = [];

    return {
      sessionId,
      stdout,
      stderr,
      hasMore: session.status === 'running',
      status: session.status,
    };
  }

  async killSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Check liveness, not status: a stdin EPIPE flips status to 'error' while the child is
    // still alive, and keying off status would leak that process.
    const isAlive = () => session.process.exitCode === null && session.process.signalCode === null;

    if (isAlive()) {
      // Try graceful termination first
      session.process.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (isAlive()) {
          session.process.kill('SIGKILL');
        }
      }, 5000).unref();
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

    // Handle stdout data
    childProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      session.outputBuffer.push(...output.split('\n').filter(line => line.length > 0));
      session.lastActivity = new Date();

      // Limit buffer size
      if (session.outputBuffer.length > this.config.outputBufferSize) {
        session.outputBuffer = session.outputBuffer.slice(-this.config.outputBufferSize);
      }
    });

    // Handle stderr data
    childProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      session.errorBuffer.push(...output.split('\n').filter(line => line.length > 0));
      session.lastActivity = new Date();

      // Limit buffer size
      if (session.errorBuffer.length > this.config.outputBufferSize) {
        session.errorBuffer = session.errorBuffer.slice(-this.config.outputBufferSize);
      }
    });

    // Handle stdin errors (EPIPE when the child closed its stdin or already exited).
    // Without a listener Node rethrows these as uncaught exceptions, which crashes the server.
    childProcess.stdin?.on('error', (error: Error) => {
      session.status = 'error';
      session.errorBuffer.push(`stdin error: ${error.message}`);
      session.lastActivity = new Date();
    });

    // A child can exit while a descendant still holds its stdout/stderr pipes open. Keep the
    // session readable until 'close', which fires only after those streams have drained.
    childProcess.on('close', (code: number | null) => {
      session.status = code === 0 ? 'finished' : 'error';
      session.lastActivity = new Date();
    });

    // Handle process errors
    childProcess.on('error', (error: Error) => {
      session.status = 'error';
      session.errorBuffer.push(`Process error: ${error.message}`);
      session.lastActivity = new Date();
    });
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
