/**
 * Core type definitions for the MCP shell execution server
 */
export interface CommandOutput {
    stdout: string;
    stderr: string;
    exitCode: number;
    structuredOutput?: {
        format: 'json' | 'yaml' | 'csv' | 'table';
        data: any;
        schema?: object;
    };
    metadata: {
        executionTime: number;
        commandType: string;
        affectedResources: string[];
        warnings: string[];
        suggestions: string[];
    };
    summary: {
        success: boolean;
        mainResult: string;
        sideEffects: string[];
        nextSteps?: string[];
    };
}
export interface CommandHistoryEntry {
    id: string;
    command: string;
    timestamp: Date;
    workingDirectory: string;
    environment: Record<string, string>;
    output: CommandOutput;
    relatedCommands: string[];
    aiContext?: string;
}
export interface ContextManager {
    currentDirectory: string;
    environmentVariables: Map<string, string>;
    commandHistory: CommandHistoryEntry[];
    outputCache: Map<string, CommandOutput>;
    fileSystemChanges: FileSystemDiff[];
}
export interface FileSystemDiff {
    type: 'created' | 'modified' | 'deleted' | 'moved';
    path: string;
    oldPath?: string;
    timestamp: Date;
    commandId: string;
}
export interface ValidationResult {
    allowed: boolean;
    reason?: string;
    suggestions?: string[];
    riskLevel: 'low' | 'medium' | 'high';
}
export interface SecurityProvider {
    securityLevel: 'strict' | 'moderate' | 'permissive';
    validateCommand(command: string): ValidationResult;
    resourceLimits: {
        maxExecutionTime: number;
        maxMemoryUsage: number;
        maxFileSize: number;
        allowedDirectories: string[];
        blockedDirectories: string[];
    };
    sandboxConfig: {
        useContainer: boolean;
        networkAccess: boolean;
        fileSystemAccess: 'read-only' | 'restricted' | 'full';
        environmentIsolation: boolean;
    };
}
export interface CommandBuilder {
    executeCommand(options: {
        command: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
        timeout?: number;
        shell?: boolean | string;
    }): Promise<CommandOutput>;
    executeCommandSequence(commands: Command[]): Promise<CommandOutput[]>;
    executeTemplate(templateName: string, variables: Record<string, any>): Promise<CommandOutput>;
}
export interface Command {
    id: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    shell?: boolean | string;
    dependsOn?: string[];
}
export interface AuditLogger {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    logEntry: {
        timestamp: Date;
        sessionId: string;
        userId?: string;
        command: string;
        context: CommandContext;
        result: CommandOutput;
        securityCheck: ValidationResult;
        aiIntent?: string;
    };
    storage: {
        type: 'file' | 'database' | 'remote';
        retention: number;
        encryption: boolean;
    };
    queryLogs(filters: LogFilters): Promise<LogEntry[]>;
    generateReport(timeRange: TimeRange): Promise<AuditReport>;
}
export interface CommandContext {
    sessionId: string;
    currentDirectory: string;
    workingDirectory: string;
    environment: Record<string, string>;
    environmentVariables: Record<string, string>;
    commandHistory: CommandHistoryEntry[];
    outputCache: Map<string, CommandOutput>;
    fileSystemChanges: FileSystemDiff[];
    previousCommands: string[];
    aiIntent?: string;
}
export interface LogFilters {
    sessionId?: string;
    userId?: string;
    command?: string;
    timeRange?: TimeRange;
    riskLevel?: 'low' | 'medium' | 'high';
}
export interface TimeRange {
    start: Date;
    end: Date;
}
export interface LogEntry {
    id: string;
    timestamp: Date;
    sessionId: string;
    userId?: string;
    command: string;
    context: CommandContext;
    result: CommandOutput;
    securityCheck: ValidationResult;
    aiIntent?: string;
}
export interface AuditReport {
    timeRange: TimeRange;
    totalCommands: number;
    successfulCommands: number;
    failedCommands: number;
    securityViolations: number;
    topCommands: Array<{
        command: string;
        count: number;
    }>;
    riskDistribution: Record<'low' | 'medium' | 'high', number>;
}
export interface ServerConfig {
    security: {
        level: 'strict' | 'moderate' | 'permissive';
        confirmDangerous: boolean;
        allowedDirectories: string[];
        blockedCommands: string[];
        timeout: number;
        resourceLimits?: {
            maxMemoryUsage?: number;
            maxFileSize?: number;
            maxProcesses?: number;
        };
        sandboxing?: {
            enabled: boolean;
            networkAccess: boolean;
            fileSystemAccess: 'read-only' | 'restricted' | 'full';
        };
    };
    context: {
        preserveWorkingDirectory: boolean;
        sessionPersistence: boolean;
        maxHistorySize: number;
    };
    output: {
        formatStructured: boolean;
        stripAnsi: boolean;
        summarizeVerbose: boolean;
    };
    audit: {
        enabled: boolean;
        logLevel: 'debug' | 'info' | 'warn' | 'error';
        retention: number;
    };
}
//# sourceMappingURL=index.d.ts.map