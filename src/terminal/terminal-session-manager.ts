/**
 * Enhanced Terminal Session Manager with PTY support
 */

import { spawn as nodeSpawn, ChildProcess } from 'child_process';
import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { TerminalSession, TerminalBuffer } from './types';
import { InteractiveSessionManager, StartSessionOptions, SendInputOptions } from '../core/interactive-session-manager';
import { ServerConfig } from '../types/index';

export interface TerminalStartSessionOptions extends StartSessionOptions {
  enableTerminalViewer?: boolean;
  terminalSize?: { cols: number; rows: number };
}

export class TerminalSessionManager {
  private sessions: Map<string, TerminalSession>;
  private config: ServerConfig['sessions'];
  private terminalViewerConfig: ServerConfig['terminalViewer'];
  private cleanupInterval: NodeJS.Timeout;
  private fallbackSessionManager: InteractiveSessionManager;

  constructor(
    config: ServerConfig['sessions'], 
    terminalViewerConfig: ServerConfig['terminalViewer']
  ) {
    this.sessions = new Map();
    this.config = config;
    this.terminalViewerConfig = terminalViewerConfig;
    this.fallbackSessionManager = new InteractiveSessionManager(config);
    
    // Set up periodic cleanup of expired sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Check every minute
  }

  async startSession(options: TerminalStartSessionOptions): Promise<string> {
    console.error(`[DEBUG] TerminalSessionManager.startSession called with enableTerminalViewer: ${options.enableTerminalViewer}`);

    // If terminal viewer is not requested, use fallback
    if (!options.enableTerminalViewer) {
      console.error(`[DEBUG] Terminal viewer not requested, using fallback session manager`);
      return this.fallbackSessionManager.startSession(options);
    }

    console.error(`[DEBUG] Creating terminal session, current sessions: ${this.sessions.size}/${this.terminalViewerConfig.maxSessions}`);

    // Check session limit
    if (this.sessions.size >= this.terminalViewerConfig.maxSessions) {
      throw new Error(`Maximum number of terminal sessions (${this.terminalViewerConfig.maxSessions}) reached`);
    }

    const sessionId = uuidv4();
    const startTime = new Date();

    // Create PTY process
    const ptyProcess = this.createPtyProcess(options);

    // Create terminal session
    const session: TerminalSession = {
      sessionId,
      command: options.command,
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([_, value]) => value !== undefined)
        ) as Record<string, string>,
        ...options.env,
      },
      startTime,
      lastActivity: startTime,
      status: 'running',
      pty: ptyProcess,
      buffer: {
        lines: [],
        cursor: { x: 0, y: 0 },
        scrollback: 0,
        maxLines: this.terminalViewerConfig.bufferSize
      },
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

      // Send initial command if provided
      if (options.command) {
        const fullCommand = options.args && options.args.length > 0
          ? `${options.command} ${options.args.join(' ')}`
          : options.command;
        ptyProcess.write(fullCommand + '\r');
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
      this.addToBuffer(session, data, 'output');
      session.lastActivity = new Date();
    });

    // Handle process exit - PTY onExit receives (exitCode, signal) as separate parameters
    session.pty.onExit((exitCode: number, signal?: number) => {
      console.error(`[DEBUG] PTY process exited for session ${session.sessionId}:`);
      console.error(`[DEBUG]   exitCode: ${exitCode} (type: ${typeof exitCode})`);
      console.error(`[DEBUG]   signal: ${signal} (type: ${typeof signal})`);

      // Determine status based on exit conditions
      // Normal exit (code 0) or exit via common signals should be considered finished
      let newStatus: 'finished' | 'error';
      if (exitCode === 0) {
        newStatus = 'finished';
        console.error(`[DEBUG] Setting status to 'finished' - normal exit with code 0`);
      } else if (signal === 1 || signal === 2 || signal === 15) {
        // SIGHUP, SIGINT, SIGTERM - common termination signals that should be considered normal
        newStatus = 'finished';
        console.error(`[DEBUG] Setting status to 'finished' - terminated by signal ${signal}`);
      } else {
        newStatus = 'error';
        console.error(`[DEBUG] Setting status to 'error' - abnormal exit: code=${exitCode}, signal=${signal}`);
      }

      session.status = newStatus;
      session.lastActivity = new Date();

      console.error(`[DEBUG] Session ${session.sessionId} status updated to: ${newStatus}`);

      // Add a final message to the buffer indicating the session has ended
      this.addToBuffer(session, `\n[Session ended with exit code ${exitCode}${signal ? `, signal ${signal}` : ''}]`, 'output');
    });
  }

  private addToBuffer(session: TerminalSession, data: string, type: 'input' | 'output' | 'error'): void {
    // Split data into lines, preserving ANSI sequences
    const lines = data.split(/\r?\n/);
    
    lines.forEach((line, index) => {
      // Don't add empty lines except for the last one if it represents a newline
      if (line.length > 0 || (index === lines.length - 1 && data.endsWith('\n'))) {
        session.buffer.lines.push({
          text: line,
          timestamp: new Date(),
          type,
          ansiCodes: this.extractAnsiCodes(line)
        });
      }
    });

    // Limit buffer size
    if (session.buffer.lines.length > session.buffer.maxLines) {
      const excess = session.buffer.lines.length - session.buffer.maxLines;
      session.buffer.lines = session.buffer.lines.slice(excess);
      session.buffer.scrollback += excess;
    }
  }

  private extractAnsiCodes(text: string): string[] {
    const ansiRegex = /\x1b\[[0-9;]*m/g;
    return text.match(ansiRegex) || [];
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

    // Send input to PTY
    const input = options.addNewline !== false ? options.input + '\r' : options.input;
    session.pty.write(input);

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
  }

  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionInfo(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      command: session.command,
      status: session.status,
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      bufferLines: session.buffer.lines.length,
      recentOutput: session.buffer.lines.slice(-5).map(line => line.text).join('\n')
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
      
      if (timeSinceLastActivity > this.terminalViewerConfig.sessionTimeout) {
        expiredSessions.push(sessionId);
      }
    });

    expiredSessions.forEach(sessionId => {
      console.error(`Cleaning up expired terminal session: ${sessionId}`);
      this.killSession(sessionId);
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
