"use strict";
/**
 * Interactive Session Manager for handling long-running interactive processes
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
exports.InteractiveSessionManager = exports.FINISHED_SESSION_GRACE_MS = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const command_policy_1 = require("../security/command-policy");
const shell_option_1 = require("./shell-option");
/** How long a finished/errored session is kept around so its output can still be drained. */
exports.FINISHED_SESSION_GRACE_MS = 5 * 60 * 1000;
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
        this.cleanupInterval.unref();
    }
    /**
     * Swap in a new sessions config without recreating the manager (which would
     * orphan every running child process). Limits/timeouts are read at call time.
     */
    updateConfig(config) {
        this.config = config;
    }
    async startSession(options) {
        const cwd = path.resolve(options.cwd || process.cwd());
        const environment = {
            ...Object.fromEntries(Object.entries(process.env).filter(([_, value]) => value !== undefined)),
            ...options.env,
        };
        if (this.commandGuard) {
            await this.commandGuard((0, command_policy_1.buildFullCommand)(options.command, options.args), {
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
        const shell = (0, shell_option_1.resolveShellOption)(options.shell, {
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
        const sessionId = (0, uuid_1.v4)();
        const startTime = new Date();
        const childProcess = (0, child_process_1.spawn)(options.command, options.args || [], {
            cwd,
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
            cwd,
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
        const stdin = session.process.stdin;
        if (!stdin || stdin.destroyed || !stdin.writable) {
            throw new Error(`Session ${options.sessionId} stdin is closed`);
        }
        // Send input to the process
        const input = options.addNewline !== false ? options.input + '\n' : options.input;
        await new Promise((resolve, reject) => {
            const settle = (error) => {
                clearTimeout(graceTimer);
                if (error)
                    reject(error);
                else
                    resolve();
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
        };
    }
    async killSession(sessionId) {
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
    countRunningSessions() {
        let count = 0;
        for (const session of this.sessions.values()) {
            if (session.status === 'running') {
                count++;
            }
        }
        return count;
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
        // Handle stdin errors (EPIPE when the child closed its stdin or already exited).
        // Without a listener Node rethrows these as uncaught exceptions, which crashes the server.
        childProcess.stdin?.on('error', (error) => {
            session.status = 'error';
            session.errorBuffer.push(`stdin error: ${error.message}`);
            session.lastActivity = new Date();
        });
        // A child can exit while a descendant still holds its stdout/stderr pipes open. Keep the
        // session readable until 'close', which fires only after those streams have drained.
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
            // Finished sessions are reaped after a short grace period, independent of sessionTimeout
            const maxIdle = session.status === 'running'
                ? this.config.sessionTimeout
                : Math.min(this.config.sessionTimeout, exports.FINISHED_SESSION_GRACE_MS);
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