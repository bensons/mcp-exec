"use strict";
/**
 * Context manager for preserving state across command executions
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
exports.ContextManager = void 0;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const crypto_1 = require("crypto");
const uuid_1 = require("uuid");
/** Persisted-session limits (issue #31): keep the file small and cheap to write. */
const PERSIST_DEBOUNCE_MS = 1000;
const PERSIST_MAX_HISTORY = 50;
const PERSIST_MAX_OUTPUT_CHARS = 1024;
const PERSIST_MAX_FS_CHANGES = 100;
// ponytail: local copy of the redaction helper; dedupe against src/audit/redact.ts from #30 once it lands.
const SECRET_KEY_PATTERN = /(pass|pwd|secret|token|key|credential|auth|session)/i;
function redactValue(key, value) {
    return SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : value;
}
/** Redact `NAME=value` assignments with secret-looking names inside a command string. */
function redactCommand(command) {
    return command.replace(/([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g, (match, key) => SECRET_KEY_PATTERN.test(key) ? `${key}=[REDACTED]` : match);
}
class ContextManager {
    config;
    sessionId;
    currentDirectory;
    previousDirectory;
    directoryStack = [];
    environmentVariables;
    commandHistory;
    outputCache;
    fileSystemChanges;
    auditLogger;
    sessionFile;
    legacySessionFiles;
    workspaceDirectory;
    onSessionPersisted;
    persistTimer;
    persistQueue = Promise.resolve();
    persistenceDirty = false;
    disposed = false;
    constructor(config, auditLogger, options = {}) {
        this.validateMaxHistorySize(config.maxHistorySize);
        this.config = { ...config };
        this.auditLogger = auditLogger;
        this.sessionId = (0, uuid_1.v4)();
        this.currentDirectory = process.cwd();
        this.environmentVariables = new Map();
        this.commandHistory = [];
        this.outputCache = new Map();
        this.fileSystemChanges = [];
        this.workspaceDirectory = path.resolve(options.workspaceDirectory || process.env.MCP_EXEC_WORKSPACE_DIR || process.cwd());
        const sessionLocation = ContextManager.resolveSessionLocation(auditLogger, {
            ...options,
            workspaceDirectory: this.workspaceDirectory,
        });
        this.sessionFile = sessionLocation.sessionFile;
        this.legacySessionFiles = sessionLocation.legacySessionFiles;
        this.onSessionPersisted = options.onSessionPersisted;
        // Initialize with current environment
        Object.entries(process.env).forEach(([key, value]) => {
            if (value !== undefined) {
                this.environmentVariables.set(key, value);
            }
        });
        // Log context manager initialization
        this.auditLogger?.notice('Context manager initialized', {
            sessionId: this.sessionId,
            currentDirectory: this.currentDirectory,
            preserveWorkingDirectory: config.preserveWorkingDirectory,
            sessionPersistence: config.sessionPersistence,
            maxHistorySize: config.maxHistorySize
        }, 'context-manager');
    }
    validateMaxHistorySize(maxHistorySize) {
        if (!Number.isInteger(maxHistorySize) || maxHistorySize < 0) {
            throw new Error('maxHistorySize must be a non-negative integer');
        }
    }
    async getCurrentContext(sessionId) {
        return {
            sessionId: sessionId || this.sessionId,
            currentDirectory: this.currentDirectory,
            workingDirectory: this.currentDirectory,
            environment: Object.fromEntries(this.environmentVariables),
            environmentVariables: Object.fromEntries(this.environmentVariables),
            commandHistory: this.commandHistory,
            outputCache: this.outputCache,
            fileSystemChanges: this.fileSystemChanges,
            previousCommands: this.commandHistory.slice(-5).map(h => h.command),
        };
    }
    async updateAfterCommand(options) {
        const { id, command, workingDirectory, environment, envOverrides, resultingEnvironment, resultingWorkingDirectory, output, aiContext, sessionId, sessionType, } = options;
        this.auditLogger?.debug('Updating context after command execution', {
            commandId: id,
            command: command.substring(0, 50),
            workingDirectory,
            envOverrides: envOverrides ? Object.keys(envOverrides) : undefined,
            sessionId,
            sessionType
        }, 'context-manager');
        // Use the state reported by the shell itself. This preserves expansions and
        // shell control-flow semantics without attempting to re-interpret the command.
        let persistedWorkingDirectory = false;
        const commandUsedScopedWorkingDirectory = path.resolve(workingDirectory) !== this.currentDirectory;
        if (this.config.preserveWorkingDirectory && output.exitCode === 0 && resultingWorkingDirectory) {
            persistedWorkingDirectory = await this.updateWorkingDirectory(workingDirectory, resultingWorkingDirectory, resultingEnvironment);
        }
        if (output.exitCode === 0 && resultingEnvironment) {
            this.updateEnvironmentVariables(resultingEnvironment, envOverrides, commandUsedScopedWorkingDirectory && !persistedWorkingDirectory);
            if (persistedWorkingDirectory) {
                this.environmentVariables.set('PWD', this.currentDirectory);
                if (this.previousDirectory) {
                    this.environmentVariables.set('OLDPWD', this.previousDirectory);
                }
            }
        }
        // Track file system changes
        await this.trackFileSystemChanges(command, workingDirectory, id);
        // Add to command history
        const historyEntry = {
            id,
            command,
            timestamp: new Date(),
            workingDirectory,
            environment,
            output,
            relatedCommands: this.findRelatedCommands(command),
            aiContext,
            sessionId,
            sessionType,
        };
        this.commandHistory.push(historyEntry);
        // Maintain history size limit
        if (this.commandHistory.length > this.config.maxHistorySize) {
            const removed = this.commandHistory.shift();
            if (removed) {
                this.outputCache.delete(removed.id);
            }
        }
        // Cache output for reference
        this.outputCache.set(id, output);
        // Persist session if configured (debounced; see flushSession)
        this.schedulePersist();
    }
    async getHistory(limit, filter) {
        let history = [...this.commandHistory];
        // Apply filter if provided
        if (filter) {
            const filterRegex = new RegExp(filter, 'i');
            history = history.filter(entry => filterRegex.test(entry.command) ||
                (entry.aiContext && filterRegex.test(entry.aiContext)));
        }
        // Apply limit
        if (limit && limit > 0) {
            history = history.slice(-limit);
        }
        return history;
    }
    async getOutput(commandId) {
        return this.outputCache.get(commandId);
    }
    async getFileSystemChanges(since) {
        if (since) {
            return this.fileSystemChanges.filter(change => change.timestamp >= since);
        }
        return [...this.fileSystemChanges];
    }
    async setWorkingDirectory(directory) {
        try {
            const resolvedDir = path.resolve(directory);
            const stats = await fs.stat(resolvedDir);
            if (stats.isDirectory()) {
                this.previousDirectory = this.currentDirectory;
                this.currentDirectory = resolvedDir;
                return true;
            }
        }
        catch (error) {
            // Directory doesn't exist or not accessible
        }
        return false;
    }
    getSessionId() {
        return this.sessionId;
    }
    async clearHistory() {
        this.commandHistory = [];
        this.outputCache.clear();
        this.fileSystemChanges = [];
        if (this.config.sessionPersistence) {
            this.persistenceDirty = true;
            await this.flushSession();
        }
    }
    /** Apply the final directory observed inside the shell. */
    async updateWorkingDirectory(commandWorkingDirectory, resultingWorkingDirectory, resultingEnvironment) {
        const resolvedDirectory = await this.canonicalDirectory(resultingWorkingDirectory);
        const commandCwd = await this.canonicalDirectory(commandWorkingDirectory);
        const currentCwd = await this.canonicalDirectory(this.currentDirectory);
        if (!resolvedDirectory || !commandCwd || !currentCwd) {
            return false;
        }
        // An explicit per-command cwd is scoped like a per-command env override. Only
        // retain it if the command actually moved away from that starting directory.
        const shouldPersist = commandCwd === currentCwd || resolvedDirectory !== commandCwd;
        if (!shouldPersist) {
            return false;
        }
        if (resolvedDirectory !== currentCwd) {
            const oldPwd = resultingEnvironment?.OLDPWD;
            this.previousDirectory = oldPwd && path.isAbsolute(oldPwd)
                ? path.resolve(oldPwd)
                : this.currentDirectory;
        }
        this.currentDirectory = resolvedDirectory;
        return true;
    }
    async isDirectory(dir) {
        try {
            return (await fs.stat(dir)).isDirectory();
        }
        catch {
            return false;
        }
    }
    async canonicalDirectory(dir) {
        try {
            const canonical = await fs.realpath(path.resolve(dir));
            return await this.isDirectory(canonical) ? canonical : undefined;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Replace persistent environment state with the shell's exported environment.
     * Per-command overrides and shell-maintained bookkeeping remain scoped.
     */
    updateEnvironmentVariables(resultingEnvironment, envOverrides, restoreWorkingDirectoryState = false) {
        const previousEnvironment = this.environmentVariables;
        const nextEnvironment = new Map(Object.entries(resultingEnvironment));
        // These values describe the short-lived shell process rather than user state.
        for (const name of ['_', 'SHLVL']) {
            const previousValue = previousEnvironment.get(name);
            if (previousValue === undefined) {
                nextEnvironment.delete(name);
            }
            else {
                nextEnvironment.set(name, previousValue);
            }
        }
        // API-level env overrides apply only to the command that received them.
        for (const name of Object.keys(envOverrides || {})) {
            const previousValue = previousEnvironment.get(name);
            if (previousValue === undefined) {
                nextEnvironment.delete(name);
            }
            else {
                nextEnvironment.set(name, previousValue);
            }
        }
        if (restoreWorkingDirectoryState) {
            for (const name of ['PWD', 'OLDPWD']) {
                const previousValue = previousEnvironment.get(name);
                if (previousValue === undefined) {
                    nextEnvironment.delete(name);
                }
                else {
                    nextEnvironment.set(name, previousValue);
                }
            }
        }
        this.environmentVariables = nextEnvironment;
    }
    async trackFileSystemChanges(command, workingDirectory, commandId) {
        // Simple heuristic-based file system change tracking
        // In a production system, this could use file system watchers
        const changePatterns = [
            { pattern: /^(touch|echo\s+.*>\s*|cat\s+.*>\s*)(.+)/, type: 'created' },
            { pattern: /^(cp|copy)\s+.+\s+(.+)/, type: 'created' },
            { pattern: /^(mv|move|ren)\s+(.+)\s+(.+)/, type: 'moved' },
            { pattern: /^(rm|del|rmdir)\s+(.+)/, type: 'deleted' },
            { pattern: /^(vim|nano|code|notepad)\s+(.+)/, type: 'modified' },
        ];
        for (const { pattern, type } of changePatterns) {
            const match = command.match(pattern);
            if (match) {
                let targetPath;
                let oldPath;
                if (type === 'moved' && match[3]) {
                    oldPath = path.resolve(workingDirectory, match[2]);
                    targetPath = path.resolve(workingDirectory, match[3]);
                }
                else {
                    targetPath = path.resolve(workingDirectory, match[match.length - 1]);
                }
                const change = {
                    type,
                    path: targetPath,
                    oldPath,
                    timestamp: new Date(),
                    commandId,
                };
                this.fileSystemChanges.push(change);
                break;
            }
        }
    }
    findRelatedCommands(command) {
        const related = [];
        const commandWords = command.toLowerCase().split(/\s+/);
        // Find commands that share common elements
        for (const entry of this.commandHistory.slice(-10)) {
            const entryWords = entry.command.toLowerCase().split(/\s+/);
            const commonWords = commandWords.filter(word => entryWords.includes(word) && word.length > 2);
            if (commonWords.length > 0) {
                related.push(entry.id);
            }
        }
        return related;
    }
    /** Resolve an isolated, stable session path and the safely scoped legacy paths. */
    static resolveSessionLocation(auditLogger, options) {
        const logFile = auditLogger?.getLogFilePath?.();
        const sessionDirectory = logFile
            ? path.dirname(logFile)
            : process.env.MCP_EXEC_LOG_DIR
                ? path.resolve(process.env.MCP_EXEC_LOG_DIR)
                : (process.env.HOME || process.env.USERPROFILE)
                    ? path.join((process.env.HOME || process.env.USERPROFILE), '.mcp-exec')
                    : os.tmpdir();
        const explicitScope = options.sessionScope || process.env.MCP_EXEC_SESSION_SCOPE;
        const scopeIdentity = explicitScope
            ? `server:${explicitScope}`
            : `workspace:${options.workspaceDirectory}\naudit:${logFile || ''}`;
        const scopeHash = (0, crypto_1.createHash)('sha256').update(scopeIdentity).digest('hex').slice(0, 16);
        return {
            sessionFile: path.join(sessionDirectory, `session-${scopeHash}.json`),
            legacySessionFiles: [
                path.join(options.workspaceDirectory, '.mcp-exec-session.json'),
                path.join(sessionDirectory, 'session.json'),
            ],
        };
    }
    /**
     * Environment variables that differ from the inherited process environment.
     * Only these are persisted -- the full process env holds the caller's secrets.
     */
    getEnvironmentOverrides() {
        const overrides = {};
        for (const [key, value] of this.environmentVariables) {
            if (process.env[key] !== value) {
                overrides[key] = redactValue(key, value);
            }
        }
        return overrides;
    }
    /** Queue a trailing, unref'd write so a burst of commands costs one file write. */
    schedulePersist() {
        if (this.disposed || !this.config.sessionPersistence) {
            return;
        }
        this.persistenceDirty = true;
        if (this.persistTimer) {
            return;
        }
        this.persistTimer = setTimeout(() => {
            this.persistTimer = undefined;
            void this.enqueuePersist();
        }, PERSIST_DEBOUNCE_MS);
        this.persistTimer.unref?.();
    }
    /** Write any dirty session state now, after all earlier publications finish. */
    async flushSession() {
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = undefined;
        }
        if (this.config.sessionPersistence && !this.disposed && this.persistenceDirty) {
            await this.enqueuePersist();
        }
        else {
            await this.persistQueue;
        }
    }
    /** Update persistence settings without orphaning timers or losing live context. */
    async updateConfig(config) {
        const wasPersistent = this.config.sessionPersistence;
        const nextConfig = { ...this.config, ...config };
        this.validateMaxHistorySize(nextConfig.maxHistorySize);
        this.config = nextConfig;
        while (this.commandHistory.length > this.config.maxHistorySize) {
            const removed = this.commandHistory.shift();
            if (removed) {
                this.outputCache.delete(removed.id);
            }
        }
        if (!this.config.sessionPersistence) {
            await this.cancelPendingPersistence();
        }
        else if (!wasPersistent) {
            this.persistenceDirty = true;
            await this.flushSession();
        }
    }
    /** Stop this manager from publishing after it has been replaced. */
    async dispose() {
        this.disposed = true;
        await this.cancelPendingPersistence();
    }
    async cancelPendingPersistence() {
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = undefined;
        }
        this.persistenceDirty = false;
        await this.persistQueue;
    }
    /** Serialize every publication and build its snapshot only when it reaches the queue. */
    enqueuePersist() {
        const write = this.persistQueue.then(async () => {
            // Configuration may have changed while this publication waited in the queue.
            if (this.disposed || !this.config.sessionPersistence || !this.persistenceDirty) {
                return;
            }
            this.persistenceDirty = false;
            await this.persistSession();
        });
        this.persistQueue = write.catch(() => undefined);
        return write;
    }
    createSessionData() {
        return {
            schemaVersion: 2,
            workspaceDirectory: this.workspaceDirectory,
            sessionId: this.sessionId,
            currentDirectory: this.currentDirectory,
            previousDirectory: this.previousDirectory,
            directoryStack: this.directoryStack,
            environmentOverrides: this.getEnvironmentOverrides(),
            commandHistory: this.commandHistory
                .slice(-PERSIST_MAX_HISTORY)
                .map(entry => ({
                id: entry.id,
                command: redactCommand(entry.command),
                timestamp: entry.timestamp,
                workingDirectory: entry.workingDirectory,
                output: {
                    stdout: (entry.output.stdout || '').slice(0, PERSIST_MAX_OUTPUT_CHARS),
                    stderr: (entry.output.stderr || '').slice(0, PERSIST_MAX_OUTPUT_CHARS),
                    exitCode: entry.output.exitCode,
                    summary: {
                        success: entry.output.summary?.success ?? entry.output.exitCode === 0,
                        mainResult: (entry.output.summary?.mainResult || '').slice(0, PERSIST_MAX_OUTPUT_CHARS),
                        sideEffects: [],
                    },
                    metadata: {
                        executionTime: entry.output.metadata?.executionTime || 0,
                        commandType: entry.output.metadata?.commandType || 'restored',
                        affectedResources: [],
                        warnings: [],
                        suggestions: [],
                    },
                },
                aiContext: entry.aiContext,
                sessionId: entry.sessionId,
                sessionType: entry.sessionType,
            })),
            fileSystemChanges: this.fileSystemChanges.slice(-PERSIST_MAX_FS_CHANGES),
            timestamp: new Date(),
        };
    }
    async persistSession() {
        try {
            const tmpFile = `${this.sessionFile}.${process.pid}.${(0, uuid_1.v4)()}.tmp`;
            await fs.mkdir(path.dirname(this.sessionFile), { recursive: true });
            await fs.writeFile(tmpFile, JSON.stringify(this.createSessionData(), null, 2));
            await fs.rename(tmpFile, this.sessionFile);
            await this.onSessionPersisted?.(this.sessionFile);
        }
        catch (error) {
            // Never disrupt (or spam stderr during) command execution because of persistence.
            this.auditLogger?.debug('Failed to persist session', {
                sessionFile: this.sessionFile,
                error: error instanceof Error ? error.message : String(error),
            }, 'context-manager');
        }
    }
    async loadSession() {
        if (!this.config.sessionPersistence || this.disposed) {
            return;
        }
        try {
            let sessionData;
            let migratedFrom;
            try {
                sessionData = JSON.parse(await fs.readFile(this.sessionFile, 'utf-8'));
            }
            catch {
                for (const legacyFile of this.legacySessionFiles) {
                    try {
                        const candidate = JSON.parse(await fs.readFile(legacyFile, 'utf-8'));
                        if (this.isLegacySessionForWorkspace(legacyFile, candidate)) {
                            sessionData = candidate;
                            migratedFrom = legacyFile;
                            break;
                        }
                    }
                    catch {
                        // Try the next legacy location.
                    }
                }
            }
            if (!sessionData) {
                return;
            }
            this.sessionId = sessionData.sessionId || this.sessionId;
            this.currentDirectory = sessionData.currentDirectory || this.currentDirectory;
            this.previousDirectory = typeof sessionData.previousDirectory === 'string'
                ? sessionData.previousDirectory
                : undefined;
            this.directoryStack = Array.isArray(sessionData.directoryStack)
                ? sessionData.directoryStack.filter((entry) => typeof entry === 'string')
                : [];
            // Merge only the recorded overrides on top of the live process environment;
            // never restore a wholesale environment snapshot (issue #31).
            if (sessionData.environmentOverrides) {
                for (const [key, value] of Object.entries(sessionData.environmentOverrides)) {
                    if (typeof value === 'string' && value !== '[REDACTED]') {
                        this.environmentVariables.set(key, value);
                    }
                }
            }
            else if (sessionData.environmentVariables) {
                // Legacy snapshots stored the whole environment. Restore only non-secret
                // values that actually differed from this process, then rewrite the slim form.
                for (const [key, value] of Object.entries(sessionData.environmentVariables)) {
                    if (typeof value === 'string' && !SECRET_KEY_PATTERN.test(key) && process.env[key] !== value) {
                        this.environmentVariables.set(key, value);
                    }
                }
            }
            if (Array.isArray(sessionData.commandHistory)) {
                this.commandHistory = sessionData.commandHistory.map((entry) => {
                    const output = entry.output || {};
                    const exitCode = typeof output.exitCode === 'number' ? output.exitCode : 1;
                    return {
                        ...entry,
                        timestamp: new Date(entry.timestamp),
                        environment: entry.environment || {},
                        relatedCommands: entry.relatedCommands || [],
                        output: {
                            stdout: output.stdout || '',
                            stderr: output.stderr || '',
                            exitCode,
                            metadata: {
                                executionTime: output.metadata?.executionTime || 0,
                                commandType: output.metadata?.commandType || 'restored',
                                affectedResources: output.metadata?.affectedResources || [],
                                warnings: output.metadata?.warnings || [],
                                suggestions: output.metadata?.suggestions || [],
                            },
                            summary: {
                                success: output.summary?.success ?? exitCode === 0,
                                mainResult: output.summary?.mainResult || (output.stdout || '').trim(),
                                sideEffects: output.summary?.sideEffects || [],
                                nextSteps: output.summary?.nextSteps,
                            },
                        },
                    };
                });
                // Rebuild the output cache so get_output works for restored entries.
                this.outputCache.clear();
                for (const entry of this.commandHistory) {
                    if (entry.output) {
                        this.outputCache.set(entry.id, entry.output);
                    }
                }
            }
            if (Array.isArray(sessionData.fileSystemChanges)) {
                this.fileSystemChanges = sessionData.fileSystemChanges.map((change) => ({
                    ...change,
                    timestamp: new Date(change.timestamp),
                }));
            }
            if (migratedFrom) {
                this.persistenceDirty = true;
                await this.flushSession();
                await fs.unlink(migratedFrom).catch(() => undefined);
            }
        }
        catch (error) {
            // Silently fail session loading - start with fresh session
        }
    }
    isLegacySessionForWorkspace(legacyFile, sessionData) {
        if (legacyFile === path.join(this.workspaceDirectory, '.mcp-exec-session.json')) {
            return true;
        }
        const recordedWorkspace = sessionData.workspaceDirectory;
        if (typeof recordedWorkspace === 'string') {
            return path.resolve(recordedWorkspace) === this.workspaceDirectory;
        }
        const recordedDirectory = sessionData.currentDirectory;
        if (typeof recordedDirectory !== 'string') {
            return false;
        }
        const relative = path.relative(this.workspaceDirectory, path.resolve(recordedDirectory));
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }
}
exports.ContextManager = ContextManager;
//# sourceMappingURL=manager.js.map