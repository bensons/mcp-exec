/**
 * Comprehensive audit logging system
 */
import { CommandOutput, CommandContext, ValidationResult, LogEntry, LogFilters, TimeRange, AuditReport } from '../types/index';
export interface AuditConfig {
    enabled: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    retention: number;
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
export declare class AuditLogger {
    private config;
    private logFile;
    private logs;
    constructor(config: AuditConfig);
    logCommand(options: LogCommandOptions): Promise<void>;
    logError(options: LogErrorOptions): Promise<void>;
    log(options: LogOptions): Promise<void>;
    queryLogs(filters: LogFilters): Promise<LogEntry[]>;
    generateReport(timeRange: TimeRange): Promise<AuditReport>;
    private initializeLogging;
    private loadExistingLogs;
    private writeLogEntry;
    private shouldLog;
    private enforceRetention;
}
//# sourceMappingURL=logger.d.ts.map