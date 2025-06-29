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
    // If terminal viewer is not requested, use fallback
    if (!options.enableTerminalViewer) {
      return this.fallbackSessionManager.startSession(options);
    }

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

    // Set up PTY event handlers
    this.setupPtyHandlers(session);

    // Store session
    this.sessions.set(sessionId, session);

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

    // Handle process exit
    session.pty.onExit((exitCode: { exitCode: number; signal?: number }) => {
      session.status = exitCode.exitCode === 0 ? 'finished' : 'error';
      session.lastActivity = new Date();
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
    const session = this.sessions.get(options.sessionId);
    
    if (!session) {
      // Try fallback session manager
      return this.fallbackSessionManager.sendInput(options);
    }

    if (session.status !== 'running') {
      throw new Error(`Session ${options.sessionId} is not running (status: ${session.status})`);
    }

    if (!session.pty) {
      throw new Error(`Session ${options.sessionId} does not have a PTY`);
    }

    // Send input to PTY
    const input = options.addNewline !== false ? options.input + '\r' : options.input;
    session.pty.write(input);
    
    // Add to buffer for display
    this.addToBuffer(session, options.input + (options.addNewline !== false ? '\n' : ''), 'input');
    
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
      console.log(`Cleaning up expired terminal session: ${sessionId}`);
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
