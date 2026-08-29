/**
 * Interactive Session Manager for handling long-running interactive processes
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { Writable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import {
  InteractiveSession,
  SessionOutput,
  SessionInfo,
  SessionOutputBuffer,
  ServerConfig,
} from '../types/index';
import { CommandGuard, buildFullCommand } from '../security/command-policy';
import { resolveShellOption } from './shell-option';

export interface StartSessionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean | string;
  aiContext?: string;
  /** Set when the command was already approved via confirm_command. */
  skipConfirmation?: boolean;
}

export interface SendInputOptions {
  sessionId: string;
  input: string;
  addNewline?: boolean;
  /** Set when the input was already approved via confirm_command. */
  skipConfirmation?: boolean;
}

/** How long a finished/errored session is kept around so its output can still be drained. */
export const FINISHED_SESSION_GRACE_MS = 5 * 60 * 1000;

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
    this.cleanupInterval.unref();
  }

  /**
   * Swap in a new sessions config without recreating the manager (which would
   * orphan every running child process). Limits/timeouts are read at call time.
   */
  updateConfig(config: ServerConfig['sessions']): void {
    this.config = config;
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
      await this.commandGuard(buildFullCommand(options.command, options.args), {
        skipConfirmation: options.skipConfirmation,
        cwd,
        env: environment,
      });
    }

    // Check session limit - only sessions that are still running occupy a slot
    if (this.countRunningSessions() >= this.config.maxInteractiveSessions) {
      throw new Error(`Maximum number of interactive sessions (${this.config.maxInteractiveSessions}) reached`);
    }

    // shell: true/undefined -> platform default shell, false -> no shell at all,
    // string -> the requested shell executable resolved in the child context.
    const shell = resolveShellOption(options.shell, {
      cwd,
      env: environment,
    });

    // A custom shell can execute arbitrary behavior before the requested command,
    // so it must pass the same policy as the command itself.
    if (this.commandGuard && typeof shell === 'string') {
      await this.commandGuard(shell, {
        skipConfirmation: options.skipConfirmation,
        cwd,
        env: environment,
      });
    }

    const sessionId = uuidv4();
    const startTime = new Date();

    const childProcess = spawn(options.command, options.args || [], {
      cwd,
      env: environment,
      shell,
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
    const session = this.sessions.get(options.sessionId);
    if (!session) {
      throw new Error(`Session ${options.sessionId} not found`);
    }

    if (session.status !== 'running') {
      throw new Error(`Session ${options.sessionId} is not running (status: ${session.status})`);
    }

    const resultingCwd = this.commandGuard
      ? await this.commandGuard(options.input, {
          skipConfirmation: options.skipConfirmation,
          cwd: session.cwd,
          env: session.env,
        })
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

    // Return the raw buffers verbatim; splitting/joining here corrupts output
    const stdout = this.consumeBuffer(session.outputBuffer);
    const stderr = this.consumeBuffer(session.errorBuffer);
    const droppedBytes = session.droppedBytes;

    // The raw buffers were cleared by consumeBuffer; reset loss accounting too.
    session.droppedBytes = 0;

    // The process is gone and its output has now been handed over: drop the session
    // so it stops occupying a slot and holding on to its buffers.
    if (session.status !== 'running') {
      this.sessions.delete(sessionId);
    }

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

  countRunningSessions(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.status === 'running') {
        count++;
      }
    }
    return count;
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

    // Handle stdin errors (EPIPE when the child closed its stdin or already exited).
    // Without a listener Node rethrows these as uncaught exceptions, which crashes the server.
    childProcess.stdin?.on('error', (error: Error) => {
      session.status = 'error';
      session.droppedBytes += this.appendCapped(
        session.errorBuffer,
        `stdin error: ${error.message}\n`
      );
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
      // Finished sessions are reaped after a short grace period, independent of sessionTimeout
      const maxIdle = session.status === 'running'
        ? this.config.sessionTimeout
        : Math.min(this.config.sessionTimeout, FINISHED_SESSION_GRACE_MS);

      if (timeSinceActivity > maxIdle) {
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
