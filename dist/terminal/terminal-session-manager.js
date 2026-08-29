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
const path = __importStar(require("path"));
const pty = __importStar(require("node-pty"));
const uuid_1 = require("uuid");
const buffer_1 = require("./buffer");
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
    sessionRemovedHandler;
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
        this.cleanupInterval.unref();
    }
    /**
     * Swap in new config without recreating the manager (which would orphan every
     * running PTY / child process). Limits/timeouts are read at call time.
     */
    updateConfig(config, terminalViewerConfig) {
        this.config = config;
        this.terminalViewerConfig = terminalViewerConfig;
        this.fallbackSessionManager.updateConfig(config);
        for (const session of this.sessions.values()) {
            (0, buffer_1.resizeTerminalBuffer)(session.buffer, terminalViewerConfig.bufferSize);
        }
    }
    /**
     * Register a callback invoked whenever a terminal session is removed from this manager
     * (kill, terminate or sweep). Used to keep the terminal viewer service in sync.
     */
    onSessionRemoved(handler) {
        this.sessionRemovedHandler = handler;
    }
    async startSession(options) {
        console.error(`[DEBUG] TerminalSessionManager.startSession called with enableTerminalViewer: ${options.enableTerminalViewer}`);
        const cwd = path.resolve(options.cwd || process.cwd());
        const environment = {
            ...Object.fromEntries(Object.entries(process.env).filter(([_, value]) => value !== undefined)),
            ...options.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
        };
        const normalizedOptions = { ...options, cwd, env: environment };
        if (this.commandGuard) {
            await this.commandGuard((0, command_policy_1.buildFullCommand)(options.command, options.args), {
                skipConfirmation: options.skipConfirmation,
                cwd,
                env: environment,
            });
        }
        // If terminal viewer is not requested, use fallback
        if (!options.enableTerminalViewer) {
            console.error(`[DEBUG] Terminal viewer not requested, using fallback session manager`);
            // Ensure command is provided for fallback session manager
            const fallbackOptions = {
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
        const shell = (0, shell_option_1.resolveShellOption)(options.shell, {
            cwd,
            env: environment,
        });
        if (this.commandGuard && typeof shell === 'string') {
            await this.commandGuard(shell, {
                skipConfirmation: options.skipConfirmation,
                cwd,
                env: environment,
            });
        }
        if (shell === false && !options.command) {
            throw new Error('shell:false requires a command for terminal-viewer execution');
        }
        const sessionId = (0, uuid_1.v4)();
        const startTime = new Date();
        // Create PTY process
        const ptyProcess = this.createPtyProcess(normalizedOptions, shell, cwd, environment);
        // Create terminal session
        const session = {
            sessionId,
            command: options.command || 'system shell',
            args: options.args || [],
            cwd,
            env: environment,
            startTime,
            lastActivity: startTime,
            status: 'running',
            pty: ptyProcess,
            buffer: (0, buffer_1.createTerminalBuffer)(this.terminalViewerConfig.bufferSize),
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
            (0, buffer_1.appendToBuffer)(session.buffer, data);
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
            (0, buffer_1.appendToBuffer)(session.buffer, `\r\n[Session ended with exit code ${numericExitCode}${signal ? `, signal ${JSON.stringify(signal)}` : ''}]\r\n`);
        });
    }
    async sendInput(options) {
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
        }
        catch (error) {
            throw new Error(`Failed to write to session ${options.sessionId} PTY: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (resultingCwd && options.addNewline !== false) {
            session.cwd = resultingCwd;
            session.env.PWD = resultingCwd;
        }
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
        this.sessionRemovedHandler?.(sessionId);
    }
    countRunningSessions() {
        let count = 0;
        for (const session of this.sessions.values()) {
            if (session.status === 'running') {
                count++;
            }
        }
        return count;
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    getTerminalSessions() {
        return Array.from(this.sessions.values());
    }
    getSessionInfo(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }
        const lines = (0, buffer_1.bufferLines)(session.buffer);
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
            // Finished sessions are reaped after a short grace period, independent of sessionTimeout
            const maxIdle = session.status === 'running'
                ? this.terminalViewerConfig.sessionTimeout
                : Math.min(this.terminalViewerConfig.sessionTimeout, interactive_session_manager_1.FINISHED_SESSION_GRACE_MS);
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