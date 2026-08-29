"use strict";
/**
 * Terminal Viewer Service - HTTP/WebSocket server for terminal viewing
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalViewerService = void 0;
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const http_1 = require("http");
const ws_1 = require("ws");
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const uuid_1 = require("uuid");
const buffer_1 = require("./buffer");
class TerminalViewerService {
    static AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
    static AUTH_FAILURE_LIMIT = 20;
    static MAX_TRACKED_WEBSOCKET_CLIENTS = 10_000;
    app;
    server;
    wss;
    config;
    sessions;
    connections;
    sessionListeners;
    isRunning = false;
    startTime;
    websocketAuthFailures = new Map();
    lastWebSocketAuthPrune = Date.now();
    constructor(config) {
        // Keep live authorization state isolated from callers mutating the source config object.
        this.config = { ...config };
        this.sessions = new Map();
        this.connections = new Map();
        this.sessionListeners = new Map();
        this.app = (0, express_1.default)();
        this.setupRoutes();
    }
    /** Constant-time token comparison; false unless a token is configured. */
    tokenMatches(provided) {
        const expected = this.config.authToken;
        if (!expected || typeof provided !== 'string' || provided.length === 0) {
            return false;
        }
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    /** Accepts `Authorization: Bearer <token>` or `?token=<token>`. */
    isAuthorized(authHeader, queryToken) {
        if (!this.config.enableAuth) {
            return true;
        }
        const bearer = this.parseBearerToken(authHeader);
        return this.tokenMatches(bearer) || this.tokenMatches(queryToken);
    }
    /** Parse the fixed Bearer prefix in linear time without a backtracking expression. */
    parseBearerToken(authHeader) {
        if (typeof authHeader !== 'string' || authHeader.length <= 7) {
            return undefined;
        }
        return authHeader.slice(0, 7).toLowerCase() === 'bearer '
            ? authHeader.slice(7)
            : undefined;
    }
    /** `?token=...` suffix for generated URLs, empty when auth is off. */
    tokenQuery() {
        return this.config.enableAuth && this.config.authToken
            ? `?token=${encodeURIComponent(this.config.authToken)}`
            : '';
    }
    sessionUrl(sessionId) {
        return `http://${this.config.host}:${this.config.port}/terminal/${sessionId}/view${this.tokenQuery()}`;
    }
    static isLoopbackHost(host) {
        return /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|::ffff:127(?:\.\d{1,3}){3})$/i.test(host);
    }
    /** Reject configurations that would expose an unauthenticated viewer externally. */
    static assertSafeConfiguration(config) {
        if (typeof config.host !== 'string' || config.host.length === 0) {
            throw new Error('Terminal viewer host must be a non-empty string');
        }
        if (config.enableAuth !== true && !TerminalViewerService.isLoopbackHost(config.host)) {
            throw new Error(`Refusing to run terminal viewer on non-loopback host "${config.host}" without authentication. ` +
                `Set enableAuth: true (MCP_EXEC_TERMINAL_VIEWER_ENABLE_AUTH=true) or bind to 127.0.0.1.`);
        }
    }
    /** Count failed WebSocket authentication attempts per peer and bound retained state. */
    registerWebSocketAuthFailure(clientAddress) {
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
        if (!existing &&
            this.websocketAuthFailures.size >= TerminalViewerService.MAX_TRACKED_WEBSOCKET_CLIENTS) {
            return true;
        }
        this.websocketAuthFailures.set(clientAddress, {
            count: 1,
            resetAt: now + TerminalViewerService.AUTH_RATE_LIMIT_WINDOW_MS,
        });
        return false;
    }
    setupRoutes() {
        // Authenticated pages contain connection credentials and must never enter shared caches.
        this.app.use((_req, res, next) => {
            if (this.config.enableAuth) {
                res.setHeader('Cache-Control', 'no-store');
            }
            next();
        });
        // Limit failed HTTP authentication attempts while leaving authorized viewer traffic alone.
        this.app.use((0, express_rate_limit_1.default)({
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
        this.app.use('/static', express_1.default.static(staticPath));
        // Serve xterm.js files from node_modules
        const nodeModulesPath = path.join(__dirname, '../../node_modules');
        this.app.use('/static/xterm.js', express_1.default.static(path.join(nodeModulesPath, '@xterm/xterm/lib/xterm.js')));
        this.app.use('/static/xterm.css', express_1.default.static(path.join(nodeModulesPath, '@xterm/xterm/css/xterm.css')));
        this.app.use('/static/addon-fit.js', express_1.default.static(path.join(nodeModulesPath, '@xterm/addon-fit/lib/addon-fit.js')));
        this.app.use('/static/addon-web-links.js', express_1.default.static(path.join(nodeModulesPath, '@xterm/addon-web-links/lib/addon-web-links.js')));
        // API routes
        this.app.get('/api/sessions', (req, res) => {
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
        this.app.get('/api/sessions/:sessionId/status', (req, res) => {
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
        this.app.get('/terminal/:sessionId/view', async (req, res) => {
            const sessionId = req.params.sessionId;
            const session = this.sessions.get(sessionId);
            if (!session) {
                return res.status(404).send('Session not found');
            }
            try {
                const htmlContent = await this.generateTerminalHTML(sessionId);
                res.send(htmlContent);
            }
            catch (error) {
                res.status(500).send('Error loading terminal viewer');
            }
        });
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
                sessions: this.sessions.size,
                connections: this.connections.size
            });
        });
    }
    escapeHtml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    serializeForInlineScript(value) {
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
    async generateTerminalHTML(sessionId) {
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
        const serializedTokenJs = this.serializeForInlineScript(this.config.enableAuth ? this.config.authToken || '' : '');
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
    async start() {
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
            this.server = (0, http_1.createServer)(this.app);
            // Setup WebSocket server
            this.wss = new ws_1.WebSocketServer({ server: this.server });
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
    async stop() {
        this.detachAllSessionListeners();
        if (!this.isRunning) {
            this.sessions.clear();
            return;
        }
        return new Promise((resolve) => {
            // Close all WebSocket connections
            this.connections.forEach(ws => {
                if (ws.readyState === ws_1.WebSocket.OPEN) {
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
            }
            else {
                resolve();
            }
        });
    }
    setupWebSocketHandlers() {
        if (!this.wss)
            return;
        this.wss.on('connection', (ws, req) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            if (!this.isAuthorized(req.headers.authorization, url.searchParams.get('token'))) {
                const clientAddress = req.socket.remoteAddress || 'unknown';
                const rateLimited = this.registerWebSocketAuthFailure(clientAddress);
                ws.close(rateLimited ? 1013 : 1008, rateLimited ? 'Too many authentication attempts' : 'Unauthorized');
                return;
            }
            const sessionId = url.pathname.split('/').pop();
            if (!sessionId || !this.sessions.has(sessionId)) {
                ws.close(1008, 'Invalid session ID');
                return;
            }
            const connectionId = (0, uuid_1.v4)();
            this.connections.set(connectionId, ws);
            const session = this.sessions.get(sessionId);
            session.viewers.add(connectionId);
            // Send initial buffer content
            this.sendBufferToConnection(ws, session);
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleWebSocketMessage(connectionId, sessionId, message);
                }
                catch (error) {
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
    sendBufferToConnection(ws, session) {
        if (ws.readyState !== ws_1.WebSocket.OPEN)
            return;
        // Replay the whole scrollback as a single write - xterm.js handles arbitrary
        // sizes, and splitting it per line would break partial lines (prompts,
        // progress bars) that never had a newline of their own.
        const timestamp = new Date();
        const data = (0, buffer_1.bufferText)(session.buffer);
        const messages = [];
        if (data) {
            messages.push({ type: 'data', sessionId: session.sessionId, data, timestamp });
        }
        messages.push({ type: 'status', sessionId: session.sessionId, status: session.status, timestamp });
        for (const message of messages) {
            try {
                ws.send(JSON.stringify(message));
            }
            catch (error) {
                console.error('Error sending buffer websocket message:', error);
                return;
            }
        }
    }
    handleWebSocketMessage(connectionId, sessionId, message) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        switch (message.type) {
            case 'resize': {
                if (!message.size || !session.pty) {
                    break;
                }
                const { cols, rows } = message.size;
                if (!Number.isInteger(cols) || cols < 1 || cols > 500 ||
                    !Number.isInteger(rows) || rows < 1 || rows > 300) {
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
    addSession(session) {
        console.error(`[DEBUG] TerminalViewerService.addSession called for session: ${session.sessionId}`);
        this.detachSessionListeners(session.sessionId);
        this.sessions.set(session.sessionId, session);
        console.error(`[DEBUG] Session ${session.sessionId} added to terminal viewer, total sessions: ${this.sessions.size}`);
        // Set up PTY data handlers if available
        if (session.pty) {
            const listeners = [session.pty.onData((data) => {
                    // Immediately broadcast data to prevent buffering delays
                    this.broadcastToSession(session.sessionId, data);
                    // Add to buffer for new connections
                    (0, buffer_1.appendToBuffer)(session.buffer, data);
                    session.lastActivity = new Date();
                })];
            // Handle process exit - PTY onExit receives (exitCode, signal) as separate parameters
            listeners.push(session.pty.onExit((exitCode, signal) => {
                console.error(`[DEBUG] PTY process exited in viewer service for session ${session.sessionId}:`);
                console.error(`[DEBUG]   exitCode: ${JSON.stringify(exitCode)} (type: ${typeof exitCode})`);
                console.error(`[DEBUG]   signal: ${JSON.stringify(signal)} (type: ${typeof signal})`);
                // Extract numeric exit code if exitCode is an object
                let numericExitCode;
                if (typeof exitCode === 'object' && exitCode !== null) {
                    // Handle case where exitCode might be an object with a code property
                    numericExitCode = exitCode.code || exitCode.exitCode || 0;
                }
                else {
                    numericExitCode = Number(exitCode) || 0;
                }
                console.error(`[DEBUG]   numeric exit code: ${numericExitCode}`);
                // Determine status based on exit conditions
                // Normal exit (code 0) or exit via common signals should be considered finished
                let newStatus;
                if (numericExitCode === 0) {
                    newStatus = 'finished';
                    console.error(`[DEBUG] Setting status to 'finished' - normal exit with code 0`);
                }
                else if (signal === 1 || signal === 2 || signal === 15) {
                    // SIGHUP, SIGINT, SIGTERM - common termination signals that should be considered normal
                    newStatus = 'finished';
                    console.error(`[DEBUG] Setting status to 'finished' - terminated by signal ${signal}`);
                }
                else {
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
            this.sessionListeners.set(session.sessionId, listeners.filter((listener) => !!listener && typeof listener.dispose === 'function'));
        }
    }
    removeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            // Close all viewers for this session
            session.viewers.forEach(connectionId => {
                const ws = this.connections.get(connectionId);
                if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
                    ws.close();
                }
            });
            this.detachSessionListeners(sessionId);
            this.sessions.delete(sessionId);
        }
    }
    detachSessionListeners(sessionId) {
        const listeners = this.sessionListeners.get(sessionId) || [];
        for (const listener of listeners) {
            listener.dispose();
        }
        this.sessionListeners.delete(sessionId);
    }
    detachAllSessionListeners() {
        for (const sessionId of this.sessionListeners.keys()) {
            this.detachSessionListeners(sessionId);
        }
    }
    // Check if a session exists in the viewer service
    hasSession(sessionId) {
        return this.sessions.has(sessionId);
    }
    // Method to send input to a terminal session
    sendInput(sessionId, input, addNewline = true) {
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
        }
        catch (error) {
            throw new Error(`Failed to write to session ${sessionId} PTY: ${error instanceof Error ? error.message : String(error)}`);
        }
        console.error(`[DEBUG] Input sent to PTY: "${inputToSend}"`);
        // Don't manually add to buffer or broadcast - let PTY echo handle display to avoid duplication
        session.lastActivity = new Date();
    }
    broadcastToSession(sessionId, data) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        const message = {
            type: 'data',
            sessionId,
            data,
            timestamp: new Date()
        };
        session.viewers.forEach(connectionId => {
            const ws = this.connections.get(connectionId);
            if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(message));
                }
                catch (error) {
                    console.error('Error sending websocket message:', error);
                    // Remove broken connection
                    this.connections.delete(connectionId);
                    session.viewers.delete(connectionId);
                }
            }
        });
    }
    broadcastStatusToSession(sessionId, status) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        const message = {
            type: 'status',
            sessionId,
            status,
            timestamp: new Date()
        };
        session.viewers.forEach(connectionId => {
            const ws = this.connections.get(connectionId);
            if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(message));
                }
                catch (error) {
                    console.error('Error sending status websocket message:', error);
                    // Remove broken connection
                    this.connections.delete(connectionId);
                    session.viewers.delete(connectionId);
                }
            }
        });
    }
    getStatus() {
        const activeSessions = Array.from(this.sessions.values()).map(session => ({
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
    isEnabled() {
        return this.isRunning;
    }
    getSessionUrl(sessionId) {
        if (!this.isRunning || !this.sessions.has(sessionId)) {
            return null;
        }
        return this.sessionUrl(sessionId);
    }
}
exports.TerminalViewerService = TerminalViewerService;
//# sourceMappingURL=viewer-service.js.map