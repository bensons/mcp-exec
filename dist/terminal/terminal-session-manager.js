"use strict";
/**
 * Enhanced Terminal Session Manager with PTY support
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalSessionManager = void 0;
const pty = __importStar(require("node-pty"));
const uuid_1 = require("uuid");
const interactive_session_manager_1 = require("../core/interactive-session-manager");
const command_policy_1 = require("../security/command-policy");
const shell_option_1 = require("../core/shell-option");
class TerminalSessionManager {
    sessions;
    config;
    terminalViewerConfig;
    cleanupInterval;
    fallbackSessionManager;
    commandGuard;
    constructor(config, terminalViewerConfig, commandGuard) {
        this.sessions = new Map();
        this.config = config;
        this.terminalViewerConfig = terminalViewerConfig;
        this.commandGuard = commandGuard;
        this.fallbackSessionManager = new interactive_session_manager_1.InteractiveSessionManager(config, commandGuard);
        // Set up periodic cleanup of expired sessions
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, 60000); // Check every minute
    }
    async startSession(options) {
        console.error(`[DEBUG] TerminalSessionManager.startSession called with enableTerminalViewer: ${options.enableTerminalViewer}`);
        if (this.commandGuard && options.command) {
            await this.commandGuard((0, command_policy_1.buildFullCommand)(options.command, options.args));
        }
        // If terminal viewer is not requested, use fallback
        if (!options.enableTerminalViewer) {
            console.error(`[DEBUG] Terminal viewer not requested, using fallback session manager`);
            // Ensure command is provided for fallback session manager
            const fallbackOptions = {
                ...options,
                command: options.command || this.getShell()
            };
            return this.fallbackSessionManager.startSession(fallbackOptions);
        }
        console.error(`[DEBUG] Creating terminal session, current sessions: ${this.sessions.size}/${this.terminalViewerConfig.maxSessions}`);
        // Check session limit
        if (this.sessions.size >= this.terminalViewerConfig.maxSessions) {
            throw new Error(`Maximum number of terminal sessions (${this.terminalViewerConfig.maxSessions}) reached`);
        }
        const workingDirectory = options.cwd || process.cwd();
        const environment = {
            ...Object.fromEntries(Object.entries(process.env).filter(([_, value]) => value !== undefined)),
            ...options.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
        };
        const shell = (0, shell_option_1.resolveShellOption)(options.shell, {
            cwd: workingDirectory,
            env: environment,
        });
        if (this.commandGuard && typeof shell === 'string') {
            await this.commandGuard(shell);
        }
        if (shell === false && !options.command) {
            throw new Error('shell:false requires a command for terminal-viewer execution');
        }
        const sessionId = (0, uuid_1.v4)();
        const startTime = new Date();
        // Create PTY process
        const ptyProcess = this.createPtyProcess(options, shell, workingDirectory, environment);
        // Create terminal session
        const session = {
            sessionId,
            command: options.command || 'system shell',
            args: options.args || [],
            cwd: workingDirectory,
            env: environment,
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
        }
        else {
            console.error(`[DEBUG] Skipping PTY handler setup for session ${sessionId} - will be handled by TerminalViewerService`);
        }
        // Store session
        this.sessions.set(sessionId, session);
        console.error(`[DEBUG] Terminal session ${sessionId} created and stored, total sessions: ${this.sessions.size}`);
        return sessionId;
    }
    createPtyProcess(options, shellOption, workingDirectory, environment) {
        const executable = shellOption === false
            ? options.command
            : typeof shellOption === 'string'
                ? shellOption
                : this.getShell();
        const executableArgs = shellOption === false ? options.args || [] : [];
        const size = options.terminalSize || { cols: 80, rows: 24 };
        console.error(`[DEBUG] Creating PTY with executable: ${executable}`);
        try {
            // Create PTY process
            const ptyProcess = pty.spawn(executable, executableArgs, {
                name: 'xterm-color',
                cols: size.cols,
                rows: size.rows,
                cwd: workingDirectory,
                env: environment,
                encoding: 'utf8',
            });
            console.error(`[DEBUG] PTY process created successfully with PID: ${ptyProcess.pid}`);
            // Send initial command if provided
            if (options.command && shellOption !== false) {
                const fullCommand = options.args && options.args.length > 0
                    ? `${options.command} ${options.args.join(' ')}`
                    : options.command;
                console.error(`[DEBUG] Sending initial command to PTY: "${fullCommand}"`);
                ptyProcess.write(fullCommand + '\r');
            }
            else if (!options.command) {
                console.error(`[DEBUG] No initial command provided, PTY will start with default shell`);
            }
            return ptyProcess;
        }
        catch (error) {
            console.error('Failed to create PTY process:', error);
            throw new Error(`Failed to create terminal session: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    getShell() {
        if (process.platform === 'win32') {
            return process.env.COMSPEC || 'cmd.exe';
        }
        else {
            return process.env.SHELL || '/bin/bash';
        }
    }
    setupPtyHandlers(session) {
        if (!session.pty)
            return;
        // Handle data output
        session.pty.onData((data) => {
            this.addToBuffer(session, data, 'output');
            session.lastActivity = new Date();
        });
        // Handle process exit - PTY onExit receives (exitCode, signal) as separate parameters
        session.pty.onExit((exitCode, signal) => {
            console.error(`[DEBUG] PTY process exited for session ${session.sessionId}:`);
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
            session.lastActivity = new Date();
            console.error(`[DEBUG] Session ${session.sessionId} status updated to: ${newStatus}`);
            // Add a final message to the buffer indicating the session has ended
            this.addToBuffer(session, `\n[Session ended with exit code ${numericExitCode}${signal ? `, signal ${JSON.stringify(signal)}` : ''}]`, 'output');
        });
    }
    addToBuffer(session, data, type) {
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
    extractAnsiCodes(text) {
        const ansiRegex = /\x1b\[[0-9;]*m/g;
        return text.match(ansiRegex) || [];
    }
    async sendInput(options) {
        console.error(`[DEBUG] TerminalSessionManager.sendInput called for session ${options.sessionId}`);
        if (this.commandGuard) {
            await this.commandGuard(options.input);
        }
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
    async killSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            // Try fallback session manager
            return this.fallbackSessionManager.killSession(sessionId);
        }
        if (session.pty && session.status === 'running') {
            try {
                session.pty.kill();
            }
            catch (error) {
                console.error('Error killing PTY process:', error);
            }
        }
        // Remove from active sessions
        this.sessions.delete(sessionId);
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    getSessionInfo(sessionId) {
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
    listSessions() {
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
    cleanupExpiredSessions() {
        const now = new Date();
        const expiredSessions = [];
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
    async shutdown() {
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
    resizeTerminal(sessionId, cols, rows) {
        const session = this.sessions.get(sessionId);
        if (session && session.pty && session.status === 'running') {
            try {
                session.pty.resize(cols, rows);
            }
            catch (error) {
                console.error('Error resizing terminal:', error);
            }
        }
    }
    // Method to get terminal buffer for new viewers
    getTerminalBuffer(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? session.buffer : null;
    }
}
exports.TerminalSessionManager = TerminalSessionManager;
//# sourceMappingURL=terminal-session-manager.js.map