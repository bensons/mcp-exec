/**
 * Terminal Viewer Service - HTTP/WebSocket server for terminal viewing
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import {
  TerminalViewerConfig,
  TerminalSession,
  TerminalViewerStatus,
  TerminalViewerSession,
  WebSocketMessage
} from './types';
import { appendToBuffer, bufferText } from './buffer';

export class TerminalViewerService {
  private static readonly AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
  private static readonly AUTH_FAILURE_LIMIT = 20;
  private static readonly MAX_TRACKED_WEBSOCKET_CLIENTS = 10_000;

  private app: express.Application;
  private server?: HttpServer;
  private wss?: WebSocketServer;
  private config: TerminalViewerConfig;
  private sessions: Map<string, TerminalSession>;
  private connections: Map<string, WebSocket>;
  private sessionListeners: Map<string, Array<{ dispose(): void }>>;
  private isRunning: boolean = false;
  private startTime?: Date;
  private websocketAuthFailures: Map<string, { count: number; resetAt: number }> = new Map();
  private lastWebSocketAuthPrune: number = Date.now();

  constructor(config: TerminalViewerConfig) {
    // Keep live authorization state isolated from callers mutating the source config object.
    this.config = { ...config };
    this.sessions = new Map();
    this.connections = new Map();
    this.sessionListeners = new Map();
    this.app = express();
    this.setupRoutes();
  }

  /** Constant-time token comparison; false unless a token is configured. */
  private tokenMatches(provided: unknown): boolean {
    const expected = this.config.authToken;
    if (!expected || typeof provided !== 'string' || provided.length === 0) {
      return false;
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Accepts `Authorization: Bearer <token>` or `?token=<token>`. */
  private isAuthorized(authHeader: unknown, queryToken: unknown): boolean {
    if (!this.config.enableAuth) {
      return true;
    }
    const bearer = this.parseBearerToken(authHeader);
    return this.tokenMatches(bearer) || this.tokenMatches(queryToken);
  }

  /** Parse the fixed Bearer prefix in linear time without a backtracking expression. */
  private parseBearerToken(authHeader: unknown): string | undefined {
    if (typeof authHeader !== 'string' || authHeader.length <= 7) {
      return undefined;
    }
    return authHeader.slice(0, 7).toLowerCase() === 'bearer '
      ? authHeader.slice(7)
      : undefined;
  }

  /** `?token=...` suffix for generated URLs, empty when auth is off. */
  private tokenQuery(): string {
    return this.config.enableAuth && this.config.authToken
      ? `?token=${encodeURIComponent(this.config.authToken)}`
      : '';
  }

  private sessionUrl(sessionId: string): string {
    return `http://${this.config.host}:${this.config.port}/terminal/${sessionId}/view${this.tokenQuery()}`;
  }

  private static isLoopbackHost(host: string): boolean {
    return /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|::ffff:127(?:\.\d{1,3}){3})$/i.test(host);
  }

  /** Reject configurations that would expose an unauthenticated viewer externally. */
  static assertSafeConfiguration(config: Pick<TerminalViewerConfig, 'host' | 'enableAuth'>): void {
    if (typeof config.host !== 'string' || config.host.length === 0) {
      throw new Error('Terminal viewer host must be a non-empty string');
    }
    if (config.enableAuth !== true && !TerminalViewerService.isLoopbackHost(config.host)) {
      throw new Error(
        `Refusing to run terminal viewer on non-loopback host "${config.host}" without authentication. ` +
        `Set enableAuth: true (MCP_EXEC_TERMINAL_VIEWER_ENABLE_AUTH=true) or bind to 127.0.0.1.`
      );
    }
  }

  /** Count failed WebSocket authentication attempts per peer and bound retained state. */
  private registerWebSocketAuthFailure(clientAddress: string): boolean {
    const now = Date.now();
    if (now - this.lastWebSocketAuthPrune >= TerminalViewerService.AUTH_RATE_LIMIT_WINDOW_MS) {
      for (const [address, entry] of this.websocketAuthFailures) {
        if (entry.resetAt <= now) {
          this.websocketAuthFailures.delete(address);
        }
      }
      this.lastWebSocketAuthPrune = now;
    }

    const existing = this.websocketAuthFailures.get(clientAddress);
    if (existing && existing.resetAt > now) {
      existing.count += 1;
      return existing.count > TerminalViewerService.AUTH_FAILURE_LIMIT;
    }

    if (
      !existing &&
      this.websocketAuthFailures.size >= TerminalViewerService.MAX_TRACKED_WEBSOCKET_CLIENTS
    ) {
      return true;
    }

    this.websocketAuthFailures.set(clientAddress, {
      count: 1,
      resetAt: now + TerminalViewerService.AUTH_RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }

  private setupRoutes(): void {
    // Authenticated pages contain connection credentials and must never enter shared caches.
    this.app.use((_req, res, next) => {
      if (this.config.enableAuth) {
        res.setHeader('Cache-Control', 'no-store');
      }
      next();
    });

    // Limit failed HTTP authentication attempts while leaving authorized viewer traffic alone.
    this.app.use(rateLimit({
      windowMs: TerminalViewerService.AUTH_RATE_LIMIT_WINDOW_MS,
      limit: TerminalViewerService.AUTH_FAILURE_LIMIT,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) => !this.config.enableAuth ||
        this.isAuthorized(req.headers.authorization, req.query.token),
      message: { error: 'Too many authentication attempts; try again later' },
    }));

    // Authentication gate — must be registered before every other route/handler
    this.app.use((req, res, next) => {
      if (this.isAuthorized(req.headers.authorization, req.query.token)) {
        return next();
      }
      res.status(401).json({ error: 'Unauthorized' });
    });

    // Serve static files from our terminal directory
    const staticPath = path.join(__dirname, 'static');
    this.app.use('/static', express.static(staticPath));

    // Serve xterm.js files from node_modules
    const nodeModulesPath = path.join(__dirname, '../../node_modules');
    this.app.use('/static/xterm.js', express.static(path.join(nodeModulesPath, '@xterm/xterm/lib/xterm.js')));
    this.app.use('/static/xterm.css', express.static(path.join(nodeModulesPath, '@xterm/xterm/css/xterm.css')));
    this.app.use('/static/addon-fit.js', express.static(path.join(nodeModulesPath, '@xterm/addon-fit/lib/addon-fit.js')));
    this.app.use('/static/addon-web-links.js', express.static(path.join(nodeModulesPath, '@xterm/addon-web-links/lib/addon-web-links.js')));

    // API routes
    this.app.get('/api/sessions', (req: any, res: any) => {
      const sessions = Array.from(this.sessions.values()).map(session => ({
        sessionId: session.sessionId,
        command: session.command,
        startTime: session.startTime,
        status: session.status,
        viewerCount: session.viewers.size,
        url: this.sessionUrl(session.sessionId)
      }));
      res.json({ sessions, total: sessions.length });
    });

    this.app.get('/api/sessions/:sessionId/status', (req: any, res: any) => {
      const session = this.sessions.get(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({
        sessionId: session.sessionId,
        command: session.command,
        status: session.status,
        startTime: session.startTime,
        lastActivity: session.lastActivity,
        viewerCount: session.viewers.size
      });
    });

    // Terminal viewer page
    this.app.get('/terminal/:sessionId/view', async (req: any, res: any) => {
      const sessionId = req.params.sessionId;
      const session = this.sessions.get(sessionId);

      if (!session) {
        return res.status(404).send('Session not found');
      }

      try {
        const htmlContent = await this.generateTerminalHTML(sessionId);
        res.send(htmlContent);
      } catch (error) {
        res.status(500).send('Error loading terminal viewer');
      }
    });

    // Health check
    this.app.get('/health', (req: any, res: any) => {
      res.json({
        status: 'healthy',
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
        sessions: this.sessions.size,
        connections: this.connections.size
      });
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private serializeForInlineScript(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return 'null';
    }
    return serialized
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  private async generateTerminalHTML(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const escapedSessionIdHtml = this.escapeHtml(sessionId);
    const escapedCommandHtml = this.escapeHtml(session.command);
    const escapedStatusHtml = this.escapeHtml(session.status);
    const escapedStartedHtml = this.escapeHtml(session.startTime.toLocaleString());
    const serializedSessionIdJs = this.serializeForInlineScript(sessionId);
    const serializedHostJs = this.serializeForInlineScript(this.config.host);
    const serializedPortJs = this.serializeForInlineScript(this.config.port);
    const serializedTokenJs = this.serializeForInlineScript(
      this.config.enableAuth ? this.config.authToken || '' : ''
    );
    // Static assets go through the same auth gate, so carry the token on their URLs too.
    const q = this.tokenQuery();

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terminal: ${escapedCommandHtml}</title>
    <link rel="stylesheet" href="/static/xterm.css${q}">
    <link rel="stylesheet" href="/static/styles.css${q}">
</head>
<body>
    <div class="terminal-container">
        <div class="terminal-header">
            <h1>Terminal Session: ${escapedCommandHtml}</h1>
            <div class="session-info">
                <span>Session ID: ${escapedSessionIdHtml}</span>
                <span>Status: <span id="status">${escapedStatusHtml}</span></span>
                <span>Started: ${escapedStartedHtml}</span>
            </div>
        </div>
        <div id="terminal"></div>
    </div>

    <script src="/static/xterm.js${q}"></script>
    <script src="/static/addon-fit.js${q}"></script>
    <script src="/static/addon-web-links.js${q}"></script>
    <script src="/static/terminal.js${q}"></script>
    <script>
        window.addEventListener('load', function() {
            console.log('[DEBUG] Window loaded, checking if initTerminal exists...');
            if (typeof initTerminal === 'function') {
                console.log('[DEBUG] initTerminal function found, calling it...');
                initTerminal(${serializedSessionIdJs}, ${serializedHostJs}, ${serializedPortJs}, ${serializedTokenJs});
            } else {
                console.error('[ERROR] initTerminal function not found!');
                alert('Error: initTerminal function not found. Check if terminal.js loaded correctly.');
            }
        });
    </script>
</body>
</html>`;
  }

  async start(): Promise<void> {
    // Debug logging to stderr to avoid JSON-RPC interference
    console.error(`[DEBUG] TerminalViewerService.start called, current isRunning: ${this.isRunning}`);

    if (this.isRunning) {
      throw new Error('Terminal viewer service is already running');
    }

    TerminalViewerService.assertSafeConfiguration(this.config);

    if (this.config.enableAuth && !this.config.authToken) {
      this.config.authToken = crypto.randomBytes(24).toString('base64url');
      console.error(`Terminal viewer auth token (generated): ${this.config.authToken}`);
    }

    console.error(`[DEBUG] Starting terminal viewer service on ${this.config.host}:${this.config.port}`);

    return new Promise((resolve, reject) => {
      this.server = createServer(this.app);

      // Setup WebSocket server
      this.wss = new WebSocketServer({ server: this.server });
      this.setupWebSocketHandlers();
      console.error(`[DEBUG] WebSocket server and handlers set up`);

      this.server.listen(this.config.port, this.config.host, () => {
        this.isRunning = true;
        this.startTime = new Date();
        console.error(`Terminal viewer service started on http://${this.config.host}:${this.config.port}`);
        console.error(`[DEBUG] Terminal viewer service successfully started and running`);
        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    this.detachAllSessionListeners();

    if (!this.isRunning) {
      this.sessions.clear();
      return;
    }

    return new Promise((resolve) => {
      // Close all WebSocket connections
      this.connections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
      this.connections.clear();
      this.sessions.forEach(session => session.viewers.clear());
      this.sessions.clear();
      this.websocketAuthFailures.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
      }

      // Close HTTP server
      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          this.startTime = undefined;
          console.error('Terminal viewer service stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      if (!this.isAuthorized(req.headers.authorization, url.searchParams.get('token'))) {
        const clientAddress = req.socket.remoteAddress || 'unknown';
        const rateLimited = this.registerWebSocketAuthFailure(clientAddress);
        ws.close(
          rateLimited ? 1013 : 1008,
          rateLimited ? 'Too many authentication attempts' : 'Unauthorized'
        );
        return;
      }

      const sessionId = url.pathname.split('/').pop();

      if (!sessionId || !this.sessions.has(sessionId)) {
        ws.close(1008, 'Invalid session ID');
        return;
      }

      const connectionId = uuidv4();
      this.connections.set(connectionId, ws);

      const session = this.sessions.get(sessionId)!;
      session.viewers.add(connectionId);

      // Send initial buffer content
      this.sendBufferToConnection(ws, session);

      ws.on('message', (data) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          this.handleWebSocketMessage(connectionId, sessionId, message);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        this.connections.delete(connectionId);
        session.viewers.delete(connectionId);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.connections.delete(connectionId);
        session.viewers.delete(connectionId);
      });
    });
  }

  private sendBufferToConnection(ws: WebSocket, session: TerminalSession): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    // Replay the whole scrollback as a single write - xterm.js handles arbitrary
    // sizes, and splitting it per line would break partial lines (prompts,
    // progress bars) that never had a newline of their own.
    const timestamp = new Date();
    const data = bufferText(session.buffer);
    const messages: WebSocketMessage[] = [];
    if (data) {
      messages.push({ type: 'data', sessionId: session.sessionId, data, timestamp });
    }
    messages.push({ type: 'status', sessionId: session.sessionId, status: session.status, timestamp });

    for (const message of messages) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending buffer websocket message:', error);
        return;
      }
    }
  }

  private handleWebSocketMessage(connectionId: string, sessionId: string, message: WebSocketMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    switch (message.type) {
      case 'resize': {
        if (!message.size || !session.pty) {
          break;
        }
        const { cols, rows } = message.size;
        if (
          !Number.isInteger(cols) || cols < 1 || cols > 500 ||
          !Number.isInteger(rows) || rows < 1 || rows > 300
        ) {
          console.error(`Ignoring out-of-range terminal resize: ${cols}x${rows}`);
          break;
        }
        session.pty.resize(cols, rows);
        break;
      }
      default:
        console.error('Unknown WebSocket message type:', message.type);
    }
  }

  // Public methods for session management
  addSession(session: TerminalSession): void {
    console.error(`[DEBUG] TerminalViewerService.addSession called for session: ${session.sessionId}`);
    this.detachSessionListeners(session.sessionId);
    this.sessions.set(session.sessionId, session);
    console.error(`[DEBUG] Session ${session.sessionId} added to terminal viewer, total sessions: ${this.sessions.size}`);

    // Set up PTY data handlers if available
    if (session.pty) {
      const listeners = [session.pty.onData((data: string) => {
        // Immediately broadcast data to prevent buffering delays
        this.broadcastToSession(session.sessionId, data);
        // Add to buffer for new connections
        appendToBuffer(session.buffer, data);
        session.lastActivity = new Date();
      })];

      // Handle process exit - PTY onExit receives (exitCode, signal) as separate parameters
      listeners.push(session.pty.onExit((exitCode: any, signal?: any) => {
        console.error(`[DEBUG] PTY process exited in viewer service for session ${session.sessionId}:`);
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
        // Start the finished-session grace period from process exit, not from
        // the last input/output activity. Quiet, long-running sessions may
        // otherwise be eligible for cleanup as soon as they exit.
        session.lastActivity = new Date();
        this.broadcastStatusToSession(session.sessionId, session.status);
      }));

      this.sessionListeners.set(
        session.sessionId,
        listeners.filter((listener): listener is { dispose(): void } =>
          !!listener && typeof listener.dispose === 'function'
        )
      );
    }
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Close all viewers for this session
      session.viewers.forEach(connectionId => {
        const ws = this.connections.get(connectionId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
      this.detachSessionListeners(sessionId);
      this.sessions.delete(sessionId);
    }
  }

  private detachSessionListeners(sessionId: string): void {
    const listeners = this.sessionListeners.get(sessionId) || [];
    for (const listener of listeners) {
      listener.dispose();
    }
    this.sessionListeners.delete(sessionId);
  }

  private detachAllSessionListeners(): void {
    for (const sessionId of this.sessionListeners.keys()) {
      this.detachSessionListeners(sessionId);
    }
  }

  // Check if a session exists in the viewer service
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  // Method to send input to a terminal session
  sendInput(sessionId: string, input: string, addNewline: boolean = true): void {
    console.error(`[DEBUG] TerminalViewerService.sendInput called: sessionId=${sessionId}, input="${input}", addNewline=${addNewline}`);

    const session = this.sessions.get(sessionId);
    if (!session || !session.pty) {
      console.error(`[DEBUG] Session ${sessionId} not found or has no PTY. Available sessions: ${Array.from(this.sessions.keys()).join(', ')}`);
      throw new Error(`Session ${sessionId} not found or has no PTY`);
    }

    if (session.status !== 'running') {
      throw new Error(`Session ${sessionId} is not running (status: ${session.status})`);
    }

    console.error(`[DEBUG] Session found, sending input to PTY: "${input}"`);

    // Send input to PTY - writing to a PTY whose child already exited throws (EIO/EPIPE),
    // so translate it into a normal tool error instead of letting it escape.
    const inputToSend = addNewline ? input + '\r' : input;
    try {
      session.pty.write(inputToSend);
    } catch (error) {
      throw new Error(
        `Failed to write to session ${sessionId} PTY: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    console.error(`[DEBUG] Input sent to PTY: "${inputToSend}"`);

    // Don't manually add to buffer or broadcast - let PTY echo handle display to avoid duplication
    session.lastActivity = new Date();
  }

  private broadcastToSession(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const message: WebSocketMessage = {
      type: 'data',
      sessionId,
      data,
      timestamp: new Date()
    };

    session.viewers.forEach(connectionId => {
      const ws = this.connections.get(connectionId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          console.error('Error sending websocket message:', error);
          // Remove broken connection
          this.connections.delete(connectionId);
          session.viewers.delete(connectionId);
        }
      }
    });
  }

  private broadcastStatusToSession(sessionId: string, status: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const message: WebSocketMessage = {
      type: 'status',
      sessionId,
      status,
      timestamp: new Date()
    };

    session.viewers.forEach(connectionId => {
      const ws = this.connections.get(connectionId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          console.error('Error sending status websocket message:', error);
          // Remove broken connection
          this.connections.delete(connectionId);
          session.viewers.delete(connectionId);
        }
      }
    });
  }

  getStatus(): TerminalViewerStatus {
    const activeSessions: TerminalViewerSession[] = Array.from(this.sessions.values()).map(session => ({
      sessionId: session.sessionId,
      url: this.sessionUrl(session.sessionId),
      command: session.command,
      startTime: session.startTime,
      status: session.status,
      viewerCount: session.viewers.size
    }));

    return {
      enabled: this.isRunning,
      port: this.isRunning ? this.config.port : undefined,
      host: this.isRunning ? this.config.host : undefined,
      activeSessions,
      totalSessions: this.sessions.size,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : undefined
    };
  }

  isEnabled(): boolean {
    return this.isRunning;
  }

  getSessionUrl(sessionId: string): string | null {
    if (!this.isRunning || !this.sessions.has(sessionId)) {
      return null;
    }
    return this.sessionUrl(sessionId);
  }
}
