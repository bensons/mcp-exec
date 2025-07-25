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
  sessionId?: string; // ID of interactive session if applicable
  sessionType?: 'start' | 'input' | 'kill'; // Type of session operation
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

// RFC 5424 Syslog Severity Levels
export type LogLevel =
  | 'emergency'    // 0: System is unusable
  | 'alert'        // 1: Action must be taken immediately
  | 'critical'     // 2: Critical conditions
  | 'error'        // 3: Error conditions
  | 'warning'      // 4: Warning conditions
  | 'notice'       // 5: Normal but significant condition
  | 'info'         // 6: Informational messages
  | 'debug';       // 7: Debug-level messages

// Legacy log levels for backward compatibility
export type LegacyLogLevel = 'debug' | 'info' | 'warn' | 'error';

// Log level numeric values (RFC 5424)
export const LOG_LEVELS: Record<LogLevel, number> = {
  emergency: 0,
  alert: 1,
  critical: 2,
  error: 3,
  warning: 4,
  notice: 5,
  info: 6,
  debug: 7
};

// MCP Log Message for client notifications
export interface MCPLogMessage {
  level: LogLevel;
  logger?: string;
  data: any;
}

export interface AuditLogger {
  // Log levels (updated to support RFC 5424)
  logLevel: LogLevel;

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
  sessions: {
    maxInteractiveSessions: number; // Maximum number of concurrent interactive sessions
    sessionTimeout: number; // Session timeout in milliseconds
    outputBufferSize: number; // Maximum lines to buffer per session
  };
  lifecycle: {
    inactivityTimeout: number; // milliseconds before shutdown due to inactivity
    gracefulShutdownTimeout: number; // milliseconds to wait for graceful shutdown
    enableHeartbeat: boolean; // whether to enable heartbeat monitoring
  };
  output: {
    formatStructured: boolean;
    stripAnsi: boolean;
    summarizeVerbose: boolean;
    enableAiOptimizations: boolean;
    maxOutputLength: number;
  };
  display: {
    showCommandHeader: boolean;
    showExecutionTime: boolean;
    showExitCode: boolean;
    formatCodeBlocks: boolean;
    includeMetadata: boolean;
    includeSuggestions: boolean;
    useMarkdown: boolean;
    colorizeOutput: boolean;
  };
  audit: {
    enabled: boolean;
    logLevel: LogLevel | LegacyLogLevel;
    retention: number;
    logFile?: string; // Full path to log file
    logDirectory?: string; // Directory for log files
    monitoring?: {
      enabled: boolean;
      alertRetention: number;
      maxAlertsPerHour: number;
      webhookUrl?: string;
      desktopNotifications?: {
        enabled: boolean;
      };
    };
  };
  mcpLogging?: {
    enabled: boolean;
    minLevel: LogLevel;
    rateLimitPerMinute: number;
    maxQueueSize: number;
    includeContext: boolean;
  };
  terminalViewer: {
    enabled: boolean;
    port: number;
    host: string;
    maxSessions: number;
    sessionTimeout: number; // milliseconds
    bufferSize: number; // lines
    enableAuth: boolean;
    authToken?: string;
  };
}

// Interactive Session Types
export interface InteractiveSession {
  sessionId: string;
  command: string;
  args: string[];
  process: any; // ChildProcess from child_process
  startTime: Date;
  lastActivity: Date;
  cwd: string;
  env: Record<string, string>;
  status: 'running' | 'finished' | 'error';
  outputBuffer: string[];
  errorBuffer: string[];
  aiContext?: string;
}

export interface SessionOutput {
  sessionId: string;
  stdout: string;
  stderr: string;
  hasMore: boolean; // Whether there's more output available
  status: 'running' | 'finished' | 'error';
}

export interface SessionInfo {
  sessionId: string;
  command: string;
  startTime: Date;
  lastActivity: Date;
  status: 'running' | 'finished' | 'error';
  cwd: string;
  aiContext?: string;
}
