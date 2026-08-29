/**
 * Comprehensive audit logging system
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

import {
  CommandOutput,
  AuditContext,
  ValidationResult,
  LogEntry,
  LogFilters,
  TimeRange,
  AuditReport,
  LogLevel,
  LegacyLogLevel,
  LOG_LEVELS
} from '../types/index';
import { MonitoringSystem, MonitoringConfig } from './monitoring';
import { compileRedactPatterns, redactSecrets } from './redact';

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024;
const DEFAULT_MAX_IN_MEMORY_ENTRIES = 1000;
/** Upper bound on how much of the log file tail is read at startup. */
const MAX_TAIL_BYTES = 4 * 1024 * 1024;

/** Parse an externally supplied audit limit without allowing NaN or fractions. */
export function parseAuditLimit(value: unknown, fallback: number): number {
  if (typeof value === 'string' && value.trim() === '') {
    return fallback;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface AuditConfig {
  enabled: boolean;
  logLevel: LogLevel | LegacyLogLevel; // Support both RFC 5424 and legacy levels
  retention: number;
  logFile?: string; // Full path to log file
  logDirectory?: string; // Directory for log files
  maxPendingWriteBytes?: number; // Bound memory used by queued audit writes
  maxOutputBytes?: number; // truncate stdout/stderr in audit entries (default 4096)
  maxInMemoryEntries?: number; // cap on entries kept in memory (default 1000)
  redactPatterns?: string[]; // key patterns whose values are redacted before writing
  monitoring?: MonitoringConfig;
}

export interface LogCommandOptions {
  commandId: string;
  command: string;
  context: AuditContext;
  result: CommandOutput;
  securityCheck: ValidationResult;
  executionTime: number;
}

export interface LogErrorOptions {
  commandId: string;
  command: string;
  error: Error;
  context: AuditContext;
}

export interface LogOptions {
  level: LogLevel | LegacyLogLevel;
  message: string;
  context?: any;
  logger?: string; // Optional logger name for categorization
}

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000; // hourly
const DEFAULT_MAX_PENDING_WRITE_BYTES = 8 * 1024 * 1024;
const MAX_WRITE_BATCH_BYTES = 64 * 1024;
const QUEUE_WARNING_INTERVAL_MS = 60 * 1000;

export class AuditLogger {
  private config: AuditConfig;
  private logFile: string;
  private logs: LogEntry[];
  private monitoringSystem?: MonitoringSystem;
  private maintenanceTimer?: NodeJS.Timeout;
  private pendingLines: Array<{ line: string; bytes: number }> = [];
  private pendingWriteBytes = 0;
  private drainPromise?: Promise<void>;
  private closed = false;
  private maxPendingWriteBytes: number;
  private lastQueueWarningAt = 0;
  private redactPatterns: RegExp[];
  private maxOutputBytes: number;
  private maxInMemoryEntries: number;
  private initialization: Promise<void>;

  constructor(config: AuditConfig) {
    this.config = this.cloneConfig(config);
    this.logFile = this.resolveLogFilePath(this.config);
    this.logs = [];
    this.maxPendingWriteBytes = Number.isFinite(config.maxPendingWriteBytes) &&
      (config.maxPendingWriteBytes ?? 0) > 0
      ? config.maxPendingWriteBytes!
      : DEFAULT_MAX_PENDING_WRITE_BYTES;
    this.redactPatterns = compileRedactPatterns(config.redactPatterns);
    this.maxOutputBytes = parseAuditLimit(config.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
    this.maxInMemoryEntries = parseAuditLimit(
      config.maxInMemoryEntries,
      DEFAULT_MAX_IN_MEMORY_ENTRIES
    );
    this.initialization = Promise.resolve();

    if (this.config.enabled) {
      this.initialization = this.initializeLogging();
    }

    // Initialize monitoring if configured
    if (this.config.monitoring) {
      this.monitoringSystem = new MonitoringSystem(this.config.monitoring);
    }

    if (this.config.enabled) {
      this.startMaintenance();
    }
  }

  private startMaintenance(): void {
    if (this.maintenanceTimer || this.closed) {
      return;
    }
    // Retention/alert pruning used to run on every command; do it on a timer instead.
    this.maintenanceTimer = setInterval(() => {
      this.enforceRetention();
      this.monitoringSystem?.cleanup();
    }, MAINTENANCE_INTERVAL_MS);
    this.maintenanceTimer.unref();
  }

  private stopMaintenance(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
  }

  private writeLine(line: string): void {
    if (this.closed || !this.config.enabled) {
      return;
    }

    const bytes = Buffer.byteLength(line);
    if (bytes > this.maxPendingWriteBytes ||
        this.pendingWriteBytes + bytes > this.maxPendingWriteBytes) {
      const now = Date.now();
      if (now - this.lastQueueWarningAt >= QUEUE_WARNING_INTERVAL_MS) {
        this.lastQueueWarningAt = now;
        console.error(
          `Audit write queue reached ${this.maxPendingWriteBytes} bytes; dropping records until storage catches up`
        );
      }
      return;
    }

    this.pendingLines.push({ line, bytes });
    this.pendingWriteBytes += bytes;
    this.startDrain();
  }

  private startDrain(): void {
    if (this.drainPromise || this.pendingLines.length === 0) {
      return;
    }

    this.drainPromise = this.drainWrites().finally(() => {
      this.drainPromise = undefined;
      if (this.pendingLines.length > 0) {
        this.startDrain();
      }
    });
  }

  private async drainWrites(): Promise<void> {
    await this.initialization;

    while (this.pendingLines.length > 0) {
      const batch: Array<{ line: string; bytes: number }> = [];
      let batchBytes = 0;

      while (this.pendingLines.length > 0) {
        const next = this.pendingLines[0];
        if (batch.length > 0 && batchBytes + next.bytes > MAX_WRITE_BATCH_BYTES) {
          break;
        }
        batch.push(this.pendingLines.shift()!);
        batchBytes += next.bytes;
      }

      try {
        if (this.config.enabled) {
          // Open the configured path for every bounded batch. This preserves
          // ordering without holding an inode open across external rotation.
          await fs.appendFile(this.logFile, batch.map(item => item.line).join(''));
        }
      } catch (error) {
        console.error('Failed to write to audit log:', error);
      } finally {
        this.pendingWriteBytes = Math.max(0, this.pendingWriteBytes - batchBytes);
      }
    }
  }

  /**
   * Wait for all accepted records to reach storage.
   */
  async flush(): Promise<void> {
    await this.initialization;
    while (this.drainPromise || this.pendingLines.length > 0) {
      this.startDrain();
      await this.drainPromise;
    }
  }

  /**
   * Stop maintenance and reject future records after draining accepted writes.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.stopMaintenance();
    await this.flush();
  }

  /**
   * Apply configuration changes in place. Callers must use this instead of
   * constructing a replacement logger, otherwise components that captured this
   * instance (ShellExecutor, SecurityManager, ContextManager) keep writing to
   * the old logger and its entries never reach the reporting tools.
   *
   * The log file is only reopened (and re-read) when logging is newly enabled
   * or the resolved path actually changed.
   */
  updateConfig(config: Partial<AuditConfig>): void {
    const previousLogFile = this.logFile;
    const wasEnabled = this.config.enabled;
    const hasMonitoringUpdate = Object.prototype.hasOwnProperty.call(config, 'monitoring');

    this.config = this.cloneConfig({
      ...this.config,
      ...config,
      monitoring: hasMonitoringUpdate ? config.monitoring : this.config.monitoring,
    });
    this.redactPatterns = compileRedactPatterns(this.config.redactPatterns);
    this.maxOutputBytes = parseAuditLimit(
      this.config.maxOutputBytes,
      DEFAULT_MAX_OUTPUT_BYTES
    );
    this.maxInMemoryEntries = parseAuditLimit(
      this.config.maxInMemoryEntries,
      DEFAULT_MAX_IN_MEMORY_ENTRIES
    );
    this.maxPendingWriteBytes = Number.isFinite(this.config.maxPendingWriteBytes) &&
      (this.config.maxPendingWriteBytes ?? 0) > 0
      ? this.config.maxPendingWriteBytes!
      : DEFAULT_MAX_PENDING_WRITE_BYTES;

    if (!this.config.monitoring) {
      this.monitoringSystem = undefined;
    } else if (!this.monitoringSystem) {
      this.monitoringSystem = new MonitoringSystem(this.config.monitoring);
    } else {
      this.monitoringSystem.updateConfig(this.config.monitoring);
    }

    this.logFile = this.resolveLogFilePath(this.config);

    if (this.config.enabled && (!wasEnabled || this.logFile !== previousLogFile)) {
      this.logs = [];
      this.initialization = this.initializeLogging();
    }

    if (this.config.enabled) {
      this.startMaintenance();
    } else {
      this.stopMaintenance();
    }
  }

  private cloneConfig(config: AuditConfig): AuditConfig {
    return {
      ...config,
      monitoring: config.monitoring
        ? {
            ...config.monitoring,
            emailNotifications: config.monitoring.emailNotifications
              ? {
                  ...config.monitoring.emailNotifications,
                  recipients: [...config.monitoring.emailNotifications.recipients],
                  smtpConfig: config.monitoring.emailNotifications.smtpConfig
                    ? { ...config.monitoring.emailNotifications.smtpConfig }
                    : config.monitoring.emailNotifications.smtpConfig,
                }
              : undefined,
            desktopNotifications: config.monitoring.desktopNotifications
              ? { ...config.monitoring.desktopNotifications }
              : undefined,
          }
        : undefined,
    };
  }

  async logCommand(options: LogCommandOptions): Promise<void> {
    await this.initialization;
    if (!this.config.enabled) {
      return;
    }

    const logEntry: LogEntry = this.sanitizeEntry({
      id: uuidv4(),
      timestamp: new Date(),
      sessionId: options.context.sessionId,
      userId: process.env.USER || process.env.USERNAME,
      command: options.command,
      context: options.context,
      result: options.result,
      securityCheck: options.securityCheck,
      aiIntent: options.context.aiIntent,
    });

    this.writeLogEntry(logEntry);
    this.appendToMemory(logEntry);
    // Command records are the durable audit trail. Callers already await this
    // method, so preserve that contract while lower-priority log lines drain in
    // the same bounded queue.
    await this.flush();

    // Process monitoring alerts (notifications are dispatched in the background)
    if (this.monitoringSystem) {
      await this.monitoringSystem.processLogEntry(logEntry);
    }
  }

  async logError(options: LogErrorOptions): Promise<void> {
    await this.initialization;
    if (!this.config.enabled) {
      return;
    }

    const errorOutput: CommandOutput = {
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

    const logEntry: LogEntry = this.sanitizeEntry({
      id: uuidv4(),
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

    this.writeLogEntry(logEntry);
    this.appendToMemory(logEntry);
    await this.flush();
  }

  async log(options: LogOptions): Promise<void> {
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
      context: redactSecrets(options.context, this.redactPatterns),
      logger: options.logger,
      pid: process.pid,
      severity: LOG_LEVELS[normalizedLevel], // RFC 5424 numeric severity
    };

    this.writeSerialized(logLine, 'audit log entry');
  }

  // Convenience methods for RFC 5424 log levels
  async emergency(message: string, context?: any, logger?: string): Promise<void> {
    return this.log({ level: 'emergency', message, context, logger });
  }

  async alert(message: string, context?: any, logger?: string): Promise<void> {
    return this.log({ level: 'alert', message, context, logger });
  }

  async critical(message: string, context?: any, logger?: string): Promise<void> {
    return this.log({ level: 'critical', message, context, logger });
  }

  async error(message: string, context?: any, logger?: string): Promise<void> {
    return this.log({ level: 'error', message, context, logger });
  }

  async warning(message: string, context?: any, logger?: string): Promise<void> {
    return this.log({ level: 'warning', message, context, logger });
  }

  async notice(message: string, context?: any, logger?: string): Promise<void> {
    return this.log({ level: 'notice', message, context, logger });
  }

  async info(message: string, context?: any, logger?: string): Promise<void> {
    return this.log({ level: 'info', message, context, logger });
  }

  async debug(message: string, context?: any, logger?: string): Promise<void> {
    return this.log({ level: 'debug', message, context, logger });
  }

  async queryLogs(filters: LogFilters): Promise<LogEntry[]> {
    await this.initialization;

    // The bounded array is only a hot cache. Reports and exports retain their
    // original full-history semantics by consulting the durable audit file.
    const logsById = new Map<string, LogEntry>();
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
      filteredLogs = filteredLogs.filter(log => 
        log.timestamp >= filters.timeRange!.start && 
        log.timestamp <= filters.timeRange!.end
      );
    }

    return filteredLogs;
  }

  async generateReport(timeRange: TimeRange): Promise<AuditReport> {
    const logsInRange = await this.queryLogs({ timeRange });

    const totalCommands = logsInRange.length;
    const successfulCommands = logsInRange.filter(log => log.result.summary.success).length;
    const failedCommands = totalCommands - successfulCommands;
    const securityViolations = logsInRange.filter(log => !log.securityCheck.allowed).length;

    // Count command frequency
    const commandCounts = new Map<string, number>();
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

  async generateComplianceReport(timeRange: TimeRange): Promise<any> {
    const logsInRange = await this.queryLogs({ timeRange });

    // Compliance metrics
    const privilegedCommands = logsInRange.filter(log =>
      log.command.toLowerCase().includes('sudo') ||
      log.command.toLowerCase().includes('su ')
    );

    const fileModifications = logsInRange.filter(log =>
      log.result.metadata.commandType === 'file-operation' &&
      (log.command.includes('rm ') || log.command.includes('mv ') || log.command.includes('cp '))
    );

    const networkOperations = logsInRange.filter(log =>
      log.result.metadata.commandType === 'network-operation'
    );

    const failedSecurityChecks = logsInRange.filter(log =>
      !log.securityCheck.allowed
    );

    // User activity analysis
    const userActivity = new Map<string, number>();
    logsInRange.forEach(log => {
      if (log.userId) {
        userActivity.set(log.userId, (userActivity.get(log.userId) || 0) + 1);
      }
    });

    // Session analysis
    const sessionActivity = new Map<string, number>();
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

  async exportLogs(format: 'json' | 'csv' | 'xml', filters?: LogFilters): Promise<string> {
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

  private exportToCsv(logs: LogEntry[]): string {
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

  private exportToXml(logs: LogEntry[]): string {
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
  getMonitoringSystem(): MonitoringSystem | undefined {
    return this.monitoringSystem;
  }

  getAlerts(filters?: any) {
    return this.monitoringSystem?.getAlerts(filters) || [];
  }

  acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    return this.monitoringSystem?.acknowledgeAlert(alertId, acknowledgedBy) || false;
  }

  getAlertRules() {
    return this.monitoringSystem?.getAlertRules() || [];
  }

  private resolveLogFilePath(config: AuditConfig): string {
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

  private isDirectoryWritable(dirPath: string): boolean {
    try {
      // Check if directory exists and is writable
      const stats = require('fs').statSync(dirPath);
      if (!stats.isDirectory()) {
        return false;
      }

      // Try to access with write permissions
      require('fs').accessSync(dirPath, require('fs').constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  getLogFilePath(): string {
    return this.logFile;
  }

  private async initializeLogging(): Promise<void> {
    try {
      // Ensure log directory exists
      const logDir = path.dirname(this.logFile);
      await fs.mkdir(logDir, { recursive: true });

      // Test if we can write to the log file location
      try {
        await fs.access(this.logFile);
      } catch {
        // Create log file if it doesn't exist
        await fs.writeFile(this.logFile, '');
      }

      // Load existing logs
      await this.loadExistingLogs();

      // Log successful initialization to stderr (not stdout to avoid interfering with MCP protocol)
      console.error(`✅ Audit logging initialized: ${this.logFile}`);

    } catch (error) {
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
      } catch (fallbackError) {
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
        console.error(`❌ Failed to initialize audit logging even at fallback location: ${fallbackErrorMessage}`);
        console.error(`🚫 Audit logging will be disabled for this session`);
        this.config.enabled = false;
      }
    }
  }

  private getFallbackLogPath(): string {
    const defaultFilename = '.mcp-exec-audit.log';

    // Try temp directory
    const tempDir = process.env.TMPDIR || process.env.TEMP || '/tmp';
    return path.join(tempDir, defaultFilename);
  }

  /**
   * Load only the tail into the hot cache so startup cost and resident memory do
   * not grow with the lifetime of the log. Explicit queries read durable history.
   */
  private async loadExistingLogs(): Promise<void> {
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
        } finally {
          await handle.close();
        }
      }

      const lines = tail.split('\n');
      if (start > 0) {
        lines.shift(); // first line is likely truncated mid-record
      }

      const entries: LogEntry[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
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
        } catch {
          // Skip invalid log lines
        }
      }

      this.logs.push(...entries.slice(-this.maxInMemoryEntries));
      this.trimMemory();
    } catch {
      // No existing logs or file not readable
    }
  }

  /** Bound output copies and redact secret-bearing values before storage or export. */
  private sanitizeEntry(entry: LogEntry): LogEntry {
    return this.normalizeEntry(entry);
  }

  private normalizeEntry(entry: LogEntry): LogEntry {
    const normalized = {
      ...entry,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp),
      result: this.truncateOutput(entry.result),
    };
    return redactSecrets(normalized, this.redactPatterns);
  }

  /**
   * Audit entries record a bounded excerpt of stdout/stderr; the full output
   * still lives in the context output cache.
   */
  private truncateOutput(result: CommandOutput): CommandOutput {
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

  private truncate(value: string): string {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf-8') <= this.maxOutputBytes) {
      return value;
    }
    const kept = Buffer.from(value, 'utf-8')
      .subarray(0, this.maxOutputBytes)
      .toString('utf-8');
    return `${kept}\n... [truncated to ${this.maxOutputBytes} bytes]`;
  }

  private appendToMemory(entry: LogEntry): void {
    this.logs.push(entry);
    this.trimMemory();
  }

  private trimMemory(): void {
    if (this.logs.length > this.maxInMemoryEntries) {
      this.logs.splice(0, this.logs.length - this.maxInMemoryEntries);
    }
  }

  /** Read and sanitize every durable command record for explicit queries. */
  private async readAllExistingLogs(): Promise<LogEntry[]> {
    try {
      const logContent = await fs.readFile(this.logFile, 'utf-8');
      const entries: LogEntry[] = [];

      for (const line of logContent.split('\n')) {
        if (!line.trim()) continue;
        try {
          const logData = JSON.parse(line);
          if (logData.id && logData.command && logData.result) {
            entries.push(this.normalizeEntry({
              ...logData,
              timestamp: new Date(logData.timestamp),
            }));
          }
        } catch {
          // Skip invalid or non-command audit lines.
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  private writeLogEntry(entry: LogEntry): void {
    this.writeSerialized(entry, 'command audit entry');
  }

  private writeSerialized(value: unknown, description: string): void {
    try {
      this.writeLine(JSON.stringify(value) + '\n');
    } catch (error) {
      console.error(`Failed to serialize ${description}:`, error);
    }
  }

  private shouldLog(level: LogLevel | LegacyLogLevel): boolean {
    // Convert legacy levels to RFC 5424 levels
    const normalizedLevel = this.normalizeLogLevel(level);
    const normalizedConfigLevel = this.normalizeLogLevel(this.config.logLevel);

    // Lower numbers = higher priority in RFC 5424
    const messageLevel = LOG_LEVELS[normalizedLevel];
    const configLevel = LOG_LEVELS[normalizedConfigLevel];

    return messageLevel <= configLevel;
  }

  private normalizeLogLevel(level: LogLevel | LegacyLogLevel): LogLevel {
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

  private enforceRetention(): void {
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
