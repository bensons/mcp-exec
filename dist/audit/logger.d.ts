/**
 * Comprehensive audit logging system
 */
import { CommandOutput, CommandContext, ValidationResult, LogEntry, LogFilters, TimeRange, AuditReport, LogLevel, LegacyLogLevel } from '../types/index';
import { MonitoringSystem, MonitoringConfig } from './monitoring';
export interface AuditConfig {
    enabled: boolean;
    logLevel: LogLevel | LegacyLogLevel;
    retention: number;
    logFile?: string;
    logDirectory?: string;
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
    level: LogLevel | LegacyLogLevel;
    message: string;
    context?: any;
    logger?: string;
}
export declare class AuditLogger {
    private config;
    private logFile;
    private logs;
    private monitoringSystem?;
    constructor(config: AuditConfig);
    logCommand(options: LogCommandOptions): Promise<void>;
    logError(options: LogErrorOptions): Promise<void>;
    log(options: LogOptions): Promise<void>;
    emergency(message: string, context?: any, logger?: string): Promise<void>;
    alert(message: string, context?: any, logger?: string): Promise<void>;
    critical(message: string, context?: any, logger?: string): Promise<void>;
    error(message: string, context?: any, logger?: string): Promise<void>;
    warning(message: string, context?: any, logger?: string): Promise<void>;
    notice(message: string, context?: any, logger?: string): Promise<void>;
    info(message: string, context?: any, logger?: string): Promise<void>;
    debug(message: string, context?: any, logger?: string): Promise<void>;
    queryLogs(filters: LogFilters): Promise<LogEntry[]>;
    generateReport(timeRange: TimeRange): Promise<AuditReport>;
    generateComplianceReport(timeRange: TimeRange): Promise<any>;
    exportLogs(format: 'json' | 'csv' | 'xml', filters?: LogFilters): Promise<string>;
    private exportToCsv;
    private exportToXml;
    getMonitoringSystem(): MonitoringSystem | undefined;
    getAlerts(filters?: any): import("./monitoring").Alert[];
    acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean;
    getAlertRules(): import("./monitoring").AlertRule[];
    private resolveLogFilePath;
    private isDirectoryWritable;
    getLogFilePath(): string;
    private initializeLogging;
    private getFallbackLogPath;
    private loadExistingLogs;
    private writeLogEntry;
    private shouldLog;
    private normalizeLogLevel;
    private enforceRetention;
}
//# sourceMappingURL=logger.d.ts.map