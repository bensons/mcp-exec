/**
 * Terminal Viewer Service - HTTP/WebSocket server for terminal viewing
 */

import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

import { 
  TerminalViewerConfig, 
  TerminalSession, 
  TerminalViewerStatus, 
  TerminalViewerSession,
  WebSocketMessage 
} from './types';

export class TerminalViewerService {
  private app: express.Application;
  private server?: HttpServer;
  private wss?: WebSocketServer;
  private config: TerminalViewerConfig;
  private sessions: Map<string, TerminalSession>;
  private connections: Map<string, WebSocket>;
  private isRunning: boolean = false;
  private startTime?: Date;

  constructor(config: TerminalViewerConfig) {
    this.config = config;
    this.sessions = new Map();
    this.connections = new Map();
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
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
        url: `http://${this.config.host}:${this.config.port}/terminal/${session.sessionId}/view`
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

  private async generateTerminalHTML(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terminal: ${session.command}</title>
    <link rel="stylesheet" href="/static/xterm.css">
    <link rel="stylesheet" href="/static/styles.css">
</head>
<body>
    <div class="terminal-container">
        <div class="terminal-header">
            <h1>Terminal Session: ${session.command}</h1>
            <div class="session-info">
                <span>Session ID: ${sessionId}</span>
                <span>Status: <span id="status">${session.status}</span></span>
                <span>Started: ${session.startTime.toLocaleString()}</span>
            </div>
        </div>
        <div id="terminal"></div>
    </div>
    
    <script src="/static/xterm.js"></script>
    <script src="/static/addon-fit.js"></script>
    <script src="/static/addon-web-links.js"></script>
    <script src="/static/terminal.js"></script>
    <script>
        window.addEventListener('load', function() {
            console.log('[DEBUG] Window loaded, checking if initTerminal exists...');
            if (typeof initTerminal === 'function') {
                console.log('[DEBUG] initTerminal function found, calling it...');
                initTerminal('${sessionId}', '${this.config.host}', ${this.config.port});
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
    if (!this.isRunning) {
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

    const sendBuffer = () => {
      // Send existing buffer content
      session.buffer.lines.forEach(line => {
        const message: WebSocketMessage = {
          type: 'data',
          sessionId: session.sessionId,
          data: line.text + '\r\n',
          timestamp: line.timestamp
        };
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          console.error('Error sending buffer websocket message:', error);
        }
      });
    };

    // Use process.nextTick to ensure immediate transmission and prevent buffering
    // unless explicitly disabled in config
    if (this.config.disableWebSocketBuffering !== false) {
      process.nextTick(sendBuffer);
    } else {
      sendBuffer();
    }
  }

  private handleWebSocketMessage(connectionId: string, sessionId: string, message: WebSocketMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    switch (message.type) {
      case 'resize':
        if (message.size && session.pty) {
          session.pty.resize(message.size.cols, message.size.rows);
        }
        break;
      default:
        console.error('Unknown WebSocket message type:', message.type);
    }
  }

  // Public methods for session management
  addSession(session: TerminalSession): void {
    console.error(`[DEBUG] TerminalViewerService.addSession called for session: ${session.sessionId}`);
    this.sessions.set(session.sessionId, session);
    console.error(`[DEBUG] Session ${session.sessionId} added to terminal viewer, total sessions: ${this.sessions.size}`);

    // Set up PTY data handlers if available
    if (session.pty) {
      session.pty.onData((data: string) => {
        // Immediately broadcast data to prevent buffering delays
        this.broadcastToSession(session.sessionId, data);
        // Add to buffer for new connections
        this.addToBuffer(session, data, 'output');
      });

      // Handle process exit - PTY onExit receives (exitCode, signal) as separate parameters
      session.pty.onExit((exitCode: any, signal?: any) => {
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
        this.broadcastStatusToSession(session.sessionId, session.status);
      });
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
      this.sessions.delete(sessionId);
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

    console.error(`[DEBUG] Session found, sending input to PTY: "${input}"`);

    // Send input to PTY
    const inputToSend = addNewline ? input + '\r' : input;
    session.pty.write(inputToSend);

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

    const sendMessage = () => {
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
    };

    // Use process.nextTick to ensure immediate transmission and prevent buffering
    // unless explicitly disabled in config
    if (this.config.disableWebSocketBuffering !== false) {
      process.nextTick(sendMessage);
    } else {
      sendMessage();
    }
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

    const sendMessage = () => {
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
    };

    // Use process.nextTick to ensure immediate transmission and prevent buffering
    // unless explicitly disabled in config
    if (this.config.disableWebSocketBuffering !== false) {
      process.nextTick(sendMessage);
    } else {
      sendMessage();
    }
  }

  private addToBuffer(session: TerminalSession, data: string, type: 'input' | 'output' | 'error'): void {
    const lines = data.split('\n');
    lines.forEach(line => {
      if (line.length > 0) {
        session.buffer.lines.push({
          text: line,
          timestamp: new Date(),
          type,
          ansiCodes: []
        });
      }
    });

    // Limit buffer size
    if (session.buffer.lines.length > session.buffer.maxLines) {
      session.buffer.lines = session.buffer.lines.slice(-session.buffer.maxLines);
    }

    session.lastActivity = new Date();
  }

  getStatus(): TerminalViewerStatus {
    const activeSessions: TerminalViewerSession[] = Array.from(this.sessions.values()).map(session => ({
      sessionId: session.sessionId,
      url: `http://${this.config.host}:${this.config.port}/terminal/${session.sessionId}/view`,
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
    return `http://${this.config.host}:${this.config.port}/terminal/${sessionId}/view`;
  }
}
