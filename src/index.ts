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
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as path from 'path';

import { ShellExecutor } from './core/executor';
import { SecurityManager } from './security/manager';
import { ContextManager } from './context/manager';
import { AuditLogger } from './audit/logger';
import { ConfirmationManager } from './security/confirmation';
import { ServerConfig } from './types/index';

// Default configuration
const DEFAULT_CONFIG: ServerConfig = {
  security: {
    level: 'moderate',
    confirmDangerous: true,
    allowedDirectories: [process.cwd()],
    blockedCommands: [
      'rm -rf /',
      'format',
      'del /f /s /q C:\\',
      'sudo rm -rf /',
      'dd if=/dev/zero',
      'mkfs',
      'fdisk',
      'parted'
    ],
    timeout: 300000, // 5 minutes
    resourceLimits: {
      maxMemoryUsage: 1024, // 1GB
      maxFileSize: 100, // 100MB
      maxProcesses: 10,
    },
    sandboxing: {
      enabled: false, // Disabled by default for compatibility
      networkAccess: true,
      fileSystemAccess: 'full',
    },
  },
  context: {
    preserveWorkingDirectory: true,
    sessionPersistence: true,
    maxHistorySize: 1000,
  },
  output: {
    formatStructured: true,
    stripAnsi: true,
    summarizeVerbose: true,
    enableAiOptimizations: true,
    maxOutputLength: 10000, // 10KB max output
  },
  audit: {
    enabled: true,
    logLevel: 'info',
    retention: 30,
    logDirectory: process.env.MCP_EXEC_LOG_DIR ||
                  (process.env.HOME && path.join(process.env.HOME, '.mcp-exec')) ||
                  (process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.mcp-exec')), // Safer default
    monitoring: {
      enabled: true,
      alertRetention: 7,
      maxAlertsPerHour: 100,
    },
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
});

const GetContextSchema = z.object({
  sessionId: z.string().optional().describe('Session ID to get context for'),
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

class MCPShellServer {
  private server: Server;
  private shellExecutor: ShellExecutor;
  private securityManager: SecurityManager;
  private contextManager: ContextManager;
  private auditLogger: AuditLogger;
  private confirmationManager: ConfirmationManager;
  private config: ServerConfig;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.server = new Server(
      {
        name: 'mcp-exec',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize components
    this.securityManager = new SecurityManager(this.config.security);
    this.contextManager = new ContextManager(this.config.context);
    this.auditLogger = new AuditLogger(this.config.audit);
    this.confirmationManager = new ConfirmationManager();
    this.shellExecutor = new ShellExecutor(
      this.securityManager,
      this.contextManager,
      this.auditLogger,
      this.config
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'execute_command',
            description: 'Execute a shell command with security validation and context preservation',
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
              },
              required: ['command'],
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
          },
          {
            name: 'get_security_status',
            description: 'Get current security configuration and status',
            inputSchema: {
              type: 'object',
              properties: {},
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
          },
          {
            name: 'get_pending_confirmations',
            description: 'Get list of commands pending confirmation',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_intent_summary',
            description: 'Get summary of command intents and AI optimization insights',
            inputSchema: {
              type: 'object',
              properties: {},
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
          },
          {
            name: 'get_audit_config',
            description: 'Get current audit configuration including log file location',
            inputSchema: {
              type: 'object',
              properties: {},
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
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'execute_command': {
            const parsed = ExecuteCommandSchema.parse(args);
            const result = await this.shellExecutor.executeCommand(parsed);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'get_context': {
            const parsed = GetContextSchema.parse(args);
            const context = await this.contextManager.getCurrentContext(parsed.sessionId);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(context, null, 2),
                },
              ],
            };
          }

          case 'get_history': {
            const parsed = GetHistorySchema.parse(args);
            const history = await this.contextManager.getHistory(parsed.limit, parsed.filter);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(history, null, 2),
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
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    securityConfig: this.config.security,
                    pendingConfirmations: this.confirmationManager.getAllPendingConfirmations().length,
                    serverInfo: {
                      version: '1.0.0',
                      platform: process.platform,
                      nodeVersion: process.version,
                    }
                  }, null, 2),
                },
              ],
            };
          }

          case 'confirm_command': {
            const parsed = ConfirmCommandSchema.parse(args);
            const confirmed = this.confirmationManager.confirmCommand(parsed.confirmationId);

            if (confirmed) {
              const confirmation = this.confirmationManager.getPendingConfirmation(parsed.confirmationId);
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
  }

  async start(): Promise<void> {
    // Load previous session if configured
    await this.contextManager.loadSession();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

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
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  const server = new MCPShellServer();

  server.start().catch((error) => {
    console.error('Failed to start MCP Shell Server:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.error('Shutting down MCP Shell Server...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('Shutting down MCP Shell Server...');
    process.exit(0);
  });
}

export { MCPShellServer };
