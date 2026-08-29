/**
 * Enhanced Terminal Session Manager with PTY support
 */

import { spawn as nodeSpawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { TerminalSession, TerminalBuffer } from './types';
import { createTerminalBuffer, appendToBuffer, bufferLines, resizeTerminalBuffer } from './buffer';
import { InteractiveSessionManager, StartSessionOptions, SendInputOptions, FINISHED_SESSION_GRACE_MS } from '../core/interactive-session-manager';
import { ServerConfig } from '../types/index';
import { CommandGuard, buildFullCommand } from '../security/command-policy';

export interface TerminalStartSessionOptions extends Omit<StartSessionOptions, 'command'> {
  command?: string; // Optional for terminal sessions - defaults to system shell
  enableTerminalViewer?: boolean;
  terminalSize?: { cols: number; rows: number };
}

export class TerminalSessionManager {
  private sessions: Map<string, TerminalSession>;
  private config: ServerConfig['sessions'];
  private terminalViewerConfig: ServerConfig['terminalViewer'];
  private cleanupInterval: NodeJS.Timeout;
  private fallbackSessionManager: InteractiveSessionManager;
  private commandGuard?: CommandGuard;
  private sessionRemovedHandler?: (sessionId: string) => void;

  constructor(
    config: ServerConfig['sessions'], 
    terminalViewerConfig: ServerConfig['terminalViewer'],
    commandGuard?: CommandGuard
  ) {
    this.sessions = new Map();
    this.config = config;
    this.terminalViewerConfig = terminalViewerConfig;
    this.commandGuard = commandGuard;
    this.fallbackSessionManager = new InteractiveSessionManager(config, commandGuard);
    
    // Set up periodic cleanup of expired sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Check every minute
    this.cleanupInterval.unref();
  }

  /**
   * Swap in new config without recreating the manager (which would orphan every
   * running PTY / child process). Limits/timeouts are read at call time.
   */
  updateConfig(
    config: ServerConfig['sessions'],
    terminalViewerConfig: ServerConfig['terminalViewer']
  ): void {
    this.config = config;
    this.terminalViewerConfig = terminalViewerConfig;
    this.fallbackSessionManager.updateConfig(config);

    for (const session of this.sessions.values()) {
      resizeTerminalBuffer(session.buffer, terminalViewerConfig.bufferSize);
    }
  }

  /**
   * Register a callback invoked whenever a terminal session is removed from this manager
   * (kill, terminate or sweep). Used to keep the terminal viewer service in sync.
   */
  onSessionRemoved(handler: (sessionId: string) => void): void {
    this.sessionRemovedHandler = handler;
  }

  async startSession(options: TerminalStartSessionOptions): Promise<string> {
    console.error(`[DEBUG] TerminalSessionManager.startSession called with enableTerminalViewer: ${options.enableTerminalViewer}`);

    const cwd = path.resolve(options.cwd || process.cwd());
    const environment: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([_, value]) => value !== undefined)
      ) as Record<string, string>,
      ...options.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };
    const normalizedOptions = { ...options, cwd, env: environment };

    if (this.commandGuard) {
      await this.commandGuard(
        buildFullCommand(options.command, options.args),
        {
          skipConfirmation: options.skipConfirmation,
          cwd,
          env: environment,
        }
      );
    }

    // If terminal viewer is not requested, use fallback
    if (!options.enableTerminalViewer) {
      console.error(`[DEBUG] Terminal viewer not requested, using fallback session manager`);
      // Ensure command is provided for fallback session manager
      const fallbackOptions: StartSessionOptions = {
        ...normalizedOptions,
        command: options.command || this.getShell()
      };
      return this.fallbackSessionManager.startSession(fallbackOptions);
    }

    console.error(`[DEBUG] Creating terminal session, current sessions: ${this.sessions.size}/${this.terminalViewerConfig.maxSessions}`);

    // Check session limit - only sessions that are still running occupy a slot
    if (this.countRunningSessions() >= this.terminalViewerConfig.maxSessions) {
      throw new Error(`Maximum number of terminal sessions (${this.terminalViewerConfig.maxSessions}) reached`);
    }

    const sessionId = uuidv4();
    const startTime = new Date();

    // Create PTY process
    const ptyProcess = this.createPtyProcess(normalizedOptions);

    // Create terminal session
    const session: TerminalSession = {
      sessionId,
      command: options.command || 'system shell',
      args: options.args || [],
      cwd,
      env: environment,
      startTime,
      lastActivity: startTime,
      status: 'running',
      pty: ptyProcess,
      buffer: createTerminalBuffer(this.terminalViewerConfig.bufferSize),
      viewers: new Set(),
      aiContext: options.aiContext,
    };

    // Set up PTY event handlers only if not using terminal viewer
    // The TerminalViewerService will set up its own handlers when the session is added
    if (!options.enableTerminalViewer) {
      this.setupPtyHandlers(session);
      console.error(`[DEBUG] PTY handlers set up for session ${sessionId}`);
    } else {
      console.error(`[DEBUG] Skipping PTY handler setup for session ${sessionId} - will be handled by TerminalViewerService`);
    }

    // Store session
    this.sessions.set(sessionId, session);
    console.error(`[DEBUG] Terminal session ${sessionId} created and stored, total sessions: ${this.sessions.size}`);

    return sessionId;
  }

  private createPtyProcess(options: TerminalStartSessionOptions): any {
    const shell = this.getShell();
    const size = options.terminalSize || { cols: 80, rows: 24 };

    console.error(`[DEBUG] Creating PTY with shell: ${shell}`);
    
    // Prepare environment
    const environment = {
      ...process.env,
      ...options.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };

    try {
      // Create PTY process
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: size.cols,
        rows: size.rows,
        cwd: options.cwd || process.cwd(),
        env: environment,
        encoding: 'utf8',
      });

      console.error(`[DEBUG] PTY process created successfully with PID: ${ptyProcess.pid}`);

      // Send initial command if provided
      if (options.command) {
        const fullCommand = options.args && options.args.length > 0
          ? `${options.command} ${options.args.join(' ')}`
          : options.command;
        console.error(`[DEBUG] Sending initial command to PTY: "${fullCommand}"`);
        ptyProcess.write(fullCommand + '\r');
      } else {
        console.error(`[DEBUG] No initial command provided, PTY will start with default shell`);
      }

      return ptyProcess;
    } catch (error) {
      console.error('Failed to create PTY process:', error);
      throw new Error(`Failed to create terminal session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private getShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    } else {
      return process.env.SHELL || '/bin/bash';
    }
  }

  private setupPtyHandlers(session: TerminalSession): void {
    if (!session.pty) return;

    // Handle data output
    session.pty.onData((data: string) => {
      appendToBuffer(session.buffer, data);
      session.lastActivity = new Date();
    });

    // Handle process exit - PTY onExit receives (exitCode, signal) as separate parameters
    session.pty.onExit((exitCode: any, signal?: any) => {
      console.error(`[DEBUG] PTY process exited for session ${session.sessionId}:`);
      console.error(`[DEBUG]   exitCode: ${JSON.stringify(exitCode)} (type: ${typeof exitCode})`);
      console.error(`[DEBUG]   signal: ${JSON.stringify(signal)} (type: ${typeof signal})`);

      // Extract numeric exit code if exitCode is an object
      let numericExitCode: number;
      if (typeof exitCode === 'object' && exitCode !== null) {
        // Handle case where exitCode might be an object with a code property
        numericExitCode = exitCode.code || exitCode.exitCode || 0;
      } else {
        numericExitCode = Number(exitCode) || 0;
      }

      console.error(`[DEBUG]   numeric exit code: ${numericExitCode}`);

      // Determine status based on exit conditions
      // Normal exit (code 0) or exit via common signals should be considered finished
      let newStatus: 'finished' | 'error';
      if (numericExitCode === 0) {
        newStatus = 'finished';
        console.error(`[DEBUG] Setting status to 'finished' - normal exit with code 0`);
      } else if (signal === 1 || signal === 2 || signal === 15) {
        // SIGHUP, SIGINT, SIGTERM - common termination signals that should be considered normal
        newStatus = 'finished';
        console.error(`[DEBUG] Setting status to 'finished' - terminated by signal ${signal}`);
      } else {
        newStatus = 'error';
        console.error(`[DEBUG] Setting status to 'error' - abnormal exit: code=${numericExitCode}, signal=${signal}`);
      }

      session.status = newStatus;
      session.lastActivity = new Date();

      console.error(`[DEBUG] Session ${session.sessionId} status updated to: ${newStatus}`);

      // Add a final message to the buffer indicating the session has ended
      appendToBuffer(session.buffer, `\r\n[Session ended with exit code ${numericExitCode}${signal ? `, signal ${JSON.stringify(signal)}` : ''}]\r\n`);
    });
  }

  async sendInput(options: SendInputOptions): Promise<void> {
    console.error(`[DEBUG] TerminalSessionManager.sendInput called for session ${options.sessionId}`);

    const session = this.sessions.get(options.sessionId);

    if (!session) {
      console.error(`[DEBUG] Session ${options.sessionId} not found in terminal sessions, trying fallback manager`);
      // Try fallback session manager
      return this.fallbackSessionManager.sendInput(options);
    }

    console.error(`[DEBUG] Found terminal session ${options.sessionId}, status: ${session.status}`);

    if (session.status !== 'running') {
      throw new Error(`Session ${options.sessionId} is not running (status: ${session.status})`);
    }

    if (!session.pty) {
      throw new Error(`Session ${options.sessionId} does not have a PTY`);
    }

    const resultingCwd = this.commandGuard
      ? await this.commandGuard(options.input, {
          skipConfirmation: options.skipConfirmation,
          cwd: session.cwd,
          env: session.env,
        })
      : undefined;

    // Send input to PTY - writing to a PTY whose child already exited throws (EIO/EPIPE),
    // so translate it into a normal tool error instead of letting it escape.
    const input = options.addNewline !== false ? options.input + '\r' : options.input;
    try {
      session.pty.write(input);
    } catch (error) {
      throw new Error(
        `Failed to write to session ${options.sessionId} PTY: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (resultingCwd && options.addNewline !== false) {
      session.cwd = resultingCwd;
      session.env.PWD = resultingCwd;
    }

    // Don't manually add to buffer - let PTY echo handle display to avoid duplication
    session.lastActivity = new Date();
  }

  async killSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      // Try fallback session manager
      return this.fallbackSessionManager.killSession(sessionId);
    }

    if (session.pty && session.status === 'running') {
      try {
        session.pty.kill();
      } catch (error) {
        console.error('Error killing PTY process:', error);
      }
    }

    // Remove from active sessions
    this.sessions.delete(sessionId);
    this.sessionRemovedHandler?.(sessionId);
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

  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  getTerminalSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  getSessionInfo(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const lines = bufferLines(session.buffer);

    return {
      sessionId: session.sessionId,
      command: session.command,
      status: session.status,
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      bufferLines: lines.length,
      recentOutput: lines.slice(-5).join('\n')
    };
  }

  listSessions(): Array<{
    sessionId: string;
    command: string;
    startTime: Date;
    lastActivity: Date;
    status: 'running' | 'finished' | 'error';
    cwd: string;
    aiContext?: string;
    hasTerminalViewer: boolean;
  }> {
    const terminalSessions = Array.from(this.sessions.values()).map(session => ({
      sessionId: session.sessionId,
      command: session.command,
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      status: session.status,
      cwd: session.cwd,
      aiContext: session.aiContext,
      hasTerminalViewer: true,
    }));

    const fallbackSessions = this.fallbackSessionManager.listSessions().map(session => ({
      ...session,
      hasTerminalViewer: false,
    }));

    return [...terminalSessions, ...fallbackSessions];
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    const expiredSessions: string[] = [];

    this.sessions.forEach((session, sessionId) => {
      const timeSinceLastActivity = now.getTime() - session.lastActivity.getTime();
      // Finished sessions are reaped after a short grace period, independent of sessionTimeout
      const maxIdle = session.status === 'running'
        ? this.terminalViewerConfig.sessionTimeout
        : Math.min(this.terminalViewerConfig.sessionTimeout, FINISHED_SESSION_GRACE_MS);

      if (timeSinceLastActivity > maxIdle) {
        expiredSessions.push(sessionId);
      }
    });

    expiredSessions.forEach(sessionId => {
      console.error(`Cleaning up expired terminal session: ${sessionId}`);
      this.killSession(sessionId).catch(error => {
        console.error(`Error cleaning up expired terminal session ${sessionId}:`, error);
      });
    });

    // Also cleanup fallback sessions
    this.fallbackSessionManager['cleanupExpiredSessions']?.();
  }

  async shutdown(): Promise<void> {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Kill all active sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.killSession(id)));

    // Shutdown fallback manager
    if (this.fallbackSessionManager['shutdown']) {
      await this.fallbackSessionManager['shutdown']();
    }
  }

  // Method to resize terminal
  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session && session.pty && session.status === 'running') {
      try {
        session.pty.resize(cols, rows);
      } catch (error) {
        console.error('Error resizing terminal:', error);
      }
    }
  }

  // Method to get terminal buffer for new viewers
  getTerminalBuffer(sessionId: string): TerminalBuffer | null {
    const session = this.sessions.get(sessionId);
    return session ? session.buffer : null;
  }
}
