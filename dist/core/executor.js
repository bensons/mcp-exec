"use strict";
/**
 * Core shell command executor with cross-platform support
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
exports.ShellExecutor = void 0;
exports.defaultMaxCollectedBytes = defaultMaxCollectedBytes;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const uuid_1 = require("uuid");
const command_policy_1 = require("../security/command-policy");
const output_processor_1 = require("../utils/output-processor");
const intent_tracker_1 = require("../utils/intent-tracker");
const interactive_session_manager_1 = require("./interactive-session-manager");
const shell_option_1 = require("./shell-option");
/** How long a timed-out process gets to handle SIGTERM before SIGKILL. */
const SIGKILL_GRACE_MS = 2000;
/** How long after SIGKILL we wait for 'close' before settling anyway. */
const SIGKILL_SETTLE_MS = 500;
/** How often to check whether a SIGKILLed process group has disappeared. */
const PROCESS_GROUP_POLL_MS = 25;
const POSIX_ENV_COMMAND = ['/usr/bin/env', '/bin/env'].find(fs_1.existsSync) || 'env';
function signalNumber(signal) {
    return os.constants.signals[signal] ?? 0;
}
function processGroupExists(pid) {
    try {
        process.kill(-pid, 0);
        return true;
    }
    catch (error) {
        return error.code !== 'ESRCH';
    }
}
function terminateWindowsProcessTree(pid) {
    return new Promise((resolve) => {
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const taskkill = (0, child_process_1.spawn)(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', '/f'], {
            shell: false,
            stdio: 'ignore',
            windowsHide: true,
        });
        let completed = false;
        const complete = () => {
            if (completed)
                return;
            completed = true;
            resolve();
        };
        taskkill.once('error', complete);
        taskkill.once('close', complete);
    });
}
/** Bytes of the most recent output kept once the hard cap is hit (the tail usually holds the error). */
const OUTPUT_TAIL_BYTES = 64 * 1024;
/** Default hard cap on bytes retained per stream when `output.maxCollectedBytes` is not configured. */
function defaultMaxCollectedBytes(maxOutputLength) {
    return Math.max(4 * maxOutputLength, 1024 * 1024);
}
/**
 * Collects a child stream's text with bounded memory: the first `cap` bytes plus a rolling tail
 * window, so a command that prints gigabytes cannot OOM the server. The stream is always drained
 * (never paused) so the child never blocks on a full pipe.
 */
