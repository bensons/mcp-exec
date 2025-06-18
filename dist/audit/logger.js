"use strict";
/**
 * Comprehensive audit logging system
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
exports.AuditLogger = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
class AuditLogger {
    config;
    logFile;
    logs;
    constructor(config) {
        this.config = config;
        this.logFile = path.join(process.cwd(), '.mcp-exec-audit.log');
        this.logs = [];
        if (config.enabled) {
            this.initializeLogging();
        }
    }
    async logCommand(options) {
        if (!this.config.enabled) {
            return;
        }
        const logEntry = {
            id: (0, uuid_1.v4)(),
            timestamp: new Date(),
            sessionId: options.context.sessionId,
            userId: process.env.USER || process.env.USERNAME,
            command: options.command,
            context: options.context,
            result: options.result,
            securityCheck: options.securityCheck,
            aiIntent: options.context.aiIntent,
        };
        await this.writeLogEntry(logEntry);
        this.logs.push(logEntry);
        await this.enforceRetention();
    }
    async logError(options) {
        if (!this.config.enabled) {
            return;
        }
        const errorOutput = {
            stdout: '',
            stderr: options.error.message,
            exitCode: 1,
            metadata: {
                executionTime: 0,
                commandType: 'error',
                affectedResources: [],
                warnings: [options.error.message],
                suggestions: [],
            },
            summary: {
                success: false,
                mainResult: `Error: ${options.error.message}`,
                sideEffects: [],
            },
        };
        const logEntry = {
            id: (0, uuid_1.v4)(),
            timestamp: new Date(),
            sessionId: options.context.sessionId,
            userId: process.env.USER || process.env.USERNAME,
            command: options.command,
            context: options.context,
            result: errorOutput,
            securityCheck: {
                allowed: false,
                reason: 'Command execution failed',
                riskLevel: 'medium',
            },
        };
        await this.writeLogEntry(logEntry);
        this.logs.push(logEntry);
    }
    async log(options) {
        if (!this.config.enabled) {
            return;
        }
        const shouldLog = this.shouldLog(options.level);
        if (!shouldLog) {
            return;
        }
        const logLine = {
            timestamp: new Date().toISOString(),
            level: options.level.toUpperCase(),
            message: options.message,
            context: options.context,
            pid: process.pid,
        };
        try {
            await fs.appendFile(this.logFile, JSON.stringify(logLine) + '\n');
        }
        catch (error) {
            console.error('Failed to write to audit log:', error);
        }
    }
    async queryLogs(filters) {
        let filteredLogs = [...this.logs];
        if (filters.sessionId) {
            filteredLogs = filteredLogs.filter(log => log.sessionId === filters.sessionId);
        }
        if (filters.userId) {
            filteredLogs = filteredLogs.filter(log => log.userId === filters.userId);
        }
        if (filters.command) {
            const commandRegex = new RegExp(filters.command, 'i');
            filteredLogs = filteredLogs.filter(log => commandRegex.test(log.command));
        }
        if (filters.riskLevel) {
            filteredLogs = filteredLogs.filter(log => log.securityCheck.riskLevel === filters.riskLevel);
        }
        if (filters.timeRange) {
            filteredLogs = filteredLogs.filter(log => log.timestamp >= filters.timeRange.start &&
                log.timestamp <= filters.timeRange.end);
        }
        return filteredLogs;
    }
    async generateReport(timeRange) {
        const logsInRange = await this.queryLogs({ timeRange });
        const totalCommands = logsInRange.length;
        const successfulCommands = logsInRange.filter(log => log.result.summary.success).length;
        const failedCommands = totalCommands - successfulCommands;
        const securityViolations = logsInRange.filter(log => !log.securityCheck.allowed).length;
        // Count command frequency
        const commandCounts = new Map();
        logsInRange.forEach(log => {
            const baseCommand = log.command.split(' ')[0];
            commandCounts.set(baseCommand, (commandCounts.get(baseCommand) || 0) + 1);
        });
        const topCommands = Array.from(commandCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([command, count]) => ({ command, count }));
        // Risk distribution
        const riskDistribution = {
            low: logsInRange.filter(log => log.securityCheck.riskLevel === 'low').length,
            medium: logsInRange.filter(log => log.securityCheck.riskLevel === 'medium').length,
            high: logsInRange.filter(log => log.securityCheck.riskLevel === 'high').length,
        };
        return {
            timeRange,
            totalCommands,
            successfulCommands,
            failedCommands,
            securityViolations,
            topCommands,
            riskDistribution,
        };
    }
    async initializeLogging() {
        try {
            // Ensure log file exists
            await fs.access(this.logFile);
        }
        catch {
            // Create log file if it doesn't exist
            await fs.writeFile(this.logFile, '');
        }
        // Load existing logs
        await this.loadExistingLogs();
    }
    async loadExistingLogs() {
        try {
            const logContent = await fs.readFile(this.logFile, 'utf-8');
            const lines = logContent.split('\n').filter(line => line.trim());
            for (const line of lines) {
                try {
                    const logData = JSON.parse(line);
                    if (logData.id && logData.command) {
                        // This is a command log entry
                        this.logs.push({
                            ...logData,
                            timestamp: new Date(logData.timestamp),
                        });
                    }
                }
                catch {
                    // Skip invalid log lines
                }
            }
        }
        catch {
            // No existing logs or file not readable
        }
    }
    async writeLogEntry(entry) {
        try {
            const logLine = JSON.stringify(entry) + '\n';
            await fs.appendFile(this.logFile, logLine);
        }
        catch (error) {
            console.error('Failed to write log entry:', error);
        }
    }
    shouldLog(level) {
        const levels = ['debug', 'info', 'warn', 'error'];
        const configLevelIndex = levels.indexOf(this.config.logLevel);
        const messageLevelIndex = levels.indexOf(level);
        return messageLevelIndex >= configLevelIndex;
    }
    async enforceRetention() {
        if (this.config.retention <= 0) {
            return;
        }
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.retention);
        // Remove old logs from memory
        this.logs = this.logs.filter(log => log.timestamp >= cutoffDate);
        // TODO: In a production system, implement log file rotation
        // For now, we keep all logs in the file but only recent ones in memory
    }
}
exports.AuditLogger = AuditLogger;
//# sourceMappingURL=logger.js.map