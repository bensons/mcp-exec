/**
 * Interactive Session Manager for handling long-running interactive processes
 */

import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import {
  InteractiveSession,
  SessionOutput,
  SessionInfo,
  SessionOutputBuffer,
  ServerConfig,
} from '../types/index';
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
      outputBuffer: this.createOutputBuffer(),
      errorBuffer: this.createOutputBuffer(),
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
    const stdout = this.consumeBuffer(session.outputBuffer);
    const stderr = this.consumeBuffer(session.errorBuffer);
    const droppedBytes = session.droppedBytes;

    // The raw buffers were cleared by consumeBuffer; reset loss accounting too.
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
      session.droppedBytes += this.appendCapped(session.outputBuffer, chunk);
      session.lastActivity = new Date();
    });

    // Handle stderr data
    childProcess.stderr?.on('data', (chunk: string) => {
      session.droppedBytes += this.appendCapped(session.errorBuffer, chunk);
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
      session.droppedBytes += this.appendCapped(session.errorBuffer, `Process error: ${error.message}\n`);
      session.lastActivity = new Date();
    });
  }

  /**
   * Create an empty queue-backed buffer. Absolute byte offsets let appends track
   * capacity and line boundaries without re-encoding the retained output.
   */
  private createOutputBuffer(): SessionOutputBuffer {
    return {
      chunks: [],
      head: 0,
      headOffset: 0,
      startByte: 0,
      endByte: 0,
      lineBreaks: [],
      lineBreakHead: 0,
    };
  }

  /**
   * Append a chunk while keeping the retained output under `outputBufferBytes`.
   * Each append encodes and scans only the new chunk; queue removal is amortized
   * across chunks that are discarded. The return value is the number of bytes
   * dropped from the front.
   */
  private appendCapped(buffer: SessionOutputBuffer, chunk: string): number {
    const bytes = Buffer.from(chunk, 'utf8');
    if (bytes.length === 0) {
      return 0;
    }

    const chunkStart = buffer.endByte;
    buffer.chunks.push(bytes);
    buffer.endByte += bytes.length;

    // Store positions immediately after newlines so boundary lookup is O(new chunk).
    for (let newline = bytes.indexOf(0x0a); newline !== -1; newline = bytes.indexOf(0x0a, newline + 1)) {
      buffer.lineBreaks.push(chunkStart + newline + 1);
    }

    const configuredMax = this.config.outputBufferBytes;
    const maxBytes = Number.isFinite(configuredMax) && configuredMax > 0
      ? Math.floor(configuredMax)
      : 0;
    const retainedBytes = buffer.endByte - buffer.startByte;
    if (retainedBytes <= maxBytes) {
      return 0;
    }
    if (maxBytes === 0) {
      this.resetBuffer(buffer);
      return retainedBytes;
    }

    const minimumStart = buffer.endByte - maxBytes;
    while (
      buffer.lineBreakHead < buffer.lineBreaks.length &&
      buffer.lineBreaks[buffer.lineBreakHead] < minimumStart
    ) {
      buffer.lineBreakHead++;
    }

    const lineStart = buffer.lineBreaks[buffer.lineBreakHead];
    // A newline at the very end belongs to the oversized retained line. Dropping
    // through it would discard the newest output, so keep a code-point-safe tail.
    const useLineBoundary = lineStart !== undefined && lineStart < buffer.endByte;
    const requestedStart = useLineBoundary ? lineStart : minimumStart;
    const droppedBytes = this.dropBufferPrefix(buffer, requestedStart, !useLineBoundary);

    while (
      buffer.lineBreakHead < buffer.lineBreaks.length &&
      buffer.lineBreaks[buffer.lineBreakHead] <= buffer.startByte
    ) {
      buffer.lineBreakHead++;
    }
    this.compactBufferMetadata(buffer);
    return droppedBytes;
  }

  /** Drop through an absolute byte offset, optionally aligning to a UTF-8 boundary. */
  private dropBufferPrefix(
    buffer: SessionOutputBuffer,
    requestedStart: number,
    alignUtf8: boolean,
  ): number {
    const originalStart = buffer.startByte;
    let remaining = requestedStart - originalStart;
    let actualStart = requestedStart;

    while (remaining > 0 && buffer.head < buffer.chunks.length) {
      const headChunk = buffer.chunks[buffer.head];
      const available = headChunk.length - buffer.headOffset;
      if (remaining >= available) {
        remaining -= available;
        buffer.head++;
        buffer.headOffset = 0;
        continue;
      }

      let nextOffset = buffer.headOffset + remaining;
      if (alignUtf8) {
        while (
          nextOffset < headChunk.length &&
          (headChunk[nextOffset] & 0xc0) === 0x80
        ) {
          nextOffset++;
          actualStart++;
        }
      }
      buffer.headOffset = nextOffset;
      if (buffer.headOffset === headChunk.length) {
        buffer.head++;
        buffer.headOffset = 0;
      }
      remaining = 0;
    }

    buffer.startByte = actualStart;
    if (buffer.startByte >= buffer.endByte) {
      const droppedBytes = buffer.endByte - originalStart;
      this.resetBuffer(buffer);
      return droppedBytes;
    }
    return buffer.startByte - originalStart;
  }

  /** Join retained chunks only when a caller reads, then clear the queue. */
  private consumeBuffer(buffer: SessionOutputBuffer): string {
    const retainedBytes = buffer.endByte - buffer.startByte;
    if (retainedBytes === 0) {
      this.resetBuffer(buffer);
      return '';
    }

    const chunks = buffer.chunks.slice(buffer.head);
    chunks[0] = chunks[0].subarray(buffer.headOffset);
    const text = Buffer.concat(chunks, retainedBytes).toString('utf8');
    this.resetBuffer(buffer);
    return text;
  }

  private resetBuffer(buffer: SessionOutputBuffer): void {
    buffer.chunks = [];
    buffer.head = 0;
    buffer.headOffset = 0;
    buffer.startByte = 0;
    buffer.endByte = 0;
    buffer.lineBreaks = [];
    buffer.lineBreakHead = 0;
  }

  /** Periodically release consumed array slots while keeping appends amortized O(1). */
  private compactBufferMetadata(buffer: SessionOutputBuffer): void {
    if (buffer.head >= 64 && buffer.head * 2 >= buffer.chunks.length) {
      buffer.chunks = buffer.chunks.slice(buffer.head);
      buffer.head = 0;
    }
    if (
      buffer.lineBreakHead >= 64 &&
      buffer.lineBreakHead * 2 >= buffer.lineBreaks.length
    ) {
      buffer.lineBreaks = buffer.lineBreaks.slice(buffer.lineBreakHead);
      buffer.lineBreakHead = 0;
    }
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
