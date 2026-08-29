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
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const uuid_1 = require("uuid");
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
    constructor(config, auditLogger) {
        this.config = config;
        this.auditLogger = auditLogger;
        this.sessionId = (0, uuid_1.v4)();
        this.currentDirectory = process.cwd();
        this.environmentVariables = new Map();
        this.commandHistory = [];
        this.outputCache = new Map();
        this.fileSystemChanges = [];
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
        // Persist session if configured
        if (this.config.sessionPersistence) {
            await this.persistSession();
        }
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
            await this.persistSession();
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
        const oldPwd = resultingEnvironment?.OLDPWD;
        this.previousDirectory = oldPwd && path.isAbsolute(oldPwd)
            ? path.resolve(oldPwd)
            : this.currentDirectory;
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
    async persistSession() {
        try {
            const sessionData = {
                sessionId: this.sessionId,
                currentDirectory: this.currentDirectory,
                previousDirectory: this.previousDirectory,
                directoryStack: this.directoryStack,
                environmentVariables: Object.fromEntries(this.environmentVariables),
                commandHistory: this.commandHistory,
                fileSystemChanges: this.fileSystemChanges,
                timestamp: new Date(),
            };
            const sessionFile = path.join(process.cwd(), '.mcp-exec-session.json');
            await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2));
        }
        catch (error) {
            // Silently fail session persistence to avoid disrupting command execution
            console.warn('Failed to persist session:', error);
        }
    }
    async loadSession() {
        if (!this.config.sessionPersistence) {
            return;
        }
        try {
            const sessionFile = path.join(process.cwd(), '.mcp-exec-session.json');
            const sessionData = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));
            this.sessionId = sessionData.sessionId || this.sessionId;
            this.currentDirectory = sessionData.currentDirectory || this.currentDirectory;
            this.previousDirectory = typeof sessionData.previousDirectory === 'string'
                ? sessionData.previousDirectory
                : undefined;
            this.directoryStack = Array.isArray(sessionData.directoryStack)
                ? sessionData.directoryStack.filter((entry) => typeof entry === 'string')
                : [];
            if (sessionData.environmentVariables) {
                this.environmentVariables = new Map(Object.entries(sessionData.environmentVariables));
            }
            if (sessionData.commandHistory) {
                this.commandHistory = sessionData.commandHistory.map((entry) => ({
                    ...entry,
                    timestamp: new Date(entry.timestamp),
                }));
            }
            if (sessionData.fileSystemChanges) {
                this.fileSystemChanges = sessionData.fileSystemChanges.map((change) => ({
                    ...change,
                    timestamp: new Date(change.timestamp),
                }));
            }
        }
        catch (error) {
            // Silently fail session loading - start with fresh session
        }
    }
}
exports.ContextManager = ContextManager;
//# sourceMappingURL=manager.js.map