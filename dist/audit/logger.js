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
exports.parseAuditLimit = parseAuditLimit;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const index_1 = require("../types/index");
const monitoring_1 = require("./monitoring");
const redact_1 = require("./redact");
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024;
const DEFAULT_MAX_IN_MEMORY_ENTRIES = 1000;
/** Upper bound on how much of the log file tail is read at startup. */
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
/** Parse an externally supplied audit limit without allowing NaN or fractions. */
function parseAuditLimit(value, fallback) {
    if (typeof value === 'string' && value.trim() === '') {
        return fallback;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
        return fallback;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
class AuditLogger {
    config;
    logFile;
    logs;
    monitoringSystem;
    redactPatterns;
    maxOutputBytes;
    maxInMemoryEntries;
    initialization;
    constructor(config) {
        this.config = config;
        this.logFile = this.resolveLogFilePath(config);
        this.logs = [];
        this.redactPatterns = (0, redact_1.compileRedactPatterns)(config.redactPatterns);
        this.maxOutputBytes = parseAuditLimit(config.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
        this.maxInMemoryEntries = parseAuditLimit(config.maxInMemoryEntries, DEFAULT_MAX_IN_MEMORY_ENTRIES);
        this.initialization = Promise.resolve();
        if (config.enabled) {
            this.initialization = this.initializeLogging();
        }
        // Initialize monitoring if configured
        if (config.monitoring) {
            this.monitoringSystem = new monitoring_1.MonitoringSystem(config.monitoring);
        }
    }
    async logCommand(options) {
        await this.initialization;
        if (!this.config.enabled) {
            return;
        }
        const logEntry = this.sanitizeEntry({
            id: (0, uuid_1.v4)(),
            timestamp: new Date(),
            sessionId: options.context.sessionId,
            userId: process.env.USER || process.env.USERNAME,
            command: options.command,
            context: options.context,
            result: options.result,
            securityCheck: options.securityCheck,
            aiIntent: options.context.aiIntent,
        });
        await this.writeLogEntry(logEntry);
        this.appendToMemory(logEntry);
        // Process monitoring alerts
        if (this.monitoringSystem) {
            await this.monitoringSystem.processLogEntry(logEntry);
        }
        await this.enforceRetention();
    }
    async logError(options) {
        await this.initialization;
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
        const logEntry = this.sanitizeEntry({
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
        });
        await this.writeLogEntry(logEntry);
        this.appendToMemory(logEntry);
    }
    async log(options) {
        await this.initialization;
        if (!this.config.enabled) {
            return;
        }
        const shouldLog = this.shouldLog(options.level);
        if (!shouldLog) {
            return;
        }
        const normalizedLevel = this.normalizeLogLevel(options.level);
        const logLine = {
            timestamp: new Date().toISOString(),
            level: normalizedLevel.toUpperCase(),
            message: options.message,
            context: (0, redact_1.redactSecrets)(options.context, this.redactPatterns),
            logger: options.logger,
            pid: process.pid,
            severity: index_1.LOG_LEVELS[normalizedLevel], // RFC 5424 numeric severity
        };
        try {
            await fs.appendFile(this.logFile, JSON.stringify(logLine) + '\n');
        }
        catch (error) {
            console.error('Failed to write to audit log:', error);
        }
    }
    // Convenience methods for RFC 5424 log levels
    async emergency(message, context, logger) {
        return this.log({ level: 'emergency', message, context, logger });
    }
    async alert(message, context, logger) {
        return this.log({ level: 'alert', message, context, logger });
    }
    async critical(message, context, logger) {
        return this.log({ level: 'critical', message, context, logger });
    }
    async error(message, context, logger) {
        return this.log({ level: 'error', message, context, logger });
    }
    async warning(message, context, logger) {
        return this.log({ level: 'warning', message, context, logger });
    }
    async notice(message, context, logger) {
        return this.log({ level: 'notice', message, context, logger });
    }
    async info(message, context, logger) {
        return this.log({ level: 'info', message, context, logger });
    }
    async debug(message, context, logger) {
        return this.log({ level: 'debug', message, context, logger });
    }
    async queryLogs(filters) {
        await this.initialization;
        // The bounded array is only a hot cache. Reports and exports retain their
        // original full-history semantics by consulting the durable audit file.
        const logsById = new Map();
        for (const log of await this.readAllExistingLogs()) {
            logsById.set(log.id, log);
        }
        // Retain entries whose disk write failed, without duplicating persisted IDs.
        for (const log of this.logs) {
            logsById.set(log.id, log);
        }
        let filteredLogs = Array.from(logsById.values());
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
    async generateComplianceReport(timeRange) {
        const logsInRange = await this.queryLogs({ timeRange });
        // Compliance metrics
        const privilegedCommands = logsInRange.filter(log => log.command.toLowerCase().includes('sudo') ||
            log.command.toLowerCase().includes('su '));
        const fileModifications = logsInRange.filter(log => log.result.metadata.commandType === 'file-operation' &&
            (log.command.includes('rm ') || log.command.includes('mv ') || log.command.includes('cp ')));
        const networkOperations = logsInRange.filter(log => log.result.metadata.commandType === 'network-operation');
        const failedSecurityChecks = logsInRange.filter(log => !log.securityCheck.allowed);
        // User activity analysis
        const userActivity = new Map();
        logsInRange.forEach(log => {
            if (log.userId) {
                userActivity.set(log.userId, (userActivity.get(log.userId) || 0) + 1);
            }
        });
        // Session analysis
        const sessionActivity = new Map();
        logsInRange.forEach(log => {
            sessionActivity.set(log.sessionId, (sessionActivity.get(log.sessionId) || 0) + 1);
        });
        return {
            timeRange,
            summary: {
                totalCommands: logsInRange.length,
                privilegedCommands: privilegedCommands.length,
                fileModifications: fileModifications.length,
                networkOperations: networkOperations.length,
                securityViolations: failedSecurityChecks.length,
            },
            userActivity: Array.from(userActivity.entries()).map(([user, count]) => ({ user, count })),
            sessionActivity: Array.from(sessionActivity.entries()).map(([session, count]) => ({ session, count })),
            securityEvents: failedSecurityChecks.map(log => ({
                timestamp: log.timestamp,
                command: log.command,
                reason: log.securityCheck.reason,
                riskLevel: log.securityCheck.riskLevel,
                userId: log.userId,
                sessionId: log.sessionId,
            })),
            privilegedOperations: privilegedCommands.map(log => ({
                timestamp: log.timestamp,
                command: log.command,
                userId: log.userId,
                sessionId: log.sessionId,
                success: log.result.summary.success,
            })),
        };
    }
    async exportLogs(format, filters) {
        const logs = await this.queryLogs(filters || {});
        switch (format) {
            case 'json':
                return JSON.stringify(logs, null, 2);
            case 'csv':
                return this.exportToCsv(logs);
            case 'xml':
                return this.exportToXml(logs);
            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }
    exportToCsv(logs) {
        const headers = [
            'timestamp',
            'sessionId',
            'userId',
            'command',
            'exitCode',
            'riskLevel',
            'success',
            'executionTime',
            'commandType'
        ];
        const rows = logs.map(log => [
            log.timestamp.toISOString(),
            log.sessionId,
            log.userId || '',
            `"${log.command.replace(/"/g, '""')}"`,
            log.result.exitCode,
            log.securityCheck.riskLevel,
            log.result.summary.success,
            log.result.metadata.executionTime,
            log.result.metadata.commandType
        ]);
        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }
    exportToXml(logs) {
        const xmlLogs = logs.map(log => `
    <log>
      <timestamp>${log.timestamp.toISOString()}</timestamp>
      <sessionId>${log.sessionId}</sessionId>
      <userId>${log.userId || ''}</userId>
      <command><![CDATA[${log.command}]]></command>
      <exitCode>${log.result.exitCode}</exitCode>
      <riskLevel>${log.securityCheck.riskLevel}</riskLevel>
      <success>${log.result.summary.success}</success>
      <executionTime>${log.result.metadata.executionTime}</executionTime>
      <commandType>${log.result.metadata.commandType}</commandType>
    </log>`).join('');
        return `<?xml version="1.0" encoding="UTF-8"?>
<auditLogs>
  <exportDate>${new Date().toISOString()}</exportDate>
  <totalEntries>${logs.length}</totalEntries>
  <logs>${xmlLogs}
  </logs>
</auditLogs>`;
    }
    // Monitoring system access methods
    getMonitoringSystem() {
        return this.monitoringSystem;
    }
    getAlerts(filters) {
        return this.monitoringSystem?.getAlerts(filters) || [];
    }
    acknowledgeAlert(alertId, acknowledgedBy) {
        return this.monitoringSystem?.acknowledgeAlert(alertId, acknowledgedBy) || false;
    }
    getAlertRules() {
        return this.monitoringSystem?.getAlertRules() || [];
    }
    resolveLogFilePath(config) {
        // Priority order:
        // 1. Explicit logFile path in config
        // 2. Environment variable MCP_EXEC_AUDIT_LOG
        // 3. logDirectory + default filename
        // 4. Environment variable MCP_EXEC_LOG_DIR + default filename
        // 5. User home directory + default filename (safer default)
        // 6. Current working directory + default filename (fallback)
        // 7. Temp directory + default filename (final fallback)
        const defaultFilename = '.mcp-exec-audit.log';
        // 1. Explicit log file path
        if (config.logFile) {
            return path.resolve(config.logFile);
        }
        // 2. Environment variable for full log file path
        if (process.env.MCP_EXEC_AUDIT_LOG) {
            return path.resolve(process.env.MCP_EXEC_AUDIT_LOG);
        }
        // 3. Config log directory + default filename
        if (config.logDirectory) {
            return path.join(path.resolve(config.logDirectory), defaultFilename);
        }
        // 4. Environment variable for log directory + default filename
        if (process.env.MCP_EXEC_LOG_DIR) {
            return path.join(path.resolve(process.env.MCP_EXEC_LOG_DIR), defaultFilename);
        }
        // 5. Use user home directory as safer default (before trying cwd)
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        if (homeDir && this.isDirectoryWritable(homeDir)) {
            return path.join(homeDir, defaultFilename);
        }
        // 6. Try current working directory as fallback
        const cwd = process.cwd();
        if (this.isDirectoryWritable(cwd)) {
            return path.join(cwd, defaultFilename);
        }
        // 7. Final fallback: temp directory
        const tempDir = process.env.TMPDIR || process.env.TEMP || '/tmp';
        return path.join(tempDir, defaultFilename);
    }
    isDirectoryWritable(dirPath) {
        try {
            // Check if directory exists and is writable
            const stats = require('fs').statSync(dirPath);
            if (!stats.isDirectory()) {
                return false;
            }
            // Try to access with write permissions
            require('fs').accessSync(dirPath, require('fs').constants.W_OK);
            return true;
        }
        catch {
            return false;
        }
    }
    getLogFilePath() {
        return this.logFile;
    }
    async initializeLogging() {
        try {
            // Ensure log directory exists
            const logDir = path.dirname(this.logFile);
            await fs.mkdir(logDir, { recursive: true });
            // Test if we can write to the log file location
            try {
                await fs.access(this.logFile);
            }
            catch {
                // Create log file if it doesn't exist
                await fs.writeFile(this.logFile, '');
            }
            // Load existing logs
            await this.loadExistingLogs();
            // Log successful initialization to stderr (not stdout to avoid interfering with MCP protocol)
            console.error(`✅ Audit logging initialized: ${this.logFile}`);
        }
        catch (error) {
            // If we can't write to the configured location, try fallback
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`⚠️  Failed to initialize audit log at ${this.logFile}: ${errorMessage}`);
            // Try fallback location
            const fallbackPath = this.getFallbackLogPath();
            console.error(`🔄 Attempting fallback location: ${fallbackPath}`);
            this.logFile = fallbackPath;
            try {
                const fallbackDir = path.dirname(this.logFile);
                await fs.mkdir(fallbackDir, { recursive: true });
                await fs.writeFile(this.logFile, '');
                await this.loadExistingLogs();
                console.error(`✅ Audit logging initialized at fallback location: ${this.logFile}`);
            }
            catch (fallbackError) {
                const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
                console.error(`❌ Failed to initialize audit logging even at fallback location: ${fallbackErrorMessage}`);
                console.error(`🚫 Audit logging will be disabled for this session`);
                this.config.enabled = false;
            }
        }
    }
    getFallbackLogPath() {
        const defaultFilename = '.mcp-exec-audit.log';
        // Try temp directory
        const tempDir = process.env.TMPDIR || process.env.TEMP || '/tmp';
        return path.join(tempDir, defaultFilename);
    }
    /**
     * Load only the tail into the hot cache so startup cost and resident memory do
     * not grow with the lifetime of the log. Explicit queries read durable history.
     */
    async loadExistingLogs() {
        try {
            const { size } = await fs.stat(this.logFile);
            const start = Math.max(0, size - MAX_TAIL_BYTES);
            const length = size - start;
            let tail = '';
            if (length > 0) {
                const handle = await fs.open(this.logFile, 'r');
                try {
                    const buffer = Buffer.alloc(length);
                    await handle.read(buffer, 0, length, start);
                    tail = buffer.toString('utf-8');
                }
                finally {
                    await handle.close();
                }
            }
            const lines = tail.split('\n');
            if (start > 0) {
                lines.shift(); // first line is likely truncated mid-record
            }
            const entries = [];
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const logData = JSON.parse(line);
                    if (logData.id && logData.command) {
                        // This is a command log entry
                        const entry = this.normalizeEntry({
                            ...logData,
                            timestamp: new Date(logData.timestamp),
                        });
                        entries.push(entry);
                    }
                }
                catch {
                    // Skip invalid log lines
                }
            }
            this.logs.push(...entries.slice(-this.maxInMemoryEntries));
            this.trimMemory();
        }
        catch {
            // No existing logs or file not readable
        }
    }
    /** Bound output copies and redact secret-bearing values before storage or export. */
    sanitizeEntry(entry) {
        return this.normalizeEntry(entry);
    }
    normalizeEntry(entry) {
        const normalized = {
            ...entry,
            timestamp: entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp),
            result: this.truncateOutput(entry.result),
        };
        return (0, redact_1.redactSecrets)(normalized, this.redactPatterns);
    }
    /**
     * Audit entries record a bounded excerpt of stdout/stderr; the full output
     * still lives in the context output cache.
     */
    truncateOutput(result) {
        return {
            stdout: this.truncate(result.stdout),
            stderr: this.truncate(result.stderr),
            exitCode: result.exitCode,
            // Structured output and the descriptive arrays are derived copies of the
            // streams. Omitting them from audit records prevents output from escaping
            // the configured byte cap through another representation.
            metadata: {
                executionTime: result.metadata.executionTime,
                commandType: result.metadata.commandType,
                affectedResources: [],
                warnings: [],
                suggestions: [],
                ...(result.metadata.commandIntent
                    ? { commandIntent: result.metadata.commandIntent }
                    : {}),
            },
            summary: {
                success: result.summary.success,
                mainResult: '',
                sideEffects: [],
            },
        };
    }
    truncate(value) {
        if (typeof value !== 'string' || Buffer.byteLength(value, 'utf-8') <= this.maxOutputBytes) {
            return value;
        }
        const kept = Buffer.from(value, 'utf-8')
            .subarray(0, this.maxOutputBytes)
            .toString('utf-8');
        return `${kept}\n... [truncated to ${this.maxOutputBytes} bytes]`;
    }
    appendToMemory(entry) {
        this.logs.push(entry);
        this.trimMemory();
    }
    trimMemory() {
        if (this.logs.length > this.maxInMemoryEntries) {
            this.logs.splice(0, this.logs.length - this.maxInMemoryEntries);
        }
    }
    /** Read and sanitize every durable command record for explicit queries. */
    async readAllExistingLogs() {
        try {
            const logContent = await fs.readFile(this.logFile, 'utf-8');
            const entries = [];
            for (const line of logContent.split('\n')) {
                if (!line.trim())
                    continue;
                try {
                    const logData = JSON.parse(line);
                    if (logData.id && logData.command && logData.result) {
                        entries.push(this.normalizeEntry({
                            ...logData,
                            timestamp: new Date(logData.timestamp),
                        }));
                    }
                }
                catch {
                    // Skip invalid or non-command audit lines.
                }
            }
            return entries;
        }
        catch {
            return [];
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
        // Convert legacy levels to RFC 5424 levels
        const normalizedLevel = this.normalizeLogLevel(level);
        const normalizedConfigLevel = this.normalizeLogLevel(this.config.logLevel);
        // Lower numbers = higher priority in RFC 5424
        const messageLevel = index_1.LOG_LEVELS[normalizedLevel];
        const configLevel = index_1.LOG_LEVELS[normalizedConfigLevel];
        return messageLevel <= configLevel;
    }
    normalizeLogLevel(level) {
        // Convert legacy levels to RFC 5424 equivalents
        switch (level) {
            case 'warn': return 'warning';
            case 'debug': return 'debug';
            case 'info': return 'info';
            case 'error': return 'error';
            // RFC 5424 levels pass through unchanged
            case 'emergency':
            case 'alert':
            case 'critical':
            case 'warning':
            case 'notice':
                return level;
            default:
                return 'info'; // Safe default
        }
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