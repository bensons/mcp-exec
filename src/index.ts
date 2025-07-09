#!/usr/bin/env node

/**
 * MCP Shell Execution Server
 * Enhanced shell command execution with security, context preservation, and AI optimization
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MCPLogger, MCPLoggerConfig, isValidLogLevel } from './audit/mcp-logger';
import { LogLevel, LegacyLogLevel } from './types/index';

import { ShellExecutor } from './core/executor';
import { SecurityManager } from './security/manager';
import { ContextManager } from './context/manager';
import { AuditLogger } from './audit/logger';
import { ConfirmationManager } from './security/confirmation';
import { DisplayFormatter } from './utils/display-formatter';
import { TerminalViewerService } from './terminal/viewer-service';
import { TerminalSessionManager } from './terminal/terminal-session-manager';
import { ServerConfig } from './types/index';

// Default configuration
const DEFAULT_CONFIG: ServerConfig = {
  security: {
    level: (process.env.MCP_EXEC_SECURITY_LEVEL as 'strict' | 'moderate' | 'permissive') || 'permissive',
    confirmDangerous: process.env.MCP_EXEC_CONFIRM_DANGEROUS === 'true',
    allowedDirectories: process.env.MCP_EXEC_ALLOWED_DIRECTORIES
      ? process.env.MCP_EXEC_ALLOWED_DIRECTORIES.split(',').map(dir => dir.trim())
      : [process.cwd(), '/tmp'].filter(dir => dir !== ''),
    blockedCommands: process.env.MCP_EXEC_BLOCKED_COMMANDS
      ? process.env.MCP_EXEC_BLOCKED_COMMANDS.split(',').map(cmd => cmd.trim())
      : [
          'rm -rf /',
          'format',
          'del /f /s /q C:\\',
          'sudo rm -rf /',
          'dd if=/dev/zero',
          'mkfs',
          'fdisk',
          'parted'
        ],
    timeout: parseInt(process.env.MCP_EXEC_TIMEOUT || '300000'), // 5 minutes
    resourceLimits: {
      maxMemoryUsage: parseInt(process.env.MCP_EXEC_MAX_MEMORY || '1024'), // 1GB
      maxFileSize: parseInt(process.env.MCP_EXEC_MAX_FILE_SIZE || '100'), // 100MB
      maxProcesses: parseInt(process.env.MCP_EXEC_MAX_PROCESSES || '10'),
    },
    sandboxing: {
      enabled: process.env.MCP_EXEC_SANDBOXING_ENABLED === 'true', // Disabled by default for compatibility
      networkAccess: process.env.MCP_EXEC_NETWORK_ACCESS !== 'false', // Enabled by default
      fileSystemAccess: (process.env.MCP_EXEC_FILESYSTEM_ACCESS as 'read-only' | 'restricted' | 'full') || 'full',
    },
  },
  context: {
    preserveWorkingDirectory: process.env.MCP_EXEC_PRESERVE_WORKING_DIR !== 'false', // Enabled by default
    sessionPersistence: process.env.MCP_EXEC_SESSION_PERSISTENCE !== 'false', // Enabled by default
    maxHistorySize: parseInt(process.env.MCP_EXEC_MAX_HISTORY_SIZE || '1000'),
  },
  sessions: {
    maxInteractiveSessions: parseInt(process.env.MCP_EXEC_MAX_SESSIONS || '10'),
    sessionTimeout: parseInt(process.env.MCP_EXEC_SESSION_TIMEOUT || '1800000'), // 30 minutes
    outputBufferSize: parseInt(process.env.MCP_EXEC_SESSION_BUFFER_SIZE || '1000'),
  },
  lifecycle: {
    // For MCP servers, inactivity timeout should be disabled by default since clients
    // don't send continuous data. Only shut down when client actually disconnects.
    inactivityTimeout: parseInt(process.env.MCP_EXEC_INACTIVITY_TIMEOUT || '0'), // 0 = disabled by default
    gracefulShutdownTimeout: parseInt(process.env.MCP_EXEC_SHUTDOWN_TIMEOUT || '5000'), // 5 seconds default
    enableHeartbeat: process.env.MCP_EXEC_ENABLE_HEARTBEAT !== 'false', // enabled by default
  },
  output: {
    formatStructured: process.env.MCP_EXEC_FORMAT_STRUCTURED !== 'false', // Enabled by default
    stripAnsi: process.env.MCP_EXEC_STRIP_ANSI !== 'false', // Enabled by default
    summarizeVerbose: process.env.MCP_EXEC_SUMMARIZE_VERBOSE !== 'false', // Enabled by default
    enableAiOptimizations: process.env.MCP_EXEC_ENABLE_AI_OPTIMIZATIONS !== 'false', // Enabled by default
    maxOutputLength: parseInt(process.env.MCP_EXEC_MAX_OUTPUT_LENGTH || '10000'), // 10KB max output
  },
  display: {
    showCommandHeader: process.env.MCP_EXEC_SHOW_COMMAND_HEADER !== 'false', // Enabled by default
    showExecutionTime: process.env.MCP_EXEC_SHOW_EXECUTION_TIME !== 'false', // Enabled by default
    showExitCode: process.env.MCP_EXEC_SHOW_EXIT_CODE !== 'false', // Enabled by default
    formatCodeBlocks: process.env.MCP_EXEC_FORMAT_CODE_BLOCKS !== 'false', // Enabled by default
    includeMetadata: process.env.MCP_EXEC_INCLUDE_METADATA !== 'false', // Enabled by default
    includeSuggestions: process.env.MCP_EXEC_INCLUDE_SUGGESTIONS !== 'false', // Enabled by default
    useMarkdown: process.env.MCP_EXEC_USE_MARKDOWN !== 'false', // Enabled by default
    colorizeOutput: process.env.MCP_EXEC_COLORIZE_OUTPUT === 'true', // Disabled by default
  },
  audit: {
    enabled: process.env.MCP_EXEC_AUDIT_ENABLED !== 'false', // Enabled by default
    logLevel: (process.env.MCP_EXEC_AUDIT_LOG_LEVEL as LogLevel | LegacyLogLevel) || 'debug',
    retention: parseInt(process.env.MCP_EXEC_AUDIT_RETENTION || '30'),
    logDirectory: process.env.MCP_EXEC_LOG_DIR ||
                  (process.env.HOME && path.join(process.env.HOME, '.mcp-exec')) ||
                  (process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.mcp-exec')), // Safer default
    monitoring: {
      enabled: process.env.MCP_EXEC_MONITORING_ENABLED !== 'false', // Enabled by default
      desktopNotifications: {
        enabled: process.env.MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED !== 'false', // Enabled by default
      },
      alertRetention: parseInt(process.env.MCP_EXEC_ALERT_RETENTION || '7'),
      maxAlertsPerHour: parseInt(process.env.MCP_EXEC_MAX_ALERTS_PER_HOUR || '100'),
    },
  },

  // MCP Logging Configuration
  mcpLogging: {
    enabled: process.env.MCP_EXEC_MCP_LOGGING_ENABLED !== 'false', // Enabled by default
    minLevel: (process.env.MCP_EXEC_MCP_LOG_LEVEL as LogLevel) || 'info',
    rateLimitPerMinute: parseInt(process.env.MCP_EXEC_MCP_RATE_LIMIT || '60'),
    maxQueueSize: parseInt(process.env.MCP_EXEC_MCP_QUEUE_SIZE || '100'),
    includeContext: process.env.MCP_EXEC_MCP_INCLUDE_CONTEXT !== 'false', // Enabled by default
  } as MCPLoggerConfig,
  terminalViewer: {
    enabled: process.env.MCP_EXEC_TERMINAL_VIEWER_ENABLED === 'true', // Disabled by default
    port: parseInt(process.env.MCP_EXEC_TERMINAL_VIEWER_PORT || '3000'),
    host: process.env.MCP_EXEC_TERMINAL_VIEWER_HOST || '127.0.0.1',
    maxSessions: parseInt(process.env.MCP_EXEC_TERMINAL_VIEWER_MAX_SESSIONS || '10'),
    sessionTimeout: parseInt(process.env.MCP_EXEC_TERMINAL_VIEWER_SESSION_TIMEOUT || '1800000'), // 30 minutes
    bufferSize: parseInt(process.env.MCP_EXEC_TERMINAL_VIEWER_BUFFER_SIZE || '10000'),
    enableAuth: process.env.MCP_EXEC_TERMINAL_VIEWER_ENABLE_AUTH === 'true',
    authToken: process.env.MCP_EXEC_TERMINAL_VIEWER_AUTH_TOKEN,
  },
};

// Tool schemas
const ExecuteCommandSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  args: z.array(z.string()).optional().describe('Command arguments'),
  cwd: z.string().optional().describe('Working directory for command execution'),
  env: z.record(z.string()).optional().describe('Environment variables'),
  timeout: z.number().optional().describe('Timeout in milliseconds'),
  shell: z.union([z.boolean(), z.string()]).optional().describe('Shell to use for execution'),
  aiContext: z.string().optional().describe('AI context/intent for this command'),
  enableTerminalViewer: z.boolean().optional().describe('Create a terminal session with browser viewer instead of regular execution'),
  terminalSize: z.object({
    cols: z.number().default(80),
    rows: z.number().default(24)
  }).optional().describe('Terminal size when enableTerminalViewer is true'),
});

const StartInteractiveSessionSchema = z.object({
  command: z.string().optional().describe('Initial command to run in the session (defaults to system shell)'),
  args: z.array(z.string()).optional().describe('Command arguments'),
  cwd: z.string().optional().describe('Working directory for the session'),
  env: z.record(z.string()).optional().describe('Environment variables'),
  shell: z.union([z.boolean(), z.string()]).optional().describe('Shell to use for execution'),
  aiContext: z.string().optional().describe('AI context/intent for this session'),
});

const StartTerminalSessionSchema = z.object({
  command: z.string().optional().describe('Initial command to run in the terminal session (defaults to system shell)'),
  args: z.array(z.string()).optional().describe('Command arguments'),
  cwd: z.string().optional().describe('Working directory for the session'),
  env: z.record(z.string()).optional().describe('Environment variables'),
  terminalSize: z.object({
    cols: z.number().default(80),
    rows: z.number().default(24)
  }).optional().describe('Terminal size'),
  aiContext: z.string().optional().describe('AI context/intent for this session'),
});

const SendToSessionSchema = z.object({
  sessionId: z.string().describe('Session ID to send input to'),
  input: z.string().describe('Input to send to the session'),
  addNewline: z.boolean().optional().default(true).describe('Whether to add a newline to the input'),
});

const TerminateTerminalSessionSchema = z.object({
  sessionId: z.string().describe('Terminal session ID to terminate'),
  force: z.boolean().optional().default(false).describe('Force termination without graceful shutdown'),
});

const GetContextSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to get context for'),
});

const ListSessionsSchema = z.object({});

const KillSessionSchema = z.object({
  sessionId: z.string().describe('Session ID to terminate'),
});

const ReadSessionOutputSchema = z.object({
  sessionId: z.string().describe('Session ID to read output from'),
});

const GetHistorySchema = z.object({
  limit: z.number().optional().describe('Number of history entries to return'),
  filter: z.string().optional().describe('Filter commands by pattern'),
});

const SetWorkingDirectorySchema = z.object({
  directory: z.string().describe('Directory path to set as working directory'),
});

const ClearHistorySchema = z.object({
  confirm: z.boolean().optional().describe('Confirm clearing history'),
});

const GetFileSystemChangesSchema = z.object({
  since: z.string().optional().describe('ISO date string to filter changes since'),
});

const UpdateSecurityConfigSchema = z.object({
  level: z.enum(['strict', 'moderate', 'permissive']).optional().describe('Security level'),
  confirmDangerous: z.boolean().optional().describe('Require confirmation for dangerous commands'),
  sandboxing: z.object({
    enabled: z.boolean().optional(),
    networkAccess: z.boolean().optional(),
    fileSystemAccess: z.enum(['read-only', 'restricted', 'full']).optional(),
  }).optional().describe('Sandboxing configuration'),
});

const GetSecurityStatusSchema = z.object({});

const ConfirmCommandSchema = z.object({
  confirmationId: z.string().describe('Confirmation ID for the pending command'),
});

const GetPendingConfirmationsSchema = z.object({});

const GetIntentSummarySchema = z.object({});

const SuggestNextCommandsSchema = z.object({
  command: z.string().describe('Current command to get suggestions for'),
});

const GenerateAuditReportSchema = z.object({
  startDate: z.string().describe('Start date for report (ISO string)'),
  endDate: z.string().describe('End date for report (ISO string)'),
  reportType: z.enum(['standard', 'compliance']).optional().describe('Type of report to generate'),
});

const ExportLogsSchema = z.object({
  format: z.enum(['json', 'csv', 'xml']).describe('Export format'),
  startDate: z.string().optional().describe('Start date filter (ISO string)'),
  endDate: z.string().optional().describe('End date filter (ISO string)'),
  sessionId: z.string().optional().describe('Filter by session ID'),
});

const GetAlertsSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by severity'),
  acknowledged: z.boolean().optional().describe('Filter by acknowledgment status'),
  limit: z.number().optional().describe('Maximum number of alerts to return'),
});

const AcknowledgeAlertSchema = z.object({
  alertId: z.string().describe('Alert ID to acknowledge'),
  acknowledgedBy: z.string().describe('User acknowledging the alert'),
});

const GetAuditConfigSchema = z.object({});

const UpdateAuditConfigSchema = z.object({
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional().describe('Audit log level'),
  retention: z.number().optional().describe('Log retention in days'),
  logFile: z.string().optional().describe('Full path to audit log file'),
  logDirectory: z.string().optional().describe('Directory for audit log files'),
});

// Terminal Viewer Schemas
const ToggleTerminalViewerSchema = z.object({
  enabled: z.boolean().describe('Enable or disable the terminal viewer service'),
  port: z.number().optional().describe('Port for the terminal viewer service'),
});

const GetTerminalViewerStatusSchema = z.object({});

// New Dynamic Configuration Schemas
const GetConfigurationSchema = z.object({
  section: z.enum(['security', 'logging', 'sessions', 'output', 'display', 'context', 'lifecycle', 'terminalViewer', 'all']).optional().describe('Configuration section to retrieve'),
});

const UpdateConfigurationSchema = z.object({
  section: z.enum(['security', 'logging', 'sessions', 'output', 'display', 'context', 'lifecycle', 'terminalViewer']).describe('Configuration section to update'),
  settings: z.record(z.any()).describe('Section-specific settings to update'),
});

const ResetConfigurationSchema = z.object({
  section: z.enum(['security', 'logging', 'sessions', 'output', 'display', 'context', 'lifecycle', 'terminalViewer', 'all']).optional().describe('Configuration section to reset'),
});

const ManageBlockedCommandsSchema = z.object({
  action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
  commands: z.array(z.string()).optional().describe('Commands to add or remove'),
});

const ManageAllowedDirectoriesSchema = z.object({
  action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
  directories: z.array(z.string()).optional().describe('Directories to add or remove'),
});

const UpdateResourceLimitsSchema = z.object({
  maxMemoryUsage: z.number().optional().describe('Maximum memory usage in MB'),
  maxFileSize: z.number().optional().describe('Maximum file size in MB'),
  maxProcesses: z.number().optional().describe('Maximum number of processes'),
});

const UpdateMcpLoggingSchema = z.object({
  minLevel: z.enum(['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug']).optional().describe('Minimum log level for MCP notifications'),
  rateLimitPerMinute: z.number().optional().describe('Maximum messages per minute'),
  maxQueueSize: z.number().optional().describe('Maximum queued messages'),
  includeContext: z.boolean().optional().describe('Include context data in messages'),
});

const UpdateAuditLoggingSchema = z.object({
  retention: z.number().optional().describe('Log retention in days'),
  monitoringEnabled: z.boolean().optional().describe('Enable monitoring alerts'),
  desktopNotifications: z.boolean().optional().describe('Enable desktop notifications'),
  alertRetention: z.number().optional().describe('Alert retention in days'),
  maxAlertsPerHour: z.number().optional().describe('Maximum alerts per hour'),
});

const UpdateSessionLimitsSchema = z.object({
  maxInteractiveSessions: z.number().optional().describe('Maximum concurrent interactive sessions'),
  sessionTimeout: z.number().optional().describe('Session timeout in milliseconds'),
  outputBufferSize: z.number().optional().describe('Output buffer size per session'),
});

const UpdateTerminalViewerSchema = z.object({
  port: z.number().optional().describe('Port for terminal viewer service'),
  host: z.string().optional().describe('Host for terminal viewer service'),
  enableAuth: z.boolean().optional().describe('Enable authentication'),
  authToken: z.string().optional().describe('Authentication token'),
  maxSessions: z.number().optional().describe('Maximum terminal viewer sessions'),
  sessionTimeout: z.number().optional().describe('Terminal session timeout in milliseconds'),
  bufferSize: z.number().optional().describe('Terminal buffer size'),
});

const UpdateOutputFormattingSchema = z.object({
  formatStructured: z.boolean().optional().describe('Format output in structured format'),
  stripAnsi: z.boolean().optional().describe('Strip ANSI escape codes'),
  enableAiOptimizations: z.boolean().optional().describe('Enable AI-powered optimizations'),
  maxOutputLength: z.number().optional().describe('Maximum output length in bytes'),
  summarizeVerbose: z.boolean().optional().describe('Summarize verbose output'),
});

const UpdateDisplayOptionsSchema = z.object({
  showCommandHeader: z.boolean().optional().describe('Show command header information'),
  showExecutionTime: z.boolean().optional().describe('Show execution time'),
  showExitCode: z.boolean().optional().describe('Show exit code'),
  formatCodeBlocks: z.boolean().optional().describe('Format code blocks'),
  includeMetadata: z.boolean().optional().describe('Include metadata'),
  includeSuggestions: z.boolean().optional().describe('Include suggestions'),
  useMarkdown: z.boolean().optional().describe('Use Markdown formatting'),
  colorizeOutput: z.boolean().optional().describe('Colorize output'),
});

const UpdateContextConfigSchema = z.object({
  preserveWorkingDirectory: z.boolean().optional().describe('Preserve working directory between commands'),
  sessionPersistence: z.boolean().optional().describe('Enable session persistence'),
  maxHistorySize: z.number().optional().describe('Maximum command history size'),
});

const UpdateLifecycleConfigSchema = z.object({
  inactivityTimeout: z.number().optional().describe('Inactivity timeout in milliseconds'),
  gracefulShutdownTimeout: z.number().optional().describe('Graceful shutdown timeout in milliseconds'),
  enableHeartbeat: z.boolean().optional().describe('Enable heartbeat monitoring'),
});

const GetConfigurationHistorySchema = z.object({
  limit: z.number().optional().describe('Number of configuration changes to retrieve'),
});

const RollbackConfigurationSchema = z.object({
  changeId: z.string().describe('Configuration change ID to rollback to'),
});

class MCPShellServer {
  private server: Server;
  private shellExecutor: ShellExecutor;
  private securityManager: SecurityManager;
  private contextManager: ContextManager;
  private auditLogger: AuditLogger;
  private mcpLogger: MCPLogger;
  private confirmationManager: ConfirmationManager;
  private displayFormatter: DisplayFormatter;
  private terminalViewerService?: TerminalViewerService;
  private terminalSessionManager?: TerminalSessionManager;
  private config: ServerConfig;
  private isShuttingDown: boolean = false;
  private transport?: any;
  private shutdownTimeout?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private lastActivity: number = Date.now();
  
  // Configuration history tracking
  private configurationHistory: Array<{
    id: string;
    timestamp: Date;
    section: string;
    changes: Record<string, any>;
    previousValues: Record<string, any>;
    user?: string;
  }> = [];
  private originalConfig: ServerConfig;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.originalConfig = JSON.parse(JSON.stringify(this.config)); // Deep copy for history tracking
    
    this.server = new Server(
      {
        name: 'mcp-exec',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {}, // MCP logging capability
        },
      }
    );

    // Initialize components
    this.auditLogger = new AuditLogger(this.config.audit);
    this.securityManager = new SecurityManager(this.config.security, this.auditLogger);
    this.contextManager = new ContextManager(this.config.context, this.auditLogger);
    this.mcpLogger = new MCPLogger(this.config.mcpLogging || {
      enabled: true,
      minLevel: 'info',
      rateLimitPerMinute: 60,
      maxQueueSize: 100,
      includeContext: true
    });
    this.confirmationManager = new ConfirmationManager();
    this.displayFormatter = new DisplayFormatter(this.config.display);

    // Debug logging for initialization (using audit logger instead of console.log to avoid JSON-RPC interference)
    this.auditLogger.log({
      level: 'debug',
      message: 'MCP Server components initialized',
      context: {
        securityLevel: this.config.security.level,
        auditEnabled: this.config.audit.enabled,
        auditLogLevel: this.config.audit.logLevel,
        terminalViewerEnabled: this.config.terminalViewer.enabled,
        sessionPersistence: this.config.context.sessionPersistence,
      }
    });

    // Log server initialization at info level for MCP clients
    this.mcpLogger.info('MCP Shell Execution Server initialized', 'mcp-server', {
      version: '1.0.0',
      securityLevel: this.config.security.level,
      mcpLoggingEnabled: this.config.mcpLogging?.enabled,
      mcpLogLevel: this.config.mcpLogging?.minLevel
    });

    // Initialize terminal components
    this.terminalSessionManager = new TerminalSessionManager(
      this.config.sessions,
      this.config.terminalViewer
    );

    // Auto-start terminal viewer service if enabled in config
    if (this.config.terminalViewer.enabled) {
      try {
        this.terminalViewerService = new TerminalViewerService(this.config.terminalViewer);
        this.terminalViewerService.start().catch((error) => {
          console.error('Failed to auto-start terminal viewer service:', error);
          // Don't throw - let the server continue without terminal viewer
          this.terminalViewerService = undefined;
        });
      } catch (error) {
        console.error('Failed to create terminal viewer service:', error);
        // Don't throw - let the server continue without terminal viewer
      }
    }

    this.shellExecutor = new ShellExecutor(
      this.securityManager,
      this.contextManager,
      this.auditLogger,
      this.config
    );

    // Set up MCP logger notification callback
    this.mcpLogger.setNotificationCallback((message) => {
      try {
        // Only send notifications if server is connected
        if (this.transport) {
          this.server.notification({
            method: 'notifications/message',
            params: message as any
          });
        }
      } catch (error) {
        // Silently ignore notification errors to avoid infinite loops
        console.error('Failed to send MCP log notification:', error instanceof Error ? error.message : 'Unknown error');
      }
    });

    this.setupHandlers();
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return 'cmd.exe';
    } else {
      return process.env.SHELL || '/bin/bash';
    }
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'execute_command',
            description: 'Execute a one-shot shell command with security validation and context preservation. For interactive sessions, use start_terminal_session or start_interactive_session instead.',
            inputSchema: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'The shell command to execute' },
                args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
                cwd: { type: 'string', description: 'Working directory for command execution' },
                env: { type: 'object', description: 'Environment variables' },
                timeout: { type: 'number', description: 'Timeout in milliseconds' },
                shell: { type: ['boolean', 'string'], description: 'Shell to use for execution' },
                aiContext: { type: 'string', description: 'AI context/intent for this command' },
                enableTerminalViewer: { type: 'boolean', description: 'Create a terminal session with browser viewer instead of regular execution' },
                terminalSize: {
                  type: 'object',
                  properties: {
                    cols: { type: 'number', default: 80 },
                    rows: { type: 'number', default: 24 }
                  },
                  description: 'Terminal size when enableTerminalViewer is true'
                },
              },
              required: ['command'],
            },
            annotations: {
              title: 'Execute Shell Command',
              openWorldHint: true,
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          {
            name: 'start_interactive_session',
            description: 'Start a new interactive shell session for command execution. The session will run the specified command (or default shell) and terminate when the process exits.',
            inputSchema: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'Initial command to run in the session (defaults to system shell)' },
                args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
                cwd: { type: 'string', description: 'Working directory for the session' },
                env: { type: 'object', description: 'Environment variables' },
                shell: { type: ['boolean', 'string'], description: 'Shell to use for execution' },
                aiContext: { type: 'string', description: 'AI context/intent for this session' },
              },
            },
            annotations: {
              title: 'Start Interactive Session',
              openWorldHint: true,
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          {
            name: 'start_terminal_session',
            description: 'Start a new terminal session with full PTY support and browser-based viewing. The terminal provides a persistent shell environment that continues running even after individual commands exit. Use kill_session to terminate the entire terminal session.',
            inputSchema: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'Initial command to run in terminal (optional, defaults to system shell)' },
                args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
                cwd: { type: 'string', description: 'Working directory for the session' },
                env: { type: 'object', description: 'Environment variables' },
                terminalSize: {
                  type: 'object',
                  properties: {
                    cols: { type: 'number', default: 80 },
                    rows: { type: 'number', default: 24 }
                  },
                  description: 'Terminal size'
                },
                aiContext: { type: 'string', description: 'AI context/intent for this session' },
              },
            },
            annotations: {
              title: 'Start Terminal Session',
              openWorldHint: true,
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          {
            name: 'send_to_session',
            description: 'Send input to an existing interactive or terminal session',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: { type: 'string', description: 'Session ID to send input to' },
                input: { type: 'string', description: 'Input to send to the session' },
                addNewline: { type: 'boolean', default: true, description: 'Whether to add a newline to the input' },
              },
              required: ['sessionId', 'input'],
            },
            annotations: {
              title: 'Send Input to Session',
              openWorldHint: true,
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          {
            name: 'terminate_terminal_session',
            description: 'Explicitly terminate a terminal session and its PTY process. This is different from sending "exit" commands, which only exit individual programs within the terminal.',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: { type: 'string', description: 'Terminal session ID to terminate' },
                force: { type: 'boolean', default: false, description: 'Force termination without graceful shutdown' },
              },
              required: ['sessionId'],
            },
            annotations: {
              title: 'Terminate Terminal Session',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
            },
          },
          {
            name: 'get_context',
            description: 'Get current execution context including working directory and environment',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: { type: 'string', description: 'Session ID to get context for' },
              },
            },
            annotations: {
              title: 'Get Execution Context',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'get_history',
            description: 'Get command execution history with optional filtering',
            inputSchema: {
              type: 'object',
              properties: {
                limit: { type: 'number', description: 'Number of history entries to return' },
                filter: { type: 'string', description: 'Filter commands by pattern' },
              },
            },
            annotations: {
              title: 'Get Command History',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'set_working_directory',
            description: 'Set the current working directory for subsequent commands',
            inputSchema: {
              type: 'object',
              properties: {
                directory: { type: 'string', description: 'Directory path to set as working directory' },
              },
              required: ['directory'],
            },
            annotations: {
              title: 'Set Working Directory',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'clear_history',
            description: 'Clear command history and session data',
            inputSchema: {
              type: 'object',
              properties: {
                confirm: { type: 'boolean', description: 'Confirm clearing history' },
              },
            },
            annotations: {
              title: 'Clear Command History',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
            },
          },
          {
            name: 'get_filesystem_changes',
            description: 'Get tracked file system changes from command executions',
            inputSchema: {
              type: 'object',
              properties: {
                since: { type: 'string', description: 'ISO date string to filter changes since' },
              },
            },
            annotations: {
              title: 'Get File System Changes',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'update_security_config',
            description: 'Update security configuration settings',
            inputSchema: {
              type: 'object',
              properties: {
                level: { type: 'string', enum: ['strict', 'moderate', 'permissive'], description: 'Security level' },
                confirmDangerous: { type: 'boolean', description: 'Require confirmation for dangerous commands' },
                sandboxing: {
                  type: 'object',
                  properties: {
                    enabled: { type: 'boolean' },
                    networkAccess: { type: 'boolean' },
                    fileSystemAccess: { type: 'string', enum: ['read-only', 'restricted', 'full'] },
                  },
                  description: 'Sandboxing configuration',
                },
              },
            },
            annotations: {
              title: 'Update Security Settings',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'get_security_status',
            description: 'Get current security configuration and status',
            inputSchema: {
              type: 'object',
              properties: {},
            },
            annotations: {
              title: 'Get Security Status',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'confirm_command',
            description: 'Confirm execution of a dangerous command',
            inputSchema: {
              type: 'object',
              properties: {
                confirmationId: { type: 'string', description: 'Confirmation ID for the pending command' },
              },
              required: ['confirmationId'],
            },
            annotations: {
              title: 'Confirm Dangerous Command',
              openWorldHint: true,
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          {
            name: 'get_pending_confirmations',
            description: 'Get list of commands pending confirmation',
            inputSchema: {
              type: 'object',
              properties: {},
            },
            annotations: {
              title: 'Get Pending Confirmations',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'get_intent_summary',
            description: 'Get summary of command intents and AI optimization insights',
            inputSchema: {
              type: 'object',
              properties: {},
            },
            annotations: {
              title: 'Get AI Intent Summary',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'suggest_next_commands',
            description: 'Get AI-suggested next commands based on current command',
            inputSchema: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'Current command to get suggestions for' },
              },
              required: ['command'],
            },
            annotations: {
              title: 'Suggest Next Commands',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'generate_audit_report',
            description: 'Generate comprehensive audit or compliance report',
            inputSchema: {
              type: 'object',
              properties: {
                startDate: { type: 'string', description: 'Start date for report (ISO string)' },
                endDate: { type: 'string', description: 'End date for report (ISO string)' },
                reportType: { type: 'string', enum: ['standard', 'compliance'], description: 'Type of report to generate' },
              },
              required: ['startDate', 'endDate'],
            },
            annotations: {
              title: 'Generate Audit Report',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'export_logs',
            description: 'Export audit logs in various formats',
            inputSchema: {
              type: 'object',
              properties: {
                format: { type: 'string', enum: ['json', 'csv', 'xml'], description: 'Export format' },
                startDate: { type: 'string', description: 'Start date filter (ISO string)' },
                endDate: { type: 'string', description: 'End date filter (ISO string)' },
                sessionId: { type: 'string', description: 'Filter by session ID' },
              },
              required: ['format'],
            },
            annotations: {
              title: 'Export Audit Logs',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'get_alerts',
            description: 'Get security and monitoring alerts',
            inputSchema: {
              type: 'object',
              properties: {
                severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Filter by severity' },
                acknowledged: { type: 'boolean', description: 'Filter by acknowledgment status' },
                limit: { type: 'number', description: 'Maximum number of alerts to return' },
              },
            },
            annotations: {
              title: 'Get Security Alerts',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'acknowledge_alert',
            description: 'Acknowledge a security alert',
            inputSchema: {
              type: 'object',
              properties: {
                alertId: { type: 'string', description: 'Alert ID to acknowledge' },
                acknowledgedBy: { type: 'string', description: 'User acknowledging the alert' },
              },
              required: ['alertId', 'acknowledgedBy'],
            },
            annotations: {
              title: 'Acknowledge Alert',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'get_audit_config',
            description: 'Get current audit configuration including log file location',
            inputSchema: {
              type: 'object',
              properties: {},
            },
            annotations: {
              title: 'Get Audit Configuration',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'update_audit_config',
            description: 'Update audit configuration settings',
            inputSchema: {
              type: 'object',
              properties: {
                logLevel: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: 'Audit log level' },
                retention: { type: 'number', description: 'Log retention in days' },
                logFile: { type: 'string', description: 'Full path to audit log file' },
                logDirectory: { type: 'string', description: 'Directory for audit log files' },
              },
            },
            annotations: {
              title: 'Update Audit Settings',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'list_sessions',
            description: 'List all active interactive sessions',
            inputSchema: {
              type: 'object',
              properties: {},
            },
            annotations: {
              title: 'List Active Sessions',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'kill_session',
            description: 'Terminate an interactive session',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: { type: 'string', description: 'Session ID to terminate' },
              },
              required: ['sessionId'],
            },
            annotations: {
              title: 'Kill Session',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
            },
          },
          {
            name: 'read_session_output',
            description: 'Read buffered output from an interactive session',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: { type: 'string', description: 'Session ID to read output from' },
              },
              required: ['sessionId'],
            },
            annotations: {
              title: 'Read Session Output',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'toggle_terminal_viewer',
            description: 'Enable or disable the terminal viewer HTTP service for live terminal viewing in browser',
            inputSchema: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean', description: 'Enable or disable the terminal viewer service' },
                port: { type: 'number', description: 'Port for the terminal viewer service (optional)' },
              },
              required: ['enabled'],
            },
            annotations: {
              title: 'Toggle Terminal Viewer',
              openWorldHint: true,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'get_terminal_viewer_status',
            description: 'Get the current status of the terminal viewer service and active sessions',
            inputSchema: {
              type: 'object',
              properties: {},
            },
            annotations: {
              title: 'Get Terminal Viewer Status',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          // Dynamic Configuration Tools
          {
            name: 'get_configuration',
            description: 'Get current configuration settings for specified section or all sections',
            inputSchema: {
              type: 'object',
              properties: {
                section: { type: 'string', enum: ['security', 'logging', 'sessions', 'output', 'display', 'context', 'lifecycle', 'terminalViewer', 'all'], description: 'Configuration section to retrieve' },
              },
            },
            annotations: {
              title: 'Get Configuration',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'update_configuration',
            description: 'Update configuration settings for a specific section',
            inputSchema: {
              type: 'object',
              properties: {
                section: { type: 'string', enum: ['security', 'logging', 'sessions', 'output', 'display', 'context', 'lifecycle', 'terminalViewer'], description: 'Configuration section to update' },
                settings: { type: 'object', description: 'Section-specific settings to update' },
              },
              required: ['section', 'settings'],
            },
            annotations: {
              title: 'Update Configuration',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'reset_configuration',
            description: 'Reset configuration to default values for specified section or all sections',
            inputSchema: {
              type: 'object',
              properties: {
                section: { type: 'string', enum: ['security', 'logging', 'sessions', 'output', 'display', 'context', 'lifecycle', 'terminalViewer', 'all'], description: 'Configuration section to reset' },
              },
            },
            annotations: {
              title: 'Reset Configuration',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'manage_blocked_commands',
            description: 'Add, remove, or list blocked commands for security',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'Action to perform' },
                commands: { type: 'array', items: { type: 'string' }, description: 'Commands to add or remove' },
              },
              required: ['action'],
            },
            annotations: {
              title: 'Manage Blocked Commands',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'manage_allowed_directories',
            description: 'Add, remove, or list allowed directories for security',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'Action to perform' },
                directories: { type: 'array', items: { type: 'string' }, description: 'Directories to add or remove' },
              },
              required: ['action'],
            },
            annotations: {
              title: 'Manage Allowed Directories',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'update_resource_limits',
            description: 'Update resource limits for command execution',
            inputSchema: {
              type: 'object',
              properties: {
                maxMemoryUsage: { type: 'number', description: 'Maximum memory usage in MB' },
                maxFileSize: { type: 'number', description: 'Maximum file size in MB' },
                maxProcesses: { type: 'number', description: 'Maximum number of processes' },
              },
            },
            annotations: {
              title: 'Update Resource Limits',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'update_mcp_logging',
            description: 'Update MCP client notification logging settings',
            inputSchema: {
              type: 'object',
              properties: {
                minLevel: { type: 'string', enum: ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug'], description: 'Minimum log level for MCP notifications' },
                rateLimitPerMinute: { type: 'number', description: 'Maximum messages per minute' },
                maxQueueSize: { type: 'number', description: 'Maximum queued messages' },
                includeContext: { type: 'boolean', description: 'Include context data in messages' },
              },
            },
            annotations: {
              title: 'Update MCP Logging',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'update_audit_logging',
            description: 'Update audit logging and monitoring settings',
            inputSchema: {
              type: 'object',
              properties: {
                retention: { type: 'number', description: 'Log retention in days' },
                monitoringEnabled: { type: 'boolean', description: 'Enable monitoring alerts' },
                desktopNotifications: { type: 'boolean', description: 'Enable desktop notifications' },
                alertRetention: { type: 'number', description: 'Alert retention in days' },
                maxAlertsPerHour: { type: 'number', description: 'Maximum alerts per hour' },
              },
            },
            annotations: {
              title: 'Update Audit Logging',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'update_session_limits',
            description: 'Update session management limits and timeouts',
            inputSchema: {
              type: 'object',
              properties: {
                maxInteractiveSessions: { type: 'number', description: 'Maximum concurrent interactive sessions' },
                sessionTimeout: { type: 'number', description: 'Session timeout in milliseconds' },
                outputBufferSize: { type: 'number', description: 'Output buffer size per session' },
              },
            },
            annotations: {
              title: 'Update Session Limits',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'update_terminal_viewer',
            description: 'Update terminal viewer service configuration',
            inputSchema: {
              type: 'object',
              properties: {
                port: { type: 'number', description: 'Port for terminal viewer service' },
                host: { type: 'string', description: 'Host for terminal viewer service' },
                enableAuth: { type: 'boolean', description: 'Enable authentication' },
                authToken: { type: 'string', description: 'Authentication token' },
                maxSessions: { type: 'number', description: 'Maximum terminal viewer sessions' },
                sessionTimeout: { type: 'number', description: 'Terminal session timeout in milliseconds' },
                bufferSize: { type: 'number', description: 'Terminal buffer size' },
              },
            },
            annotations: {
              title: 'Update Terminal Viewer',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'update_output_formatting',
            description: 'Update output formatting and processing settings',
            inputSchema: {
              type: 'object',
              properties: {
                formatStructured: { type: 'boolean', description: 'Format output in structured format' },
                stripAnsi: { type: 'boolean', description: 'Strip ANSI escape codes' },
                enableAiOptimizations: { type: 'boolean', description: 'Enable AI-powered optimizations' },
                maxOutputLength: { type: 'number', description: 'Maximum output length in bytes' },
                summarizeVerbose: { type: 'boolean', description: 'Summarize verbose output' },
              },
            },
            annotations: {
              title: 'Update Output Formatting',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'update_display_options',
            description: 'Update display and presentation options',
            inputSchema: {
              type: 'object',
              properties: {
                showCommandHeader: { type: 'boolean', description: 'Show command header information' },
                showExecutionTime: { type: 'boolean', description: 'Show execution time' },
                showExitCode: { type: 'boolean', description: 'Show exit code' },
                formatCodeBlocks: { type: 'boolean', description: 'Format code blocks' },
                includeMetadata: { type: 'boolean', description: 'Include metadata' },
                includeSuggestions: { type: 'boolean', description: 'Include suggestions' },
                useMarkdown: { type: 'boolean', description: 'Use Markdown formatting' },
                colorizeOutput: { type: 'boolean', description: 'Colorize output' },
              },
            },
            annotations: {
              title: 'Update Display Options',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'update_context_config',
            description: 'Update context management and persistence settings',
            inputSchema: {
              type: 'object',
              properties: {
                preserveWorkingDirectory: { type: 'boolean', description: 'Preserve working directory between commands' },
                sessionPersistence: { type: 'boolean', description: 'Enable session persistence' },
                maxHistorySize: { type: 'number', description: 'Maximum command history size' },
              },
            },
            annotations: {
              title: 'Update Context Config',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'update_lifecycle_config',
            description: 'Update server lifecycle and shutdown settings',
            inputSchema: {
              type: 'object',
              properties: {
                inactivityTimeout: { type: 'number', description: 'Inactivity timeout in milliseconds' },
                gracefulShutdownTimeout: { type: 'number', description: 'Graceful shutdown timeout in milliseconds' },
                enableHeartbeat: { type: 'boolean', description: 'Enable heartbeat monitoring' },
              },
            },
            annotations: {
              title: 'Update Lifecycle Config',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
          {
            name: 'get_configuration_history',
            description: 'Get history of configuration changes',
            inputSchema: {
              type: 'object',
              properties: {
                limit: { type: 'number', description: 'Number of configuration changes to retrieve' },
              },
            },
            annotations: {
              title: 'Get Configuration History',
              openWorldHint: false,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          {
            name: 'rollback_configuration',
            description: 'Rollback configuration to a previous state',
            inputSchema: {
              type: 'object',
              properties: {
                changeId: { type: 'string', description: 'Configuration change ID to rollback to' },
              },
              required: ['changeId'],
            },
            annotations: {
              title: 'Rollback Configuration',
              openWorldHint: false,
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // Update activity on any tool call
      this.updateActivity();

      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'execute_command': {
            const parsed = ExecuteCommandSchema.parse(args);

            // Debug logging for command execution (using audit logger to avoid JSON-RPC interference)
            this.auditLogger.log({
              level: 'debug',
              message: 'Execute command request received',
              context: {
                command: parsed.command,
                args: parsed.args,
                cwd: parsed.cwd,
                hasAiContext: !!parsed.aiContext,
                enableTerminalViewer: !!parsed.enableTerminalViewer,
              }
            });

            // Check if terminal viewer is requested
            if (parsed.enableTerminalViewer) {
              this.auditLogger.log({
                level: 'debug',
                message: 'Terminal viewer execution requested',
                context: {
                  command: parsed.command,
                  args: parsed.args,
                  cwd: parsed.cwd,
                  hasAiContext: !!parsed.aiContext,
                }
              });

              try {
                // Ensure terminal viewer service is available
                if (!this.terminalViewerService) {
                  this.terminalViewerService = new TerminalViewerService(this.config.terminalViewer);
                }

                if (!this.terminalViewerService.isEnabled()) {
                  await this.terminalViewerService.start();
                }

                // Create terminal session using enhanced session manager
                const sessionId = await this.terminalSessionManager!.startSession({
                  command: parsed.command,
                  args: parsed.args,
                  cwd: parsed.cwd,
                  env: parsed.env,
                  enableTerminalViewer: true,
                  terminalSize: parsed.terminalSize || { cols: 80, rows: 24 },
                  aiContext: parsed.aiContext,
                });

                // Add session to terminal viewer service
                const terminalSession = this.terminalSessionManager!.getSession(sessionId);
                if (terminalSession && this.terminalViewerService) {
                  this.terminalViewerService.addSession(terminalSession);
                }

                // Get viewer URL
                const viewerUrl = this.terminalViewerService?.getSessionUrl(sessionId) || 'Service not available';

                const fullCommand = parsed.args && parsed.args.length > 0
                  ? `${parsed.command} ${parsed.args.join(' ')}`
                  : parsed.command;

                return {
                  content: [
                    {
                      type: 'text',
                      text: `🖥️ **Terminal Session Started**\n\n**Command:** \`${fullCommand}\`\n**Session ID:** \`${sessionId}\`\n**Type:** Terminal (PTY-based)\n**Viewer URL:** ${viewerUrl}\n\n**Important - Terminal Session Behavior:**\n• **Persistent Environment**: This terminal session will continue running even after individual commands exit\n• **Shell Persistence**: When you send \`exit\` to a command like \`bash\`, it exits that command but returns to the parent shell\n• **Session Termination**: Use \`kill_session\` to terminate the entire terminal session\n• **Live Viewing**: Monitor the session in real-time via the browser viewer\n\n**Usage:**\n• Use \`send_to_session\` to send commands\n• Use \`read_session_output\` to read terminal output\n• Use \`kill_session\` to terminate when done`,
                    },
                  ],
                };
              } catch (error) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `❌ **Failed to start terminal session:** ${error instanceof Error ? error.message : 'Unknown error'}`,
                    },
                  ],
                };
              }
            }

            // Execute the command
            const result = await this.shellExecutor.executeCommand(parsed);

            // Build the full command string for display
            const fullCommand = parsed.args && parsed.args.length > 0
              ? `${parsed.command} ${parsed.args.join(' ')}`
              : parsed.command;

            // Format the output for enhanced display
            const formattedOutput = this.displayFormatter.formatCommandOutput(
              fullCommand,
              result,
              {
                showInput: true,
                aiContext: parsed.aiContext
              }
            );

            return {
              content: [
                {
                  type: 'text',
                  text: formattedOutput,
                },
              ],
            };
          }

          case 'start_interactive_session': {
            const parsed = StartInteractiveSessionSchema.parse(args);

            this.auditLogger.log({
              level: 'debug',
              message: 'Start interactive session request received',
              context: {
                command: parsed.command,
                cwd: parsed.cwd,
                hasAiContext: !!parsed.aiContext,
              }
            });

            try {
              // Use the session manager directly to create an interactive session
              const context = await this.contextManager.getCurrentContext();
              const workingDirectory = parsed.cwd || context.currentDirectory || process.cwd();
              const environment: Record<string, string> = {
                ...Object.fromEntries(
                  Object.entries(process.env).filter(([_, value]) => value !== undefined)
                ) as Record<string, string>,
                ...context.environmentVariables,
                ...parsed.env,
              };

              const sessionId = await this.shellExecutor.startInteractiveSession({
                command: parsed.command || this.getDefaultShell(),
                args: parsed.args,
                cwd: workingDirectory,
                env: environment,
                shell: parsed.shell,
                aiContext: parsed.aiContext,
              });

              const fullCommand = parsed.command || this.getDefaultShell();

              return {
                content: [
                  {
                    type: 'text',
                    text: `🔧 **Interactive Session Started**\n\n**Command:** \`${fullCommand}\`\n**Session ID:** \`${sessionId}\`\n**Type:** Interactive (process-based)\n\n**Usage:**\n• Use \`send_to_session\` to send commands\n• Session will terminate when the process exits\n• Use \`list_sessions\` to view session status`,
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ **Failed to start interactive session:** ${error instanceof Error ? error.message : 'Unknown error'}`,
                  },
                ],
              };
            }
          }

          case 'start_terminal_session': {
            const parsed = StartTerminalSessionSchema.parse(args);

            this.auditLogger.log({
              level: 'debug',
              message: 'Start terminal session request received',
              context: {
                command: parsed.command,
                cwd: parsed.cwd,
                terminalSize: parsed.terminalSize,
                hasAiContext: !!parsed.aiContext,
              }
            });

            try {
              // Ensure terminal viewer service is available
              if (!this.terminalViewerService) {
                this.terminalViewerService = new TerminalViewerService(this.config.terminalViewer);
              }

              if (!this.terminalViewerService.isEnabled()) {
                await this.terminalViewerService.start();
              }

              // Create terminal session using enhanced session manager
              const sessionId = await this.terminalSessionManager!.startSession({
                command: parsed.command, // Don't default to shell - let PTY spawn the shell directly
                args: parsed.args,
                cwd: parsed.cwd,
                env: parsed.env,
                enableTerminalViewer: true,
                terminalSize: parsed.terminalSize || { cols: 80, rows: 24 },
                aiContext: parsed.aiContext,
              });

              // Add session to terminal viewer service
              const terminalSession = this.terminalSessionManager!.getSession(sessionId);
              if (terminalSession && this.terminalViewerService) {
                this.terminalViewerService.addSession(terminalSession);
              }

              // Get viewer URL
              const viewerUrl = this.terminalViewerService?.getSessionUrl(sessionId) || 'Service not available';

              const fullCommand = parsed.command || 'system shell';

              return {
                content: [
                  {
                    type: 'text',
                    text: `🖥️ **Terminal Session Started**\n\n**Command:** \`${fullCommand}\`\n**Session ID:** \`${sessionId}\`\n**Type:** Terminal (PTY-based)\n**Viewer URL:** ${viewerUrl}\n\n**Important - Terminal Session Behavior:**\n• **Persistent Environment**: This terminal session will continue running even after individual commands exit\n• **Shell Persistence**: When you send \`exit\` to a command like \`bash\`, it exits that command but returns to the parent shell\n• **Session Termination**: Use \`kill_session\` to terminate the entire terminal session\n• **Live Viewing**: Monitor the session in real-time via the browser viewer\n\n**Usage:**\n• Use \`send_to_session\` to send commands\n• Use \`read_session_output\` to read terminal output\n• Use \`kill_session\` to terminate when done`,
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ **Failed to start terminal session:** ${error instanceof Error ? error.message : 'Unknown error'}`,
                  },
                ],
              };
            }
          }

          case 'send_to_session': {
            const parsed = SendToSessionSchema.parse(args);

            this.auditLogger.log({
              level: 'debug',
              message: 'Send to session request received',
              context: {
                sessionId: parsed.sessionId,
                inputLength: parsed.input.length,
                addNewline: parsed.addNewline,
              }
            });

            try {
              // Try terminal session manager first
              const terminalSession = this.terminalSessionManager?.getSession(parsed.sessionId);
              if (terminalSession) {
                // If terminal viewer service is available and has this session, use it for input
                // This ensures proper WebSocket broadcasting
                if (this.terminalViewerService && this.terminalViewerService.hasSession(parsed.sessionId)) {
                  this.terminalViewerService.sendInput(parsed.sessionId, parsed.input, parsed.addNewline);
                } else {
                  // Fallback to direct terminal session manager
                  await this.terminalSessionManager!.sendInput({
                    sessionId: parsed.sessionId,
                    input: parsed.input,
                    addNewline: parsed.addNewline,
                  });
                }

                return {
                  content: [
                    {
                      type: 'text',
                      text: `✅ **Input sent to terminal session**\n\n**Session ID:** \`${parsed.sessionId}\`\n**Input:** \`${parsed.input}\`\n\nCheck the terminal viewer or use \`read_session_output\` to see the response.`,
                    },
                  ],
                };
              }

              // Fall back to regular session manager
              await this.shellExecutor.sendInputToSession({
                sessionId: parsed.sessionId,
                input: parsed.input,
                addNewline: parsed.addNewline,
              });

              return {
                content: [
                  {
                    type: 'text',
                    text: `✅ **Input sent to interactive session**\n\n**Session ID:** \`${parsed.sessionId}\`\n**Input:** \`${parsed.input}\`\n\nUse \`read_session_output\` to see the response.`,
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ **Failed to send input to session:** ${error instanceof Error ? error.message : 'Unknown error'}`,
                  },
                ],
              };
            }
          }

          case 'terminate_terminal_session': {
            const parsed = TerminateTerminalSessionSchema.parse(args);

            this.auditLogger.log({
              level: 'debug',
              message: 'Terminate terminal session request received',
              context: {
                sessionId: parsed.sessionId,
                force: parsed.force,
              }
            });

            try {
              // Check if this is a terminal session
              const terminalSession = this.terminalSessionManager?.getSession(parsed.sessionId);
              if (!terminalSession) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `❌ **Terminal session not found**\n\nSession ID \`${parsed.sessionId}\` is not a terminal session or does not exist.\n\n**Note:** This tool is specifically for terminal sessions. Use \`kill_session\` for interactive sessions.`,
                    },
                  ],
                };
              }

              // Terminate the terminal session
              await this.terminalSessionManager!.killSession(parsed.sessionId);

              return {
                content: [
                  {
                    type: 'text',
                    text: `✅ **Terminal Session Terminated**\n\n**Session ID:** \`${parsed.sessionId}\`\n**Method:** ${parsed.force ? 'Force termination' : 'Graceful termination'}\n\nThe PTY process and all associated shell processes have been terminated.`,
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ **Failed to terminate terminal session:** ${error instanceof Error ? error.message : 'Unknown error'}`,
                  },
                ],
              };
            }
          }

          case 'get_context': {
            const parsed = GetContextSchema.parse(args || {});
            const context = await this.contextManager.getCurrentContext(parsed.sessionId);

            // Format context information nicely
            const formattedContext = this.formatContextDisplay(context);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedContext,
                },
              ],
            };
          }

          case 'get_history': {
            const parsed = GetHistorySchema.parse(args || {});
            const history = await this.contextManager.getHistory(parsed.limit, parsed.filter);

            // Format history nicely
            const formattedHistory = this.formatHistoryDisplay(history, parsed.limit);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedHistory,
                },
              ],
            };
          }

          case 'set_working_directory': {
            const parsed = SetWorkingDirectorySchema.parse(args);
            const success = await this.contextManager.setWorkingDirectory(parsed.directory);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success,
                    directory: success ? parsed.directory : 'Failed to set directory',
                    message: success ? 'Working directory updated' : 'Directory does not exist or is not accessible'
                  }, null, 2),
                },
              ],
            };
          }

          case 'clear_history': {
            const parsed = ClearHistorySchema.parse(args);
            if (parsed.confirm !== false) {
              await this.contextManager.clearHistory();

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      message: 'Command history and session data cleared'
                    }, null, 2),
                  },
                ],
              };
            } else {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      message: 'History clearing cancelled - set confirm to true to proceed'
                    }, null, 2),
                  },
                ],
              };
            }
          }

          case 'get_filesystem_changes': {
            const parsed = GetFileSystemChangesSchema.parse(args);
            const since = parsed.since ? new Date(parsed.since) : undefined;
            const changes = await this.contextManager.getFileSystemChanges(since);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(changes, null, 2),
                },
              ],
            };
          }

          case 'update_security_config': {
            const parsed = UpdateSecurityConfigSchema.parse(args);

            // Update security configuration
            if (parsed.level) {
              this.config.security.level = parsed.level;
            }
            if (parsed.confirmDangerous !== undefined) {
              this.config.security.confirmDangerous = parsed.confirmDangerous;
            }
            if (parsed.sandboxing) {
              if (!this.config.security.sandboxing) {
                this.config.security.sandboxing = {
                  enabled: false,
                  networkAccess: true,
                  fileSystemAccess: 'full',
                };
              }
              if (parsed.sandboxing.enabled !== undefined) {
                this.config.security.sandboxing.enabled = parsed.sandboxing.enabled;
              }
              if (parsed.sandboxing.networkAccess !== undefined) {
                this.config.security.sandboxing.networkAccess = parsed.sandboxing.networkAccess;
              }
              if (parsed.sandboxing.fileSystemAccess) {
                this.config.security.sandboxing.fileSystemAccess = parsed.sandboxing.fileSystemAccess;
              }
            }

            // Recreate security manager with new config
            this.securityManager = new SecurityManager(this.config.security);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Security configuration updated',
                    newConfig: this.config.security
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_security_status': {
            const securityData = {
              securityConfig: this.config.security,
              pendingConfirmations: this.confirmationManager.getAllPendingConfirmations().length,
              serverInfo: {
                version: '1.0.0',
                platform: process.platform,
                nodeVersion: process.version,
              }
            };

            const formattedStatus = this.formatSecurityStatusDisplay(securityData);

            return {
              content: [
                {
                  type: 'text',
                  text: formattedStatus,
                },
              ],
            };
          }

          case 'confirm_command': {
            const parsed = ConfirmCommandSchema.parse(args);
            const confirmed = this.confirmationManager.confirmCommand(parsed.confirmationId);

            if (confirmed) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      message: 'Command confirmed and ready for execution',
                      confirmationId: parsed.confirmationId
                    }, null, 2),
                  },
                ],
              };
            } else {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      message: 'Confirmation not found or expired',
                      confirmationId: parsed.confirmationId
                    }, null, 2),
                  },
                ],
              };
            }
          }

          case 'get_pending_confirmations': {
            const pending = this.confirmationManager.getAllPendingConfirmations();

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    pendingConfirmations: pending,
                    count: pending.length
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_intent_summary': {
            const intentSummary = this.shellExecutor.getIntentSummary();

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    intentSummary,
                    aiOptimizations: {
                      outputProcessing: this.config.output.enableAiOptimizations,
                      maxOutputLength: this.config.output.maxOutputLength,
                      structuredOutput: this.config.output.formatStructured,
                    }
                  }, null, 2),
                },
              ],
            };
          }

          case 'suggest_next_commands': {
            const parsed = SuggestNextCommandsSchema.parse(args);
            const suggestions = this.shellExecutor.suggestNextCommands(parsed.command);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    currentCommand: parsed.command,
                    suggestions,
                    count: suggestions.length
                  }, null, 2),
                },
              ],
            };
          }

          case 'generate_audit_report': {
            const parsed = GenerateAuditReportSchema.parse(args);
            const timeRange = {
              start: new Date(parsed.startDate),
              end: new Date(parsed.endDate),
            };

            let report;
            if (parsed.reportType === 'compliance') {
              report = await this.auditLogger.generateComplianceReport(timeRange);
            } else {
              report = await this.auditLogger.generateReport(timeRange);
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    reportType: parsed.reportType || 'standard',
                    timeRange,
                    report
                  }, null, 2),
                },
              ],
            };
          }

          case 'export_logs': {
            const parsed = ExportLogsSchema.parse(args);
            const filters: any = {};

            if (parsed.startDate && parsed.endDate) {
              filters.timeRange = {
                start: new Date(parsed.startDate),
                end: new Date(parsed.endDate),
              };
            }

            if (parsed.sessionId) {
              filters.sessionId = parsed.sessionId;
            }

            const exportedData = await this.auditLogger.exportLogs(parsed.format, filters);

            return {
              content: [
                {
                  type: 'text',
                  text: exportedData,
                },
              ],
            };
          }

          case 'get_alerts': {
            const parsed = GetAlertsSchema.parse(args);
            const alerts = this.auditLogger.getAlerts(parsed);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    alerts,
                    count: alerts.length,
                    filters: parsed
                  }, null, 2),
                },
              ],
            };
          }

          case 'acknowledge_alert': {
            const parsed = AcknowledgeAlertSchema.parse(args);
            const success = this.auditLogger.acknowledgeAlert(parsed.alertId, parsed.acknowledgedBy);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success,
                    alertId: parsed.alertId,
                    acknowledgedBy: parsed.acknowledgedBy,
                    message: success ? 'Alert acknowledged successfully' : 'Alert not found or already acknowledged'
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_audit_config': {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    auditConfig: this.config.audit,
                    currentLogFile: this.auditLogger.getLogFilePath(),
                    environmentVariables: {
                      MCP_EXEC_AUDIT_LOG: process.env.MCP_EXEC_AUDIT_LOG || 'not set',
                      MCP_EXEC_LOG_DIR: process.env.MCP_EXEC_LOG_DIR || 'not set',
                    }
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_audit_config': {
            const parsed = UpdateAuditConfigSchema.parse(args);

            // Update audit configuration
            if (parsed.logLevel) {
              this.config.audit.logLevel = parsed.logLevel;
            }
            if (parsed.retention !== undefined) {
              this.config.audit.retention = parsed.retention;
            }
            if (parsed.logFile) {
              this.config.audit.logFile = parsed.logFile;
            }
            if (parsed.logDirectory) {
              this.config.audit.logDirectory = parsed.logDirectory;
            }

            // Note: Log file location change requires server restart to take effect
            const requiresRestart = parsed.logFile || parsed.logDirectory;

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Audit configuration updated',
                    updatedConfig: this.config.audit,
                    currentLogFile: this.auditLogger.getLogFilePath(),
                    note: requiresRestart ? 'Log file location changes require server restart to take effect' : undefined
                  }, null, 2),
                },
              ],
            };
          }

          case 'list_sessions': {
            this.auditLogger.log({
              level: 'debug',
              message: 'Listing sessions from both managers',
              context: { requestId: uuidv4() }
            });

            // Get sessions from both managers
            const regularSessions = await this.shellExecutor.listSessions();
            const terminalSessions = this.terminalSessionManager?.listSessions() || [];

            this.auditLogger.log({
              level: 'debug',
              message: 'Sessions retrieved from managers',
              context: {
                regularSessionCount: regularSessions.length,
                terminalSessionCount: terminalSessions.length,
                regularSessionIds: regularSessions.map(s => s.sessionId),
                terminalSessionIds: terminalSessions.map(s => s.sessionId),
              }
            });

            // Combine all sessions
            const allSessions = [
              ...regularSessions.map(session => ({
                sessionId: session.sessionId,
                command: session.command,
                startTime: session.startTime,
                lastActivity: session.lastActivity,
                status: session.status,
                cwd: session.cwd,
                aiContext: session.aiContext,
                hasTerminalViewer: false,
              })),
              ...terminalSessions.map(session => ({
                sessionId: session.sessionId,
                command: session.command,
                startTime: session.startTime,
                lastActivity: session.lastActivity,
                status: session.status,
                cwd: session.cwd,
                aiContext: session.aiContext,
                hasTerminalViewer: session.hasTerminalViewer,
              }))
            ];

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    sessions: allSessions,
                    totalSessions: allSessions.length,
                    regularSessions: regularSessions.length,
                    terminalSessions: terminalSessions.length,
                    maxSessions: this.config.sessions.maxInteractiveSessions,
                  }, null, 2),
                },
              ],
            };
          }

          case 'kill_session': {
            const parsed = KillSessionSchema.parse(args);

            this.auditLogger.log({
              level: 'debug',
              message: 'Kill session request received',
              context: { sessionId: parsed.sessionId }
            });

            try {
              // Try terminal session manager first
              if (this.terminalSessionManager) {
                const terminalSession = this.terminalSessionManager.getSession(parsed.sessionId);
                if (terminalSession) {
                  this.auditLogger.log({
                    level: 'debug',
                    message: 'Found session in TerminalSessionManager, terminating',
                    context: {
                      sessionId: parsed.sessionId,
                      sessionStatus: terminalSession.status,
                      sessionCommand: terminalSession.command
                    }
                  });
                  await this.terminalSessionManager.killSession(parsed.sessionId);

                  // Also remove from terminal viewer service if it exists
                  if (this.terminalViewerService) {
                    this.terminalViewerService.removeSession(parsed.sessionId);
                  }

                  return {
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({
                          success: true,
                          message: `Terminal session ${parsed.sessionId} terminated`,
                          sessionId: parsed.sessionId,
                          sessionType: 'terminal',
                        }, null, 2),
                      },
                    ],
                  };
                }
              }

              // Fall back to regular session manager
              await this.shellExecutor.killSession(parsed.sessionId);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      message: `Session ${parsed.sessionId} terminated`,
                      sessionId: parsed.sessionId,
                      sessionType: 'regular',
                    }, null, 2),
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: error instanceof Error ? error.message : 'Unknown error',
                      sessionId: parsed.sessionId,
                    }, null, 2),
                  },
                ],
              };
            }
          }

          case 'read_session_output': {
            const parsed = ReadSessionOutputSchema.parse(args);

            await this.auditLogger.log({
              level: 'debug',
              message: 'read_session_output called',
              context: { sessionId: parsed.sessionId }
            });

            try {
              // Check if it's a terminal session first
              if (this.terminalSessionManager) {
                const terminalSession = this.terminalSessionManager.getSession(parsed.sessionId);
                if (terminalSession) {
                  await this.auditLogger.log({
                    level: 'debug',
                    message: 'Found terminal session for read_session_output',
                    context: {
                      sessionId: parsed.sessionId,
                      status: terminalSession.status,
                      bufferLines: terminalSession.buffer.lines.length
                    }
                  });

                  const buffer = this.terminalSessionManager.getTerminalBuffer(parsed.sessionId);
                  const viewerUrl = this.terminalViewerService?.getSessionUrl(parsed.sessionId);

                  return {
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({
                          sessionId: parsed.sessionId,
                          sessionType: 'terminal',
                          status: terminalSession.status,
                          command: terminalSession.command,
                          startTime: terminalSession.startTime,
                          lastActivity: terminalSession.lastActivity,
                          terminalViewerUrl: viewerUrl,
                          bufferLines: buffer?.lines.length || 0,
                          recentOutput: buffer?.lines.slice(-10).map(line => line.text).join('\n') || '',
                          message: 'Terminal session output is streamed live to the browser. Use the terminal viewer URL for real-time output.',
                        }, null, 2),
                      },
                    ],
                  };
                }
              }

              // Fall back to regular session output
              const output = await this.shellExecutor.readSessionOutput(parsed.sessionId);

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      sessionId: output.sessionId,
                      sessionType: 'regular',
                      stdout: output.stdout,
                      stderr: output.stderr,
                      hasMore: output.hasMore,
                      status: output.status,
                    }, null, 2),
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: error instanceof Error ? error.message : 'Unknown error',
                      sessionId: parsed.sessionId,
                    }, null, 2),
                  },
                ],
              };
            }
          }

          case 'toggle_terminal_viewer': {
            const parsed = ToggleTerminalViewerSchema.parse(args);

            try {
              if (parsed.enabled) {
                // Start terminal viewer service
                if (!this.terminalViewerService) {
                  const config = { ...this.config.terminalViewer };
                  if (parsed.port) {
                    config.port = parsed.port;
                  }
                  this.terminalViewerService = new TerminalViewerService(config);
                }

                if (!this.terminalViewerService.isEnabled()) {
                  await this.terminalViewerService.start();
                }

                const status = this.terminalViewerService.getStatus();
                return {
                  content: [
                    {
                      type: 'text',
                      text: `✅ Terminal viewer service enabled\n\n**Service Details:**\n• Host: ${status.host}\n• Port: ${status.port}\n• Active Sessions: ${status.totalSessions}\n\nYou can now use the \`enableTerminalViewer\` option in \`execute_command\` to create viewable terminal sessions.`,
                    },
                  ],
                };
              } else {
                // Stop terminal viewer service
                if (this.terminalViewerService && this.terminalViewerService.isEnabled()) {
                  await this.terminalViewerService.stop();
                }

                return {
                  content: [
                    {
                      type: 'text',
                      text: '✅ Terminal viewer service disabled',
                    },
                  ],
                };
              }
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ Error toggling terminal viewer: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  },
                ],
                isError: true,
              };
            }
          }

          case 'get_terminal_viewer_status': {
            try {
              const isEnabled = this.terminalViewerService?.isEnabled() || false;

              if (!isEnabled) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: '📺 **Terminal Viewer Status: Disabled**\n\nUse `toggle_terminal_viewer` with `enabled: true` to start the service.',
                    },
                  ],
                };
              }

              const status = this.terminalViewerService!.getStatus();
              const sessions = status.activeSessions;

              let response = `📺 **Terminal Viewer Status: Enabled**\n\n`;
              response += `**Service Details:**\n`;
              response += `• Host: ${status.host}\n`;
              response += `• Port: ${status.port}\n`;
              response += `• Uptime: ${status.uptime ? Math.round(status.uptime / 1000) : 0}s\n`;
              response += `• Total Sessions: ${status.totalSessions}\n\n`;

              if (sessions.length > 0) {
                response += `**Active Terminal Sessions:**\n`;
                sessions.forEach(session => {
                  response += `• **${session.command}** (${session.status})\n`;
                  response += `  - Session ID: \`${session.sessionId}\`\n`;
                  response += `  - URL: ${session.url}\n`;
                  response += `  - Viewers: ${session.viewerCount}\n`;
                  response += `  - Started: ${session.startTime.toLocaleString()}\n\n`;
                });
              } else {
                response += `**No active terminal sessions**\n\nUse \`execute_command\` with \`enableTerminalViewer: true\` to create viewable sessions.`;
              }

              return {
                content: [
                  {
                    type: 'text',
                    text: response,
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ Error getting terminal viewer status: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  },
                ],
                isError: true,
              };
            }
          }

          // Dynamic Configuration Tools
          case 'get_configuration': {
            const parsed = GetConfigurationSchema.parse(args);
            const section = parsed.section || 'all';

            let configData: any = {};
            
            if (section === 'all' || section === 'security') {
              configData.security = this.config.security;
            }
            if (section === 'all' || section === 'logging') {
              configData.logging = {
                audit: this.config.audit,
                mcpLogging: this.config.mcpLogging
              };
            }
            if (section === 'all' || section === 'sessions') {
              configData.sessions = this.config.sessions;
            }
            if (section === 'all' || section === 'output') {
              configData.output = this.config.output;
            }
            if (section === 'all' || section === 'display') {
              configData.display = this.config.display;
            }
            if (section === 'all' || section === 'context') {
              configData.context = this.config.context;
            }
            if (section === 'all' || section === 'lifecycle') {
              configData.lifecycle = this.config.lifecycle;
            }
            if (section === 'all' || section === 'terminalViewer') {
              configData.terminalViewer = this.config.terminalViewer;
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    section,
                    configuration: configData,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_configuration': {
            const parsed = UpdateConfigurationSchema.parse(args);
            const { section, settings } = parsed;

            // Record previous values for history
            const currentSection = this.config[section as keyof ServerConfig];
            const previousValues = currentSection ? JSON.parse(JSON.stringify(currentSection)) : {};

            // Update configuration
            if (currentSection && typeof currentSection === 'object') {
              Object.assign(currentSection, settings);
            }

            // Record configuration change
            this.recordConfigurationChange(section, settings, previousValues as Record<string, any>);

            // Reinitialize components if needed
            await this.reinitializeComponents(section);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: `Configuration section '${section}' updated successfully`,
                    section,
                    changes: settings,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'reset_configuration': {
            const parsed = ResetConfigurationSchema.parse(args);
            const section = parsed.section || 'all';

            let resetSections: string[] = [];
            
            if (section === 'all') {
              resetSections = ['security', 'logging', 'sessions', 'output', 'display', 'context', 'lifecycle', 'terminalViewer'];
            } else {
              resetSections = [section];
            }

            const resetResults: Record<string, any> = {};

            for (const resetSection of resetSections) {
              // Record previous values
              const previousValues = JSON.parse(JSON.stringify(this.config[resetSection as keyof ServerConfig]));
              
              // Reset to original values
              this.config[resetSection as keyof ServerConfig] = JSON.parse(JSON.stringify(this.originalConfig[resetSection as keyof ServerConfig]));
              
              // Record the reset as a configuration change
              const resetSectionConfig = this.config[resetSection as keyof ServerConfig];
              if (resetSectionConfig) {
                this.recordConfigurationChange(resetSection, resetSectionConfig as Record<string, any>, previousValues);
              }
              
              resetResults[resetSection] = 'reset';
            }

            // Reinitialize components
            await this.reinitializeComponents(section === 'all' ? undefined : section);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: `Configuration reset completed`,
                    resetSections,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'manage_blocked_commands': {
            const parsed = ManageBlockedCommandsSchema.parse(args);
            const { action, commands } = parsed;

            let result: any = {};

            switch (action) {
              case 'add':
                if (!commands || commands.length === 0) {
                  throw new Error('Commands array is required for add action');
                }
                this.config.security.blockedCommands.push(...commands);
                result = {
                  action: 'add',
                  added: commands,
                  totalBlocked: this.config.security.blockedCommands.length
                };
                break;

              case 'remove':
                if (!commands || commands.length === 0) {
                  throw new Error('Commands array is required for remove action');
                }
                const removed = commands.filter(cmd => this.config.security.blockedCommands.includes(cmd));
                this.config.security.blockedCommands = this.config.security.blockedCommands.filter(
                  cmd => !commands.includes(cmd)
                );
                result = {
                  action: 'remove',
                  removed,
                  totalBlocked: this.config.security.blockedCommands.length
                };
                break;

              case 'list':
                result = {
                  action: 'list',
                  blockedCommands: this.config.security.blockedCommands,
                  count: this.config.security.blockedCommands.length
                };
                break;
            }

            // Recreate security manager with updated blocked commands
            this.securityManager = new SecurityManager(this.config.security, this.auditLogger);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'manage_allowed_directories': {
            const parsed = ManageAllowedDirectoriesSchema.parse(args);
            const { action, directories } = parsed;

            let result: any = {};

            switch (action) {
              case 'add':
                if (!directories || directories.length === 0) {
                  throw new Error('Directories array is required for add action');
                }
                this.config.security.allowedDirectories.push(...directories);
                result = {
                  action: 'add',
                  added: directories,
                  totalAllowed: this.config.security.allowedDirectories.length
                };
                break;

              case 'remove':
                if (!directories || directories.length === 0) {
                  throw new Error('Directories array is required for remove action');
                }
                const removed = directories.filter(dir => this.config.security.allowedDirectories.includes(dir));
                this.config.security.allowedDirectories = this.config.security.allowedDirectories.filter(
                  dir => !directories.includes(dir)
                );
                result = {
                  action: 'remove',
                  removed,
                  totalAllowed: this.config.security.allowedDirectories.length
                };
                break;

              case 'list':
                result = {
                  action: 'list',
                  allowedDirectories: this.config.security.allowedDirectories,
                  count: this.config.security.allowedDirectories.length
                };
                break;
            }

            // Recreate security manager with updated allowed directories
            this.securityManager = new SecurityManager(this.config.security, this.auditLogger);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'update_resource_limits': {
            const parsed = UpdateResourceLimitsSchema.parse(args);
            
            // Record previous values
            const previousValues = JSON.parse(JSON.stringify(this.config.security.resourceLimits || {}));

            // Update resource limits
            if (!this.config.security.resourceLimits) {
              this.config.security.resourceLimits = {};
            }
            
            if (parsed.maxMemoryUsage !== undefined) {
              this.config.security.resourceLimits.maxMemoryUsage = parsed.maxMemoryUsage;
            }
            if (parsed.maxFileSize !== undefined) {
              this.config.security.resourceLimits.maxFileSize = parsed.maxFileSize;
            }
            if (parsed.maxProcesses !== undefined) {
              this.config.security.resourceLimits.maxProcesses = parsed.maxProcesses;
            }

            // Record configuration change
            this.recordConfigurationChange('security', { resourceLimits: this.config.security.resourceLimits }, { resourceLimits: previousValues });

            // Recreate security manager
            this.securityManager = new SecurityManager(this.config.security, this.auditLogger);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Resource limits updated',
                    resourceLimits: this.config.security.resourceLimits,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_mcp_logging': {
            const parsed = UpdateMcpLoggingSchema.parse(args);
            
            // Record previous values
            const previousValues = JSON.parse(JSON.stringify(this.config.mcpLogging || {}));

            // Update MCP logging settings
            if (!this.config.mcpLogging) {
              this.config.mcpLogging = {
                enabled: true,
                minLevel: 'info',
                rateLimitPerMinute: 60,
                maxQueueSize: 100,
                includeContext: true
              };
            }

            if (parsed.minLevel !== undefined) {
              this.config.mcpLogging.minLevel = parsed.minLevel;
            }
            if (parsed.rateLimitPerMinute !== undefined) {
              this.config.mcpLogging.rateLimitPerMinute = parsed.rateLimitPerMinute;
            }
            if (parsed.maxQueueSize !== undefined) {
              this.config.mcpLogging.maxQueueSize = parsed.maxQueueSize;
            }
            if (parsed.includeContext !== undefined) {
              this.config.mcpLogging.includeContext = parsed.includeContext;
            }

            // Record configuration change
            this.recordConfigurationChange('mcpLogging', this.config.mcpLogging, previousValues);

            // Recreate MCP logger
            this.mcpLogger = new MCPLogger(this.config.mcpLogging);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'MCP logging settings updated',
                    mcpLogging: this.config.mcpLogging,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_audit_logging': {
            const parsed = UpdateAuditLoggingSchema.parse(args);
            
            // Record previous values
            const previousValues = JSON.parse(JSON.stringify(this.config.audit));

            // Update audit logging settings
            if (parsed.retention !== undefined) {
              this.config.audit.retention = parsed.retention;
            }
            if (parsed.monitoringEnabled !== undefined) {
              if (!this.config.audit.monitoring) {
                this.config.audit.monitoring = {
                  enabled: true,
                  alertRetention: 7,
                  maxAlertsPerHour: 100,
                  desktopNotifications: { enabled: true }
                };
              }
              this.config.audit.monitoring.enabled = parsed.monitoringEnabled;
            }
            if (parsed.desktopNotifications !== undefined) {
              if (!this.config.audit.monitoring) {
                this.config.audit.monitoring = {
                  enabled: true,
                  alertRetention: 7,
                  maxAlertsPerHour: 100,
                  desktopNotifications: { enabled: true }
                };
              }
              if (this.config.audit.monitoring?.desktopNotifications) {
                this.config.audit.monitoring.desktopNotifications.enabled = parsed.desktopNotifications;
              }
            }
            if (parsed.alertRetention !== undefined) {
              if (!this.config.audit.monitoring) {
                this.config.audit.monitoring = {
                  enabled: true,
                  alertRetention: 7,
                  maxAlertsPerHour: 100,
                  desktopNotifications: { enabled: true }
                };
              }
              this.config.audit.monitoring.alertRetention = parsed.alertRetention;
            }
            if (parsed.maxAlertsPerHour !== undefined) {
              if (!this.config.audit.monitoring) {
                this.config.audit.monitoring = {
                  enabled: true,
                  alertRetention: 7,
                  maxAlertsPerHour: 100,
                  desktopNotifications: { enabled: true }
                };
              }
              this.config.audit.monitoring.maxAlertsPerHour = parsed.maxAlertsPerHour;
            }

            // Record configuration change
            this.recordConfigurationChange('audit', this.config.audit, previousValues);

            // Recreate audit logger
            this.auditLogger = new AuditLogger(this.config.audit);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Audit logging settings updated',
                    audit: this.config.audit,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_session_limits': {
            const parsed = UpdateSessionLimitsSchema.parse(args);
            
            // Record previous values
            const previousValues = JSON.parse(JSON.stringify(this.config.sessions));

            // Update session limits
            if (parsed.maxInteractiveSessions !== undefined) {
              this.config.sessions.maxInteractiveSessions = parsed.maxInteractiveSessions;
            }
            if (parsed.sessionTimeout !== undefined) {
              this.config.sessions.sessionTimeout = parsed.sessionTimeout;
            }
            if (parsed.outputBufferSize !== undefined) {
              this.config.sessions.outputBufferSize = parsed.outputBufferSize;
            }

            // Record configuration change
            this.recordConfigurationChange('sessions', this.config.sessions, previousValues);

            // Recreate terminal session manager
            this.terminalSessionManager = new TerminalSessionManager(
              this.config.sessions,
              this.config.terminalViewer
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Session limits updated',
                    sessions: this.config.sessions,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_terminal_viewer': {
            const parsed = UpdateTerminalViewerSchema.parse(args);
            
            // Record previous values
            const previousValues = JSON.parse(JSON.stringify(this.config.terminalViewer));

            // Update terminal viewer settings
            if (parsed.port !== undefined) {
              this.config.terminalViewer.port = parsed.port;
            }
            if (parsed.host !== undefined) {
              this.config.terminalViewer.host = parsed.host;
            }
            if (parsed.enableAuth !== undefined) {
              this.config.terminalViewer.enableAuth = parsed.enableAuth;
            }
            if (parsed.authToken !== undefined) {
              this.config.terminalViewer.authToken = parsed.authToken;
            }
            if (parsed.maxSessions !== undefined) {
              this.config.terminalViewer.maxSessions = parsed.maxSessions;
            }
            if (parsed.sessionTimeout !== undefined) {
              this.config.terminalViewer.sessionTimeout = parsed.sessionTimeout;
            }
            if (parsed.bufferSize !== undefined) {
              this.config.terminalViewer.bufferSize = parsed.bufferSize;
            }

            // Record configuration change
            this.recordConfigurationChange('terminalViewer', this.config.terminalViewer, previousValues);

            // Recreate terminal session manager
            this.terminalSessionManager = new TerminalSessionManager(
              this.config.sessions,
              this.config.terminalViewer
            );

            // Restart terminal viewer service if enabled
            if (this.config.terminalViewer.enabled && this.terminalViewerService) {
              await this.terminalViewerService.stop();
              this.terminalViewerService = new TerminalViewerService(this.config.terminalViewer);
              await this.terminalViewerService.start();
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Terminal viewer settings updated',
                    terminalViewer: this.config.terminalViewer,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_output_formatting': {
            const parsed = UpdateOutputFormattingSchema.parse(args);
            
            // Record previous values
            const previousValues = JSON.parse(JSON.stringify(this.config.output));

            // Update output formatting settings
            if (parsed.formatStructured !== undefined) {
              this.config.output.formatStructured = parsed.formatStructured;
            }
            if (parsed.stripAnsi !== undefined) {
              this.config.output.stripAnsi = parsed.stripAnsi;
            }
            if (parsed.enableAiOptimizations !== undefined) {
              this.config.output.enableAiOptimizations = parsed.enableAiOptimizations;
            }
            if (parsed.maxOutputLength !== undefined) {
              this.config.output.maxOutputLength = parsed.maxOutputLength;
            }
            if (parsed.summarizeVerbose !== undefined) {
              this.config.output.summarizeVerbose = parsed.summarizeVerbose;
            }

            // Record configuration change
            this.recordConfigurationChange('output', this.config.output, previousValues);

            // Recreate shell executor with new config
            this.shellExecutor = new ShellExecutor(
              this.securityManager,
              this.contextManager,
              this.auditLogger,
              this.config
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Output formatting settings updated',
                    output: this.config.output,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_display_options': {
            const parsed = UpdateDisplayOptionsSchema.parse(args);
            
            // Record previous values
            const previousValues = JSON.parse(JSON.stringify(this.config.display));

            // Update display options
            if (parsed.showCommandHeader !== undefined) {
              this.config.display.showCommandHeader = parsed.showCommandHeader;
            }
            if (parsed.showExecutionTime !== undefined) {
              this.config.display.showExecutionTime = parsed.showExecutionTime;
            }
            if (parsed.showExitCode !== undefined) {
              this.config.display.showExitCode = parsed.showExitCode;
            }
            if (parsed.formatCodeBlocks !== undefined) {
              this.config.display.formatCodeBlocks = parsed.formatCodeBlocks;
            }
            if (parsed.includeMetadata !== undefined) {
              this.config.display.includeMetadata = parsed.includeMetadata;
            }
            if (parsed.includeSuggestions !== undefined) {
              this.config.display.includeSuggestions = parsed.includeSuggestions;
            }
            if (parsed.useMarkdown !== undefined) {
              this.config.display.useMarkdown = parsed.useMarkdown;
            }
            if (parsed.colorizeOutput !== undefined) {
              this.config.display.colorizeOutput = parsed.colorizeOutput;
            }

            // Record configuration change
            this.recordConfigurationChange('display', this.config.display, previousValues);

            // Recreate display formatter
            this.displayFormatter = new DisplayFormatter(this.config.display);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Display options updated',
                    display: this.config.display,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_context_config': {
            const parsed = UpdateContextConfigSchema.parse(args);
            
            // Record previous values
            const previousValues = JSON.parse(JSON.stringify(this.config.context));

            // Update context configuration
            if (parsed.preserveWorkingDirectory !== undefined) {
              this.config.context.preserveWorkingDirectory = parsed.preserveWorkingDirectory;
            }
            if (parsed.sessionPersistence !== undefined) {
              this.config.context.sessionPersistence = parsed.sessionPersistence;
            }
            if (parsed.maxHistorySize !== undefined) {
              this.config.context.maxHistorySize = parsed.maxHistorySize;
            }

            // Record configuration change
            this.recordConfigurationChange('context', this.config.context, previousValues);

            // Recreate context manager
            this.contextManager = new ContextManager(this.config.context, this.auditLogger);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Context configuration updated',
                    context: this.config.context,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'update_lifecycle_config': {
            const parsed = UpdateLifecycleConfigSchema.parse(args);
            
            // Record previous values
            const previousValues = JSON.parse(JSON.stringify(this.config.lifecycle));

            // Update lifecycle configuration
            if (parsed.inactivityTimeout !== undefined) {
              this.config.lifecycle.inactivityTimeout = parsed.inactivityTimeout;
            }
            if (parsed.gracefulShutdownTimeout !== undefined) {
              this.config.lifecycle.gracefulShutdownTimeout = parsed.gracefulShutdownTimeout;
            }
            if (parsed.enableHeartbeat !== undefined) {
              this.config.lifecycle.enableHeartbeat = parsed.enableHeartbeat;
            }

            // Record configuration change
            this.recordConfigurationChange('lifecycle', this.config.lifecycle, previousValues);

            // Restart heartbeat if needed
            if (this.config.lifecycle.enableHeartbeat) {
              this.startHeartbeat();
            } else {
              this.stopHeartbeat();
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Lifecycle configuration updated',
                    lifecycle: this.config.lifecycle,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_configuration_history': {
            const parsed = GetConfigurationHistorySchema.parse(args);
            const limit = parsed.limit || 10;

            const history = this.configurationHistory
              .slice(-limit)
              .map(entry => ({
                id: entry.id,
                timestamp: entry.timestamp.toISOString(),
                section: entry.section,
                changes: entry.changes,
                user: entry.user
              }));

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    history,
                    totalChanges: this.configurationHistory.length,
                    limit
                  }, null, 2),
                },
              ],
            };
          }

          case 'rollback_configuration': {
            const parsed = RollbackConfigurationSchema.parse(args);
            const { changeId } = parsed;

            const changeEntry = this.configurationHistory.find(entry => entry.id === changeId);
            if (!changeEntry) {
              throw new Error(`Configuration change with ID '${changeId}' not found`);
            }

            // Rollback to previous values
            const configSection = this.config[changeEntry.section as keyof ServerConfig];
            if (configSection && typeof configSection === 'object') {
              Object.assign(configSection, changeEntry.previousValues);
            }

            // Record the rollback as a new configuration change
            this.recordConfigurationChange(
              changeEntry.section,
              changeEntry.previousValues,
              JSON.parse(JSON.stringify(this.config[changeEntry.section as keyof ServerConfig]))
            );

            // Reinitialize components
            await this.reinitializeComponents(changeEntry.section);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: `Configuration rolled back to change ID: ${changeId}`,
                    rolledBackSection: changeEntry.section,
                    rolledBackValues: changeEntry.previousValues,
                    timestamp: new Date().toISOString()
                  }, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = [];

      // Add terminal viewer sessions resource if service is enabled
      if (this.terminalViewerService?.isEnabled()) {
        resources.push({
          uri: 'terminal-viewer://sessions',
          name: 'Terminal Viewer Sessions',
          description: 'Live terminal session URLs for browser viewing',
          mimeType: 'application/json',
        });
      }

      return { resources };
    });

    // Handle prompt suggestions
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: 'terminal',
            description: 'Launch an interactive terminal session with browser viewer',
            arguments: [
              {
                name: 'command',
                description: 'Optional initial command to run (defaults to system shell)',
                required: false,
              },
              {
                name: 'cwd',
                description: 'Working directory for the terminal session',
                required: false,
              },
            ],
          },
        ],
      };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'terminal') {
        const command = args?.command || undefined;
        const cwd = args?.cwd || undefined;

        return {
          description: 'Interactive Terminal Session Workflow',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Launch a new interactive terminal session using the mcp-exec tools. This workflow allows you to interact with a live shell by sending commands and receiving output iteratively.

**Workflow Instructions:**

1. **Enable the Terminal Viewer**: Use the \`toggle_terminal_viewer\` tool with "enabled": true to ensure the terminal viewer service is active.

2. **Start a Terminal Session**: Use the \`start_terminal_session\` tool${command ? ` with command "${command}"` : ' without specifying a command'}${cwd ? ` in directory "${cwd}"` : ''}. This will launch ${command ? 'the specified command' : 'the default interactive shell'} and return a session ID and viewer URL.

3. **Open the Terminal Viewer**: Use your client's browser tools to open the viewer URL in a new window or tab. This allows live visibility into the session.

4. **Send Commands Iteratively**: Use the \`send_to_session\` tool to issue shell commands to the session. Each command's output will be streamed back and visible in the browser viewer.

5. **Monitor Output**: Use \`read_session_output\` to read buffered output from the session if needed.

6. **Terminate the Session**: When you're done, send the "exit" command using \`send_to_session\` to gracefully close the shell, or use \`kill_session\` to force termination.

7. **Confirm Completion**: Use \`get_terminal_viewer_status\` to check the session status and ensure proper cleanup.

**Example Usage:**

\`\`\`json
[
  { "tool": "toggle_terminal_viewer", "input": { "enabled": true } },
  { "tool": "start_terminal_session", "input": {${command ? `"command": "${command}"` : ''}${cwd ? `${command ? ', ' : ''}"cwd": "${cwd}"` : ''}} },
  // Then open the viewer URL in a browser
  { "tool": "send_to_session", "input": { "sessionId": "<session-id>", "input": "uname -a" } },
  { "tool": "send_to_session", "input": { "sessionId": "<session-id>", "input": "whoami" } },
  { "tool": "read_session_output", "input": { "sessionId": "<session-id>" } },
  { "tool": "send_to_session", "input": { "sessionId": "<session-id>", "input": "exit" } },
  { "tool": "get_terminal_viewer_status", "input": {} }
]
\`\`\`

**Key Benefits:**
- **Live Browser Viewing**: Real-time terminal output in your browser
- **Persistent Sessions**: Terminal continues running between commands
- **Full Shell Features**: Complete shell environment with history, environment variables, etc.
- **Graceful Exit Handling**: Sessions properly transition to "finished" state when exited

Please start by enabling the terminal viewer service.`,
              },
            },
          ],
        };
      }

      throw new Error(`Unknown prompt: ${name}`);
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'terminal-viewer://sessions') {
        if (!this.terminalViewerService?.isEnabled()) {
          throw new Error('Terminal viewer service is not enabled');
        }

        const status = this.terminalViewerService.getStatus();
        const resource = {
          uri,
          name: 'Terminal Viewer Sessions',
          description: 'Live terminal session URLs for browser viewing',
          mimeType: 'application/json',
          sessions: status.activeSessions,
        };

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(resource, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });

    // MCP Logging handlers
    const LoggingSetLevelSchema = z.object({
      method: z.literal('logging/setLevel'),
      params: z.object({
        level: z.string().describe('Minimum log level to send to client')
      })
    });

    this.server.setRequestHandler(LoggingSetLevelSchema, async (request) => {
      const { level } = request.params;

      if (!isValidLogLevel(level)) {
        throw new Error(`Invalid log level: ${level}. Valid levels are: emergency, alert, critical, error, warning, notice, info, debug`);
      }

      this.mcpLogger.setMinLevel(level as LogLevel);

      // Log the level change
      this.mcpLogger.notice(`MCP log level changed to: ${level}`, 'mcp-server');

      return {};
    });
  }

  async start(): Promise<void> {
    try {
      this.mcpLogger.info('Starting MCP Shell Execution Server', 'mcp-server');

      // Load previous session if configured
      await this.contextManager.loadSession();
      this.mcpLogger.debug('Context manager session loaded', 'mcp-server');

      this.transport = new StdioServerTransport();

      // Set up connection monitoring
      this.setupConnectionMonitoring();
      this.mcpLogger.debug('Connection monitoring configured', 'mcp-server');

      await this.server.connect(this.transport);
      this.mcpLogger.info('MCP server transport connected', 'mcp-server');

      // Process any queued MCP log messages now that transport is ready
      this.mcpLogger.processQueuedMessages();

      // Log server start with audit log location info
      await this.auditLogger.log({
        level: 'info',
        message: 'MCP Shell Server started',
        context: {
          config: this.config,
          auditLogLocation: this.auditLogger.getLogFilePath(),
          pid: process.pid,
          platform: process.platform,
          nodeVersion: process.version,
        },
      });

      this.mcpLogger.notice('MCP Shell Execution Server started successfully', 'mcp-server', {
        capabilities: ['tools', 'resources', 'prompts', 'logging'],
        securityLevel: this.config.security.level,
        auditLogLocation: this.auditLogger.getLogFilePath()
      });

    } catch (error) {
      this.mcpLogger.critical('Failed to start MCP server', 'mcp-server', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private setupConnectionMonitoring(): void {
    // Monitor stdin for closure (indicates client disconnection)
    process.stdin.on('end', () => {
      this.mcpLogger.warning('Client disconnected (stdin closed)', 'connection-monitor');
      console.error('📡 Client disconnected (stdin closed)');
      this.gracefulShutdown('Client disconnection');
    });

    process.stdin.on('error', (error) => {
      this.mcpLogger.error('Stdin error detected', 'connection-monitor', { error: error.message });
      console.error('📡 Stdin error:', error.message);
      this.gracefulShutdown('Stdin error');
    });

    // Monitor for broken pipe (client closed connection)
    process.stdout.on('error', (error) => {
      this.mcpLogger.error('Stdout error detected', 'connection-monitor', { error: error.message });
      console.error('📡 Stdout error:', error.message);
      this.gracefulShutdown('Stdout error');
    });

    // Monitor stdin for data to track activity
    process.stdin.on('data', () => {
      this.updateActivity();
    });

    // Start heartbeat monitoring
    this.startHeartbeat();
    this.mcpLogger.debug('Heartbeat monitoring started', 'connection-monitor');
  }

  private updateActivity(): void {
    this.lastActivity = Date.now();
  }

  private async hasActiveSessions(): Promise<boolean> {
    try {
      // Check interactive sessions
      const interactiveSessions = await this.shellExecutor.listSessions();
      const activeInteractiveSessions = interactiveSessions.filter((session: any) => session.status === 'running');

      // Check terminal sessions
      let activeTerminalSessions = 0;
      if (this.terminalSessionManager) {
        const terminalSessions = this.terminalSessionManager.listSessions();
        activeTerminalSessions = terminalSessions.filter((session: any) => session.status === 'running').length;
      }

      const totalActiveSessions = activeInteractiveSessions.length + activeTerminalSessions;

      if (totalActiveSessions > 0) {
        console.error(`🔄 Keeping server alive: ${activeInteractiveSessions.length} interactive + ${activeTerminalSessions} terminal sessions active`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error checking active sessions:', error);
      return false;
    }
  }

  private hasActiveConnections(): boolean {
    try {
      // Check terminal viewer connections
      if (this.terminalViewerService && this.terminalViewerService.isEnabled()) {
        const status = this.terminalViewerService.getStatus();
        const activeConnections = status.activeSessions.reduce((total, session) => total + session.viewerCount, 0);

        if (activeConnections > 0) {
          console.error(`🌐 Keeping server alive: ${activeConnections} active WebSocket connections`);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking active connections:', error);
      return false;
    }
  }

  private startHeartbeat(): void {
    if (!this.config.lifecycle.enableHeartbeat) {
      return;
    }

    // If inactivity timeout is disabled (0), don't start inactivity monitoring
    if (this.config.lifecycle.inactivityTimeout <= 0) {
      console.error('🔄 Inactivity timeout disabled - server will only shut down on client disconnection');
      return;
    }

    // Calculate heartbeat interval - check every 10 seconds or half the timeout, whichever is smaller
    const heartbeatInterval = Math.min(10000, Math.floor(this.config.lifecycle.inactivityTimeout / 2));

    this.heartbeatInterval = setInterval(async () => {
      const timeSinceLastActivity = Date.now() - this.lastActivity;

      if (timeSinceLastActivity > this.config.lifecycle.inactivityTimeout) {
        // Check if there are active sessions or connections that should keep server alive
        const hasActiveSessions = await this.hasActiveSessions();
        const hasActiveConnections = this.hasActiveConnections();

        if (hasActiveSessions || hasActiveConnections) {
          console.error(`⏰ No client activity for ${Math.round(timeSinceLastActivity / 1000)}s, but keeping server alive due to active sessions/connections`);
          // Update activity to prevent shutdown while sessions are active
          this.updateActivity();
        } else {
          console.error(`⏰ No activity for ${Math.round(timeSinceLastActivity / 1000)}s, shutting down`);
          this.gracefulShutdown('Inactivity timeout');
        }
      }
    }, heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private async cleanupResources(): Promise<void> {
    console.error('🧹 Cleaning up resources...');

    try {
      // Cleanup shell executor (kill any running processes)
      if (this.shellExecutor && typeof (this.shellExecutor as any).cleanup === 'function') {
        await (this.shellExecutor as any).cleanup();
        console.error('🔧 Shell executor cleaned up');
      }

      // Cleanup audit logger (flush any pending logs)
      if (this.auditLogger && typeof (this.auditLogger as any).flush === 'function') {
        await (this.auditLogger as any).flush();
        console.error('📝 Audit logs flushed');
      }

      // Clear any pending confirmations
      if (this.confirmationManager && typeof (this.confirmationManager as any).cleanup === 'function') {
        (this.confirmationManager as any).cleanup();
        console.error('✅ Confirmations cleared');
      }

      // Remove stdin/stdout listeners to prevent memory leaks
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      process.stdin.removeAllListeners('data');
      process.stdout.removeAllListeners('error');
      console.error('🎧 Event listeners removed');

    } catch (error) {
      console.error('⚠️  Error during resource cleanup:', error);
    }
  }

  async gracefulShutdown(reason: string): Promise<void> {
    if (this.isShuttingDown) {
      return; // Already shutting down
    }

    this.isShuttingDown = true;
    console.error(`🔄 Initiating graceful shutdown: ${reason}`);

    try {
      // Stop heartbeat monitoring
      this.stopHeartbeat();

      // Set a timeout to force exit if graceful shutdown takes too long
      this.shutdownTimeout = setTimeout(() => {
        console.error('⚠️  Graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, this.config.lifecycle.gracefulShutdownTimeout);

      // Log shutdown
      await this.auditLogger.log({
        level: 'info',
        message: 'MCP Shell Server shutting down',
        context: {
          reason,
          pid: process.pid,
          uptime: process.uptime(),
        },
      });

      // Save session state
      if (this.config.context.sessionPersistence) {
        await (this.contextManager as any).persistSession();
        console.error('💾 Session state saved');
      }

      // Shutdown terminal viewer service
      if (this.terminalViewerService?.isEnabled()) {
        await this.terminalViewerService.stop();
        console.error('📺 Terminal viewer service stopped');
      }

      // Shutdown terminal session manager
      if (this.terminalSessionManager) {
        await this.terminalSessionManager.shutdown();
        console.error('🖥️  Terminal sessions terminated');
      }

      // Shutdown interactive sessions
      await this.shellExecutor.shutdown();
      console.error('🔄 Interactive sessions terminated');

      // Cleanup resources
      await this.cleanupResources();

      // Close transport connection
      if (this.transport && typeof this.transport.close === 'function') {
        await this.transport.close();
        console.error('🔌 Transport connection closed');
      }

      // Clear shutdown timeout
      if (this.shutdownTimeout) {
        clearTimeout(this.shutdownTimeout);
      }

      console.error('✅ Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  private formatContextDisplay(context: any): string {
    const lines: string[] = [];

    lines.push('## Current Context');
    lines.push('');
    lines.push(`**Session ID:** ${context.sessionId || 'default'}`);
    lines.push(`**Working Directory:** \`${context.currentDirectory || process.cwd()}\``);

    if (context.environmentVariables && Object.keys(context.environmentVariables).length > 0) {
      lines.push('');
      lines.push('**Environment Variables:**');
      Object.entries(context.environmentVariables).forEach(([key, value]) => {
        lines.push(`• \`${key}\` = \`${value}\``);
      });
    }

    if (context.commandHistory && context.commandHistory.length > 0) {
      lines.push('');
      lines.push(`**Recent Commands:** ${context.commandHistory.length} in history`);
    }

    if (context.fileSystemChanges && context.fileSystemChanges.length > 0) {
      lines.push('');
      lines.push(`**File System Changes:** ${context.fileSystemChanges.length} tracked changes`);
    }

    return lines.join('\n');
  }

  private formatHistoryDisplay(history: any[], limit?: number): string {
    const lines: string[] = [];

    lines.push('## Command History');
    lines.push('');

    if (history.length === 0) {
      lines.push('*No commands in history*');
      return lines.join('\n');
    }

    lines.push(`**Showing ${history.length} command(s)${limit ? ` (limit: ${limit})` : ''}**`);
    lines.push('');

    history.forEach((entry, index) => {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      const success = entry.output?.summary?.success ? '✅' : '❌';

      lines.push(`### ${index + 1}. ${success} \`${entry.command}\``);
      lines.push(`**Time:** ${timestamp}`);
      lines.push(`**Directory:** \`${entry.workingDirectory || 'unknown'}\``);

      if (entry.output?.summary?.mainResult) {
        lines.push(`**Result:** ${entry.output.summary.mainResult}`);
      }

      if (entry.aiContext) {
        lines.push(`**AI Context:** ${entry.aiContext}`);
      }

      lines.push('');
    });

    return lines.join('\n');
  }

  private recordConfigurationChange(section: string, changes: Record<string, any>, previousValues: Record<string, any>, user?: string): void {
    const changeId = uuidv4();
    this.configurationHistory.push({
      id: changeId,
      timestamp: new Date(),
      section,
      changes,
      previousValues,
      user
    });

    // Keep only the last 100 configuration changes
    if (this.configurationHistory.length > 100) {
      this.configurationHistory = this.configurationHistory.slice(-100);
    }

    // Log the configuration change
    this.mcpLogger.notice(`Configuration changed: ${section}`, 'mcp-server', {
      changeId,
      section,
      changes,
      user
    });
  }

  private async reinitializeComponents(section?: string): Promise<void> {
    if (!section || section === 'security') {
      this.securityManager = new SecurityManager(this.config.security, this.auditLogger);
    }
    if (!section || section === 'context') {
      this.contextManager = new ContextManager(this.config.context, this.auditLogger);
    }
    if (!section || section === 'mcpLogging') {
      this.mcpLogger = new MCPLogger(this.config.mcpLogging || {
        enabled: true,
        minLevel: 'info',
        rateLimitPerMinute: 60,
        maxQueueSize: 100,
        includeContext: true
      });
    }
    if (!section || section === 'audit') {
      this.auditLogger = new AuditLogger(this.config.audit);
    }
    if (!section || section === 'display') {
      this.displayFormatter = new DisplayFormatter(this.config.display);
    }
    if (!section || section === 'sessions' || section === 'terminalViewer') {
      this.terminalSessionManager = new TerminalSessionManager(
        this.config.sessions,
        this.config.terminalViewer
      );
    }
    if (!section || section === 'output') {
      this.shellExecutor = new ShellExecutor(
        this.securityManager,
        this.contextManager,
        this.auditLogger,
        this.config
      );
    }
  }

  private formatSecurityStatusDisplay(securityData: any): string {
    const lines: string[] = [];

    lines.push('## Security Status');
    lines.push('');

    const config = securityData.securityConfig;

    // Security level with icon
    const levelIcons = {
      strict: '🔒',
      moderate: '⚖️',
      permissive: '🔓'
    };
    const levelIcon = levelIcons[config.level as keyof typeof levelIcons] || '❓';
    lines.push(`**Security Level:** ${levelIcon} ${config.level.toUpperCase()}`);

    // Confirmation settings
    const confirmIcon = config.confirmDangerous ? '✅' : '❌';
    lines.push(`**Dangerous Command Confirmation:** ${confirmIcon} ${config.confirmDangerous ? 'Enabled' : 'Disabled'}`);

    // Timeout
    lines.push(`**Command Timeout:** ${Math.round(config.timeout / 1000)}s`);

    // Sandboxing
    if (config.sandboxing) {
      lines.push('');
      lines.push('**Sandboxing Configuration:**');
      const sandboxIcon = config.sandboxing.enabled ? '✅' : '❌';
      lines.push(`• Enabled: ${sandboxIcon} ${config.sandboxing.enabled ? 'Yes' : 'No'}`);

      if (config.sandboxing.enabled) {
        const networkIcon = config.sandboxing.networkAccess ? '🌐' : '🚫';
        lines.push(`• Network Access: ${networkIcon} ${config.sandboxing.networkAccess ? 'Allowed' : 'Blocked'}`);
        lines.push(`• File System Access: 📁 ${config.sandboxing.fileSystemAccess}`);
      }
    }

    // Resource limits
    if (config.resourceLimits) {
      lines.push('');
      lines.push('**Resource Limits:**');
      if (config.resourceLimits.maxMemoryUsage) {
        lines.push(`• Memory: 💾 ${config.resourceLimits.maxMemoryUsage}MB`);
      }
      if (config.resourceLimits.maxFileSize) {
        lines.push(`• File Size: 📄 ${config.resourceLimits.maxFileSize}MB`);
      }
      if (config.resourceLimits.maxProcesses) {
        lines.push(`• Max Processes: ⚙️ ${config.resourceLimits.maxProcesses}`);
      }
    }

    // Blocked commands
    if (config.blockedCommands && config.blockedCommands.length > 0) {
      lines.push('');
      lines.push('**Blocked Commands:**');
      config.blockedCommands.forEach((cmd: string) => {
        lines.push(`• \`${cmd}\``);
      });
    }

    // Allowed directories
    if (config.allowedDirectories && config.allowedDirectories.length > 0) {
      lines.push('');
      lines.push('**Allowed Directories:**');
      config.allowedDirectories.forEach((dir: string) => {
        lines.push(`• \`${dir}\``);
      });
    }

    // Pending confirmations
    if (securityData.pendingConfirmations > 0) {
      lines.push('');
      lines.push(`**Pending Confirmations:** ⏳ ${securityData.pendingConfirmations}`);
    }

    // Server info
    lines.push('');
    lines.push('**Server Information:**');
    lines.push(`• Version: ${securityData.serverInfo.version}`);
    lines.push(`• Platform: ${securityData.serverInfo.platform}`);
    lines.push(`• Node.js: ${securityData.serverInfo.nodeVersion}`);

    return lines.join('\n');
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  const server = new MCPShellServer();

  server.start().catch((error) => {
    console.error('Failed to start MCP Shell Server:', error);
    process.exit(1);
  });

  // Enhanced signal handling for graceful shutdown
  process.on('SIGINT', () => {
    server.gracefulShutdown('SIGINT received');
  });

  process.on('SIGTERM', () => {
    server.gracefulShutdown('SIGTERM received');
  });

  process.on('SIGHUP', () => {
    server.gracefulShutdown('SIGHUP received');
  });

  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    server.gracefulShutdown('Uncaught exception');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    server.gracefulShutdown('Unhandled rejection');
  });
}

export { MCPShellServer };
