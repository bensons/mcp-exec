/**
 * Comprehensive audit logging system
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

import {
  CommandOutput,
  CommandContext,
  ValidationResult,
  LogEntry,
  LogFilters,
  TimeRange,
  AuditReport
} from '../types/index';
import { MonitoringSystem, MonitoringConfig } from './monitoring';

export interface AuditConfig {
  enabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  retention: number;
  logFile?: string; // Full path to log file
  logDirectory?: string; // Directory for log files
  monitoring?: MonitoringConfig;
}

export interface LogCommandOptions {
  commandId: string;
  command: string;
  context: CommandContext;
  result: CommandOutput;
  securityCheck: ValidationResult;
  executionTime: number;
}

export interface LogErrorOptions {
  commandId: string;
  command: string;
  error: Error;
  context: CommandContext;
}

export interface LogOptions {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: any;
}

export class AuditLogger {
  private config: AuditConfig;
  private logFile: string;
  private logs: LogEntry[];
  private monitoringSystem?: MonitoringSystem;

  constructor(config: AuditConfig) {
    this.config = config;
    this.logFile = this.resolveLogFilePath(config);
    this.logs = [];

    if (config.enabled) {
      this.initializeLogging();
    }

    // Initialize monitoring if configured
    if (config.monitoring) {
      this.monitoringSystem = new MonitoringSystem(config.monitoring);
    }
  }

  async logCommand(options: LogCommandOptions): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const logEntry: LogEntry = {
      id: uuidv4(),
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

    // Process monitoring alerts
    if (this.monitoringSystem) {
      await this.monitoringSystem.processLogEntry(logEntry);
    }

    await this.enforceRetention();
  }

  async logError(options: LogErrorOptions): Promise<void> {
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

    const logEntry: LogEntry = {
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
    };

    await this.writeLogEntry(logEntry);
    this.logs.push(logEntry);
  }

  async log(options: LogOptions): Promise<void> {
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
    } catch (error) {
      console.error('Failed to write to audit log:', error);
    }
  }

  async queryLogs(filters: LogFilters): Promise<LogEntry[]> {
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

  private async loadExistingLogs(): Promise<void> {
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
        } catch {
          // Skip invalid log lines
        }
      }
    } catch {
      // No existing logs or file not readable
    }
  }

  private async writeLogEntry(entry: LogEntry): Promise<void> {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.logFile, logLine);
    } catch (error) {
      console.error('Failed to write log entry:', error);
    }
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    
    return messageLevelIndex >= configLevelIndex;
  }

  private async enforceRetention(): Promise<void> {
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
