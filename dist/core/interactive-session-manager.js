"use strict";
/**
 * Interactive Session Manager for handling long-running interactive processes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InteractiveSessionManager = void 0;
const child_process_1 = require("child_process");
const uuid_1 = require("uuid");
const command_policy_1 = require("../security/command-policy");
const shell_option_1 = require("./shell-option");
class InteractiveSessionManager {
    sessions;
    config;
    cleanupInterval;
    commandGuard;
    constructor(config, commandGuard) {
        this.sessions = new Map();
        this.config = config;
        this.commandGuard = commandGuard;
        // Set up periodic cleanup of expired sessions
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, 60000); // Check every minute
    }
    async startSession(options) {
        if (this.commandGuard) {
            await this.commandGuard((0, command_policy_1.buildFullCommand)(options.command, options.args));
        }
        // Check session limit
        if (this.sessions.size >= this.config.maxInteractiveSessions) {
            throw new Error(`Maximum number of interactive sessions (${this.config.maxInteractiveSessions}) reached`);
        }
        const workingDirectory = options.cwd || process.cwd();
        const environment = {
            ...Object.fromEntries(Object.entries(process.env).filter(([_, value]) => value !== undefined)),
            ...options.env,
        };
        // shell: true/undefined -> platform default shell, false -> no shell at all,
        // string -> the requested shell executable resolved in the child context.
        const shell = (0, shell_option_1.resolveShellOption)(options.shell, {
            cwd: workingDirectory,
            env: environment,
        });
        // A custom shell can execute arbitrary behavior before the requested command,
        // so it must pass the same policy as the command itself.
        if (this.commandGuard && typeof shell === 'string') {
            await this.commandGuard(shell);
        }
        const sessionId = (0, uuid_1.v4)();
        const startTime = new Date();
        const childProcess = (0, child_process_1.spawn)(options.command, options.args || [], {
            cwd: workingDirectory,
            env: environment,
            shell,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Create session object
        const session = {
            sessionId,
            command: options.command,
            args: options.args || [],
            process: childProcess,
            startTime,
            lastActivity: startTime,
            cwd: workingDirectory,
            env: environment,
            status: 'running',
            outputBuffer: [],
            errorBuffer: [],
            aiContext: options.aiContext,
        };
        // Set up process event handlers
        this.setupProcessHandlers(session);
        // Store session
        this.sessions.set(sessionId, session);
        return sessionId;
    }
    async sendInput(options) {
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
    async readOutput(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        // Get buffered output
        const stdout = session.outputBuffer.join('\n');
        const stderr = session.errorBuffer.join('\n');
        // Clear buffers after reading
        session.outputBuffer = [];
        session.errorBuffer = [];
        return {
            sessionId,
            stdout,
            stderr,
            hasMore: session.status === 'running',
            status: session.status,
        };
    }
    async killSession(sessionId) {
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
    listSessions() {
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
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    setupProcessHandlers(session) {
        const { process: childProcess } = session;
        // Handle stdout data
        childProcess.stdout?.on('data', (data) => {
            const output = data.toString();
            session.outputBuffer.push(...output.split('\n').filter(line => line.length > 0));
            session.lastActivity = new Date();
            // Limit buffer size
            if (session.outputBuffer.length > this.config.outputBufferSize) {
                session.outputBuffer = session.outputBuffer.slice(-this.config.outputBufferSize);
            }
        });
        // Handle stderr data
        childProcess.stderr?.on('data', (data) => {
            const output = data.toString();
            session.errorBuffer.push(...output.split('\n').filter(line => line.length > 0));
            session.lastActivity = new Date();
            // Limit buffer size
            if (session.errorBuffer.length > this.config.outputBufferSize) {
                session.errorBuffer = session.errorBuffer.slice(-this.config.outputBufferSize);
            }
        });
        // Handle process exit
        childProcess.on('close', (code) => {
            session.status = code === 0 ? 'finished' : 'error';
            session.lastActivity = new Date();
        });
        // Handle process errors
        childProcess.on('error', (error) => {
            session.status = 'error';
            session.errorBuffer.push(`Process error: ${error.message}`);
            session.lastActivity = new Date();
        });
    }
    cleanupExpiredSessions() {
        const now = new Date();
        const expiredSessions = [];
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
    async shutdown() {
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        // Kill all active sessions
        const killPromises = Array.from(this.sessions.keys()).map(sessionId => this.killSession(sessionId).catch(error => {
            console.error(`Error killing session ${sessionId} during shutdown:`, error);
        }));
        await Promise.all(killPromises);
    }
}
exports.InteractiveSessionManager = InteractiveSessionManager;
//# sourceMappingURL=interactive-session-manager.js.map