/**
 * Core type definitions for the MCP shell execution server
 */

export interface CommandOutput {
  // Standard streams
  stdout: string;
  stderr: string;
  exitCode: number;
  
  // Structured data when available
  structuredOutput?: {
    format: 'json' | 'yaml' | 'csv' | 'table';
    data: any;
    schema?: object;
  };
  
  // Metadata for AI understanding
  metadata: {
    executionTime: number;
    commandType: string; // 'file-operation', 'process-management', etc.
    affectedResources: string[];
    warnings: string[];
    suggestions: string[];
    commandIntent?: {
      category: string;
      purpose: string;
      confidence: number;
      relatedCommands: string[];
      suggestedFollowups: string[];
    };
  };
  
  // AI-friendly summary
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
  relatedCommands: string[]; // IDs of related commands
  aiContext?: string; // The AI's intent/reason for the command
}

export interface ContextManager {
  // Preserve working directory between commands
  currentDirectory: string;
  
  // Track environment variables across session
  environmentVariables: Map<string, string>;
  
  // Maintain command history with relationships
  commandHistory: CommandHistoryEntry[];
  
  // Store output from previous commands for reference
  outputCache: Map<string, CommandOutput>;
  
  // Track file system changes
  fileSystemChanges: FileSystemDiff[];
}

export interface FileSystemDiff {
  type: 'created' | 'modified' | 'deleted' | 'moved';
  path: string;
  oldPath?: string; // for moves
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
  // Configure security levels
  securityLevel: 'strict' | 'moderate' | 'permissive';
  
  // Command validation before execution
  validateCommand(command: string): ValidationResult;
  
  // Resource limits
  resourceLimits: {
    maxExecutionTime: number;
    maxMemoryUsage: number;
    maxFileSize: number;
    allowedDirectories: string[];
    blockedDirectories: string[];
  };
  
  // Sandboxing options
  sandboxConfig: {
    useContainer: boolean;
    networkAccess: boolean;
    fileSystemAccess: 'read-only' | 'restricted' | 'full';
    environmentIsolation: boolean;
  };
}

export interface CommandBuilder {
  // Single command execution with full options
  executeCommand(options: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    shell?: boolean | string;
  }): Promise<CommandOutput>;
  
  // Multiple command execution with dependencies
  executeCommandSequence(commands: Command[]): Promise<CommandOutput[]>;
  
  // Command template system
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
  dependsOn?: string[]; // IDs of commands that must complete first
}

export interface AuditLogger {
  // Log levels
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  
  // Log entry structure
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
  
  // Storage options
  storage: {
    type: 'file' | 'database' | 'remote';
    retention: number; // days
    encryption: boolean;
  };
  
  // Query interface
  queryLogs(filters: LogFilters): Promise<LogEntry[]>;
  
  // Analytics
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
  topCommands: Array<{ command: string; count: number }>;
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
      maxMemoryUsage?: number; // in MB
      maxFileSize?: number; // in MB
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
    enableAiOptimizations: boolean;
    maxOutputLength: number;
  };
  audit: {
    enabled: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    retention: number;
    logFile?: string; // Full path to log file
    logDirectory?: string; // Directory for log files
    monitoring?: {
      enabled: boolean;
      alertRetention: number;
      maxAlertsPerHour: number;
      webhookUrl?: string;
      emailNotifications?: {
        enabled: boolean;
        recipients: string[];
        smtpConfig?: any;
      };
    };
  };
}
