/**
 * Comprehensive audit logging system
 */
import { CommandOutput, AuditContext, ValidationResult, LogEntry, LogFilters, TimeRange, AuditReport, LogLevel, LegacyLogLevel } from '../types/index';
import { MonitoringSystem, MonitoringConfig } from './monitoring';
/** Parse an externally supplied audit limit without allowing NaN or fractions. */
export declare function parseAuditLimit(value: unknown, fallback: number): number;
export interface AuditConfig {
    enabled: boolean;
    logLevel: LogLevel | LegacyLogLevel;
    retention: number;
    logFile?: string;
    logDirectory?: string;
    maxPendingWriteBytes?: number;
    maxOutputBytes?: number;
    maxInMemoryEntries?: number;
    redactPatterns?: string[];
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
    logger?: string;
}
export declare class AuditLogger {
    private config;
    private logFile;
    private logs;
    private monitoringSystem?;
    private maintenanceTimer?;
    private pendingLines;
    private pendingWriteBytes;
    private drainPromise?;
    private closed;
    private maxPendingWriteBytes;
    private lastQueueWarningAt;
    private redactPatterns;
    private maxOutputBytes;
    private maxInMemoryEntries;
    private initialization;
    constructor(config: AuditConfig);
    private startMaintenance;
    private stopMaintenance;
    private writeLine;
    private startDrain;
    private drainWrites;
    /**
     * Wait for all accepted records to reach storage.
     */
    flush(): Promise<void>;
    /**
     * Stop maintenance and reject future records after draining accepted writes.
     */
    close(): Promise<void>;
    /**
     * Apply configuration changes in place. Callers must use this instead of
     * constructing a replacement logger, otherwise components that captured this
     * instance (ShellExecutor, SecurityManager, ContextManager) keep writing to
     * the old logger and its entries never reach the reporting tools.
     *
     * The log file is only reopened (and re-read) when logging is newly enabled
     * or the resolved path actually changed.
     */
    updateConfig(config: Partial<AuditConfig>): void;
    private cloneConfig;
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
    /**
     * Load only the tail into the hot cache so startup cost and resident memory do
     * not grow with the lifetime of the log. Explicit queries read durable history.
     */
    private loadExistingLogs;
    /** Bound output copies and redact secret-bearing values before storage or export. */
    private sanitizeEntry;
    private normalizeEntry;
    /**
     * Audit entries record a bounded excerpt of stdout/stderr; the full output
     * still lives in the context output cache.
     */
    private truncateOutput;
    private truncate;
    private appendToMemory;
    private trimMemory;
    /** Read and sanitize every durable command record for explicit queries. */
    private readAllExistingLogs;
    private writeLogEntry;
    private writeSerialized;
    private shouldLog;
    private normalizeLogLevel;
    private enforceRetention;
}
//# sourceMappingURL=logger.d.ts.map