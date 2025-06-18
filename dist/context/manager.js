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
    environmentVariables;
    commandHistory;
    outputCache;
    fileSystemChanges;
    constructor(config) {
        this.config = config;
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
        const { id, command, workingDirectory, environment, output, aiContext } = options;
        // Update working directory if command changed it
        if (this.config.preserveWorkingDirectory) {
            await this.updateWorkingDirectory(command, workingDirectory, output);
        }
        // Update environment variables
        this.updateEnvironmentVariables(environment);
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
    async updateWorkingDirectory(command, currentWorkingDir, output) {
        // Check if command was a directory change
        const cdMatch = command.match(/^cd\s+(.+)$/i);
        if (cdMatch && output.exitCode === 0) {
            const targetDir = cdMatch[1].trim().replace(/['"]/g, '');
            try {
                let newDir;
                // Handle special directory shortcuts
                if (targetDir === '~') {
                    newDir = process.env.HOME || process.env.USERPROFILE || currentWorkingDir;
                }
                else if (targetDir === '-') {
                    // Previous directory - for now, just keep current
                    return;
                }
                else if (targetDir === '..') {
                    newDir = path.dirname(currentWorkingDir);
                }
                else if (targetDir === '.') {
                    newDir = currentWorkingDir;
                }
                else if (path.isAbsolute(targetDir)) {
                    newDir = targetDir;
                }
                else {
                    newDir = path.resolve(currentWorkingDir, targetDir);
                }
                // Verify directory exists
                const stats = await fs.stat(newDir);
                if (stats.isDirectory()) {
                    this.currentDirectory = newDir;
                }
            }
            catch (error) {
                // Directory doesn't exist or not accessible, keep current directory
            }
        }
        // Also check for pushd/popd commands
        const pushdMatch = command.match(/^pushd\s+(.+)$/i);
        if (pushdMatch && output.exitCode === 0) {
            const targetDir = pushdMatch[1].trim().replace(/['"]/g, '');
            await this.setWorkingDirectory(path.resolve(currentWorkingDir, targetDir));
        }
    }
    updateEnvironmentVariables(environment) {
        // Update environment variables that may have changed
        Object.entries(environment).forEach(([key, value]) => {
            this.environmentVariables.set(key, value);
        });
        // Look for export/set commands in recent history to track variable changes
        const recentCommands = this.commandHistory.slice(-5);
        for (const entry of recentCommands) {
            this.extractEnvironmentChanges(entry.command);
        }
    }
    extractEnvironmentChangesFromCommand(command) {
        const changes = {};
        // Extract environment variables from the current command
        this.extractEnvironmentChanges(command);
        // Return the changes that were made
        return changes;
    }
    extractEnvironmentChanges(command) {
        // Unix-style export with value
        const exportMatch = command.match(/export\s+(\w+)=(.+)/i);
        if (exportMatch) {
            const [, key, value] = exportMatch;
            this.environmentVariables.set(key, value.replace(/['"]/g, ''));
            return;
        }
        // Unix-style export without value (exports existing variable)
        const exportOnlyMatch = command.match(/export\s+(\w+)$/i);
        if (exportOnlyMatch) {
            const [, key] = exportOnlyMatch;
            // Keep existing value if it exists
            if (!this.environmentVariables.has(key) && process.env[key]) {
                this.environmentVariables.set(key, process.env[key]);
            }
            return;
        }
        // Windows-style set
        const setMatch = command.match(/set\s+(\w+)=(.+)/i);
        if (setMatch) {
            const [, key, value] = setMatch;
            this.environmentVariables.set(key, value.replace(/['"]/g, ''));
            return;
        }
        // Inline variable assignment (VAR=value command)
        const inlineMatch = command.match(/^(\w+)=(.+?)\s+/);
        if (inlineMatch) {
            const [, key, value] = inlineMatch;
            this.environmentVariables.set(key, value.replace(/['"]/g, ''));
            return;
        }
        // Multiple inline assignments
        const multipleInlineMatches = command.match(/^((?:\w+=\S+\s+)+)/);
        if (multipleInlineMatches) {
            const assignments = multipleInlineMatches[1];
            const assignmentPattern = /(\w+)=(\S+)/g;
            let match;
            while ((match = assignmentPattern.exec(assignments)) !== null) {
                const [, key, value] = match;
                this.environmentVariables.set(key, value.replace(/['"]/g, ''));
            }
        }
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