class BoundedOutputCollector {
    cap;
    tailWindow;
    head = [];
    headBytes = 0;
    tail = [];
    tailBytes = 0;
    droppedBytes = 0;
    constructor(cap, tailWindow = OUTPUT_TAIL_BYTES) {
        this.cap = cap;
        this.tailWindow = tailWindow;
        if (!Number.isSafeInteger(cap) || cap < 0) {
            throw new RangeError('maxCollectedBytes must be a non-negative integer');
        }
    }
    push(chunk) {
        const bytes = Buffer.byteLength(chunk, 'utf8');
        if (this.cap === 0 || this.headBytes + bytes <= this.cap) {
            this.head.push(chunk);
            this.headBytes += bytes;
            return;
        }
        this.tail.push({ chunk, bytes });
        this.tailBytes += bytes;
        // Evict from the front of the tail window, always keeping the newest chunk.
        while (this.tail.length > 1 && this.tailBytes - this.tail[0].bytes >= this.tailWindow) {
            const evicted = this.tail.shift();
            this.tailBytes -= evicted.bytes;
            this.droppedBytes += evicted.bytes;
        }
    }
    text() {
        const head = this.head.join('');
        const tail = this.tail.map(entry => entry.chunk).join('');
        if (this.droppedBytes === 0) {
            return head + tail;
        }
        return `${head}\n... [Output truncated - ${this.droppedBytes} bytes dropped] ...\n${tail}`;
    }
}
class ShellExecutor {
    securityManager;
    contextManager;
    auditLogger;
    outputProcessor;
    intentTracker;
    sessionManager;
    config;
    constructor(securityManager, contextManager, auditLogger, config) {
        this.securityManager = securityManager;
        this.contextManager = contextManager;
        this.auditLogger = auditLogger;
        this.config = config;
        this.outputProcessor = new output_processor_1.OutputProcessor(config.output);
        this.intentTracker = new intent_tracker_1.IntentTracker();
        this.sessionManager = new interactive_session_manager_1.InteractiveSessionManager(config.sessions, async (command, guardOptions = {}) => (0, command_policy_1.assertCommandAllowed)(this.securityManager, command, this.auditLogger, { source: 'interactive-session' }, {
            ...guardOptions,
            cwd: await this.getEffectiveCwd(guardOptions.cwd),
        }));
    }
    /**
     * Effective working directory a command will run in: explicit cwd, else the
     * session context directory, else the server's cwd. Relative and `~` paths in
     * the command are validated against this, not against process.cwd().
     */
    async getEffectiveCwd(cwd) {
        if (cwd) {
            return path.resolve(cwd);
        }
        const context = await this.contextManager.getCurrentContext();
        return path.resolve(context.currentDirectory || process.cwd());
    }
    async executeCommand(options, policyOptions = {}) {
        const commandId = (0, uuid_1.v4)();
        const startTime = Date.now();
        // Debug logging through audit logger to avoid JSON-RPC interference
        await this.auditLogger.log({
            level: 'debug',
            message: 'ShellExecutor.executeCommand called',
            context: { command: options.command }
        });
        // Log command execution at info level
        await this.auditLogger.info('Executing shell command', {
            commandId,
            command: options.command,
            args: options.args,
            cwd: options.cwd
        }, 'shell-executor');
        try {
            // Security validation
            const fullCommand = this.buildFullCommand(options);
            await this.auditLogger.debug('Validating command security', {
                commandId,
                fullCommand
            }, 'security-validator');
            // Determine the working directory up front: directory checks resolve
            // relative and `~` paths against it.
            const context = await this.contextManager.getCurrentContext();
            const workingDirectory = path.resolve(options.cwd || context.currentDirectory || process.cwd());
            // Validate expansions against the same merged environment supplied to the shell.
            const environment = {
                ...context.environmentVariables,
                ...options.env,
            };
            const securityCheck = await this.securityManager.validateCommand(fullCommand, {
                cwd: workingDirectory,
                env: environment,
            });
            // A confirmed command (via confirm_command) bypasses only the
            // confirmation gate; hard blocks still stop it here.
            const confirmationBypassed = Boolean(securityCheck.requiresConfirmation && policyOptions.skipConfirmation);
            if (!securityCheck.allowed && !confirmationBypassed) {
                await this.auditLogger.warning('Command blocked by security policy', {
                    commandId,
                    fullCommand,
                    reason: securityCheck.reason,
                    riskLevel: securityCheck.riskLevel
                }, 'security-validator');
                throw new Error(`Command blocked by security policy: ${securityCheck.reason}`);
            }
            await this.auditLogger.debug('Command passed security validation', {
                commandId,
                riskLevel: securityCheck.riskLevel
            }, 'security-validator');
            // Analyze command intent
            const intent = this.intentTracker.analyzeIntent(fullCommand, options.aiContext);
            const shell = (0, shell_option_1.resolveShellOption)(options.shell, {
                cwd: workingDirectory,
                env: environment,
            });
            if (typeof shell === 'string') {
                await (0, command_policy_1.assertCommandAllowed)(this.securityManager, shell, this.auditLogger, {
                    source: 'execute_command_shell',
                }, {
                    skipConfirmation: policyOptions.skipConfirmation,
                    cwd: workingDirectory,
                    env: environment,
                });
            }
            // Execute command
            await this.auditLogger.debug('Starting command execution', {
                commandId,
                workingDirectory,
                timeout: options.timeout || this.config.security.timeout
            }, 'command-executor');
            const result = await this.executeWithTimeout(options.command, options.args || [], {
                cwd: workingDirectory,
                env: environment,
                shell,
                timeout: options.timeout || this.config.security.timeout,
            });
            await this.auditLogger.info('Command executed successfully', {
                commandId,
                exitCode: result.exitCode,
                executionTime: Date.now() - startTime
            }, 'command-executor');
            // Process output
            const processedOutput = await this.outputProcessor.process(result, fullCommand);
            // Enhance output with intent information
            processedOutput.metadata.commandIntent = intent;
            processedOutput.summary.nextSteps = [
                ...(processedOutput.summary.nextSteps || []),
                ...this.intentTracker.suggestNextCommands(fullCommand).slice(0, 3)
            ];
            // Update context
            await this.contextManager.updateAfterCommand({
                id: commandId,
                command: fullCommand,
                workingDirectory,
                environment: environment,
                // Per-command overrides are reported separately so they are not mistaken for
                // persistent session state.
                envOverrides: options.env,
                resultingEnvironment: result.environment,
                resultingWorkingDirectory: result.workingDirectory,
                output: processedOutput,
                aiContext: options.aiContext,
            });
            // Log execution
            await this.auditLogger.logCommand({
                commandId,
                command: fullCommand,
                context: {
                    sessionId: context.sessionId,
                    workingDirectory,
                    previousCommands: context.previousCommands.slice(-5),
                    aiIntent: options.aiContext,
                },
                result: processedOutput,
                securityCheck,
                executionTime: Date.now() - startTime,
            });
            return processedOutput;
        }
        catch (error) {
            await this.auditLogger.error('Command execution failed', {
                commandId,
                command: this.buildFullCommand(options),
                error: error instanceof Error ? error.message : 'Unknown error',
                executionTime: Date.now() - startTime
            }, 'command-executor');
            const errorOutput = {
                stdout: '',
                stderr: error instanceof Error ? error.message : 'Unknown error',
                exitCode: 1,
                metadata: {
                    executionTime: Date.now() - startTime,
                    commandType: 'error',
                    affectedResources: [],
                    warnings: [],
                    suggestions: ['Check command syntax and permissions'],
                },
                summary: {
                    success: false,
                    mainResult: `Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    sideEffects: [],
                    nextSteps: ['Review error message and correct command'],
                },
            };
            // Log error
            const errorContext = await this.contextManager.getCurrentContext();
            await this.auditLogger.logError({
                commandId,
                command: this.buildFullCommand(options),
                error: error instanceof Error ? error : new Error('Unknown error'),
                context: {
                    sessionId: errorContext.sessionId,
                    workingDirectory: options.cwd || errorContext.currentDirectory || process.cwd(),
                    previousCommands: errorContext.previousCommands.slice(-5),
                    aiIntent: options.aiContext,
                },
            });
            return errorOutput;
        }
    }
    getIntentSummary() {
        return this.intentTracker.getIntentSummary();
    }
    suggestNextCommands(command) {
        return this.intentTracker.suggestNextCommands(command);
    }
    getRecentIntents(limit) {
        return this.intentTracker.getRecentIntents(limit);
    }
    buildFullCommand(options) {
        if (options.args && options.args.length > 0) {
            return `${options.command} ${options.args.join(' ')}`;
        }
        return options.command;
    }
    async executeWithTimeout(command, args, options) {
        return new Promise((resolve, reject) => {
            const { timeout, ...spawnOptions } = options;
            const stateMarker = `__MCP_EXEC_STATE_${(0, uuid_1.v4)().replace(/-/g, '')}`;
            const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
            const captureShellState = this.supportsShellStateCapture(spawnOptions.shell);
            const wrappedCommand = captureShellState
                ? process.platform === 'win32'
                    ? this.wrapWindowsCommand(fullCommand, stateMarker)
                    : this.wrapPosixCommand(fullCommand, stateMarker)
                : fullCommand;
            const childEnvironment = { ...spawnOptions.env };
            if (captureShellState && process.platform !== 'win32' && childEnvironment.OLDPWD !== undefined) {
                // Some /bin/sh implementations discard inherited OLDPWD during startup.
                // Carry it under an internal name, restore it before the user command, and
                // immediately remove the internal names from the command's environment.
                childEnvironment.__MCP_EXEC_OLDPWD_PRESENT = '1';
                childEnvironment.__MCP_EXEC_OLDPWD_VALUE = childEnvironment.OLDPWD;
            }
            const maxCollectedBytes = this.config.output.maxCollectedBytes ??
                defaultMaxCollectedBytes(this.config.output.maxOutputLength);
            const stdoutCollector = new BoundedOutputCollector(maxCollectedBytes);
            const stderrCollector = new BoundedOutputCollector(maxCollectedBytes);
            // Wrap shell-backed commands so the shell reports its final exported
            // environment and cwd. With shell:false, preserve direct-spawn semantics.
            const child = (0, child_process_1.spawn)(captureShellState ? wrappedCommand : command, captureShellState ? [] : args, {
                ...spawnOptions,
                env: childEnvironment,
                stdio: ['pipe', 'pipe', 'pipe'],
                // Own process group so a timeout can kill the whole tree, not just the
                // wrapping shell (`a; b` would otherwise leave `b` running as an orphan).
                detached: process.platform !== 'win32',
            });
            let settled = false;
            let timedOut = false;
            const timers = [];
            const settle = (result) => {
                if (settled)
                    return;
                settled = true;
                timers.forEach(clearTimeout);
                resolve(result);
            };
            const fail = (error) => {
                if (settled)
                    return;
                settled = true;
                timers.forEach(clearTimeout);
                reject(error);
            };
            const timeoutResult = () => ({
                stdout: stdoutCollector.text(),
                stderr: stderrCollector.text(),
                exitCode: 124, // coreutils `timeout` convention
                timedOut: true,
                timeoutMs: timeout,
                truncated: {
                    stdout: stdoutCollector.droppedBytes,
                    stderr: stderrCollector.droppedBytes,
                },
            });
            const killProcessGroup = (pid, signal) => {
                try {
                    process.kill(-pid, signal);
                }
                catch {
                    // Process (group) already gone
                }
            };
            const waitForProcessGroupExit = (pid, deadline) => {
                if (!processGroupExists(pid) || Date.now() >= deadline) {
                    settle(timeoutResult());
                    return;
                }
                const poll = setTimeout(() => waitForProcessGroupExit(pid, deadline), PROCESS_GROUP_POLL_MS);
                timers.push(poll);
            };
            // Set up timeout
            if (timeout > 0) {
                timers.push(setTimeout(() => {
                    timedOut = true;
                    if (child.pid === undefined) {
                        child.kill('SIGKILL');
                        settle(timeoutResult());
                        return;
                    }
                    const pid = child.pid;
                    if (process.platform === 'win32') {
                        // Use taskkill directly (without a shell) so the wrapping cmd.exe and
                        // every descendant are terminated without interpolating user input.
                        void terminateWindowsProcessTree(pid).then(() => settle(timeoutResult()));
                        // Do not let a malfunctioning system utility leave execution pending.
                        const giveUp = setTimeout(() => {
                            child.kill('SIGKILL');
                            settle(timeoutResult());
                        }, SIGKILL_GRACE_MS + SIGKILL_SETTLE_MS);
                        giveUp.unref();
                        timers.push(giveUp);
                        return;
                    }
                    killProcessGroup(pid, 'SIGTERM');
                    const sigkill = setTimeout(() => {
                        // The shell may already have emitted 'close', but descendants can
                        // still be alive in its process group. Always preserve this
                        // escalation until that group has gone away.
                        if (processGroupExists(pid)) {
                            killProcessGroup(pid, 'SIGKILL');
                        }
                        waitForProcessGroupExit(pid, Date.now() + SIGKILL_SETTLE_MS);
                    }, SIGKILL_GRACE_MS);
                    timers.push(sigkill);
                }, timeout));
            }
            // Collect output. setEncoding keeps multi-byte UTF-8 sequences intact across chunk
            // boundaries; the collectors bound how much of the output is retained in memory.
            child.stdout?.setEncoding('utf8');
            child.stderr?.setEncoding('utf8');
            child.stdout?.on('data', (chunk) => {
                stdoutCollector.push(chunk);
            });
            child.stderr?.on('data', (chunk) => {
                stderrCollector.push(chunk);
            });
            // Handle completion
            child.on('close', (code, signal) => {
                if (timedOut) {
                    if (process.platform !== 'win32' &&
                        child.pid !== undefined &&
                        !processGroupExists(child.pid)) {
                        // The whole process group exited during the SIGTERM grace period.
                        settle(timeoutResult());
                    }
                    // Otherwise the timeout path remains responsible for tree cleanup.
                    return;
                }
                const stdout = stdoutCollector.text();
                const stderr = stderrCollector.text();
                const shellState = !captureShellState
                    ? { stderr }
                    : process.platform === 'win32'
                        ? this.extractWindowsShellState(stderr, stateMarker)
                        : this.extractPosixShellState(stderr, stateMarker);
                settle({
                    stdout,
                    stderr: shellState.stderr,
                    // code is null when the process was terminated by a signal
                    exitCode: code ?? (signal ? 128 + signalNumber(signal) : 1),
                    signal: signal ?? undefined,
                    environment: shellState.environment,
                    workingDirectory: shellState.workingDirectory,
                    truncated: {
                        stdout: stdoutCollector.droppedBytes,
                        stderr: stderrCollector.droppedBytes,
                    },
                });
            });
            // Handle errors
            child.on('error', (error) => {
                fail(error);
            });
        });
    }
    supportsShellStateCapture(shell) {
        if (typeof shell === 'boolean' || shell === undefined) {
            return shell !== false;
        }
        const shellName = path.basename(shell).toLowerCase().replace(/\.exe$/, '');
        return process.platform === 'win32'
            ? shellName === 'cmd'
            : ['sh', 'bash', 'dash', 'zsh', 'ksh'].includes(shellName);
    }
    wrapPosixCommand(command, marker) {
        return 'if [ "${__MCP_EXEC_OLDPWD_PRESENT-}" = 1 ]; then ' +
            'OLDPWD=$__MCP_EXEC_OLDPWD_VALUE; export OLDPWD; fi\n' +
            'unset __MCP_EXEC_OLDPWD_PRESENT __MCP_EXEC_OLDPWD_VALUE\n' +
            `${command}\n` +
            '__mcp_exec_status=$?\n' +
            `printf '\\000%s\\000%s\\000' '${marker}' "$PWD" >&2\n` +
            `${POSIX_ENV_COMMAND} -0 >&2\n` +
            `printf '\\000%s\\000' '${marker}_END' >&2\n` +
            'exit "$__mcp_exec_status"';
    }
    extractPosixShellState(stderr, marker) {
        const startMarker = `\0${marker}\0`;
        const endMarker = `\0${marker}_END\0`;
        const start = stderr.lastIndexOf(startMarker);
        if (start < 0) {
            return { stderr };
        }
        const end = stderr.indexOf(endMarker, start + startMarker.length);
        if (end < 0) {
            return { stderr };
        }
        const state = stderr.slice(start + startMarker.length, end).split('\0');
        const workingDirectory = state.shift();
        const environment = {};
        for (const entry of state) {
            const separator = entry.indexOf('=');
            if (separator > 0) {
                environment[entry.slice(0, separator)] = entry.slice(separator + 1);
            }
        }
        return {
            stderr: stderr.slice(0, start) + stderr.slice(end + endMarker.length),
            environment,
            workingDirectory,
        };
    }
    wrapWindowsCommand(command, marker) {
        return `${command}\r\n` +
            'set "__mcp_exec_status=%ERRORLEVEL%"\r\n' +
            `>&2 echo ${marker}\r\n` +
            '>&2 cd\r\n' +
            '>&2 set\r\n' +
            `>&2 echo ${marker}_END\r\n` +
            'exit /b %__mcp_exec_status%';
    }
    extractWindowsShellState(stderr, marker) {
        const crlfMarker = `${marker}\r\n`;
        const lfMarker = `${marker}\n`;
        const crlfStart = stderr.lastIndexOf(crlfMarker);
        const lfStart = stderr.lastIndexOf(lfMarker);
        const start = Math.max(crlfStart, lfStart);
        if (start < 0) {
            return { stderr };
        }
        const payloadStart = start + (start === crlfStart ? crlfMarker.length : lfMarker.length);
        const end = stderr.indexOf(`${marker}_END`, payloadStart);
        if (end < 0) {
            return { stderr };
        }
        const lines = stderr.slice(payloadStart, end).split(/\r?\n/);
        const workingDirectory = lines.shift()?.trim();
        const environment = {};
        for (const line of lines) {
            const separator = line.indexOf('=');
            if (separator > 0) {
                const name = line.slice(0, separator);
                if (name.toLowerCase() !== '__mcp_exec_status') {
                    environment[name] = line.slice(separator + 1);
                }
            }
        }
        const afterEnd = end + `${marker}_END`.length;
        const trailingNewline = stderr.slice(afterEnd).match(/^\r?\n/)?.[0].length || 0;
        return {
            stderr: stderr.slice(0, start) + stderr.slice(afterEnd + trailingNewline),
            environment,
            workingDirectory,
        };
    }
    // Session management API
    async listSessions() {
        return this.sessionManager.listSessions();
    }
    getSession(sessionId) {
        return this.sessionManager.getSession(sessionId);
    }
    async killSession(sessionId) {
        await this.sessionManager.killSession(sessionId);
    }
    // Public method to start a new interactive session
    async startInteractiveSession(options) {
        const context = await this.contextManager.getCurrentContext();
        const cwd = await this.getEffectiveCwd(options.cwd);
        const env = {
            ...context.environmentVariables,
            ...options.env,
        };
        await (0, command_policy_1.assertCommandAllowed)(this.securityManager, this.buildFullCommand(options), this.auditLogger, { source: 'start_interactive_session' }, { skipConfirmation: options.skipConfirmation, cwd, env });
        return await this.sessionManager.startSession({ ...options, cwd, env });
    }
    // Public method to send input to a session
    async sendInputToSession(options) {
        return await this.sessionManager.sendInput(options);
    }
    async readSessionOutput(sessionId) {
        return await this.sessionManager.readOutput(sessionId);
    }
    /**
     * Apply a new config to the live components instead of recreating the
     * executor, which would orphan every running interactive session.
     */
    updateConfig(config) {
        this.config = config;
        this.outputProcessor.updateConfig(config.output);
        this.sessionManager.updateConfig(config.sessions);
    }
    /**
     * Rebind services that can be recreated by dynamic configuration without
     * replacing this executor (and orphaning its interactive sessions).
     */
    updateDependencies(securityManager, contextManager, auditLogger) {
        this.securityManager = securityManager;
        this.contextManager = contextManager;
        this.auditLogger = auditLogger;
    }
    async shutdown() {
        await this.sessionManager.shutdown();
    }
}
exports.ShellExecutor = ShellExecutor;
//# sourceMappingURL=executor.js.map