#!/usr/bin/env node
"use strict";
/**
 * MCP Shell Execution Server
 * Enhanced shell command execution with security, context preservation, and AI optimization
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPShellServer = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const path = __importStar(require("path"));
const executor_1 = require("./core/executor");
const manager_1 = require("./security/manager");
const manager_2 = require("./context/manager");
const logger_1 = require("./audit/logger");
const confirmation_1 = require("./security/confirmation");
const display_formatter_1 = require("./utils/display-formatter");
// Default configuration
const DEFAULT_CONFIG = {
    security: {
        level: 'moderate',
        confirmDangerous: true,
        allowedDirectories: [
            process.cwd(),
            '/tmp',
        ].filter(dir => dir !== ''),
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
    sessions: {
        maxInteractiveSessions: 10,
        sessionTimeout: 30 * 60 * 1000, // 30 minutes
        outputBufferSize: 1000,
    },
    lifecycle: {
        inactivityTimeout: parseInt(process.env.MCP_EXEC_INACTIVITY_TIMEOUT || '300000'), // 5 minutes default
        gracefulShutdownTimeout: parseInt(process.env.MCP_EXEC_SHUTDOWN_TIMEOUT || '5000'), // 5 seconds default
        enableHeartbeat: process.env.MCP_EXEC_ENABLE_HEARTBEAT !== 'false', // enabled by default
    },
    output: {
        formatStructured: true,
        stripAnsi: true,
        summarizeVerbose: true,
        enableAiOptimizations: true,
        maxOutputLength: 10000, // 10KB max output
    },
    display: {
        showCommandHeader: true,
        showExecutionTime: true,
        showExitCode: true,
        formatCodeBlocks: true,
        includeMetadata: true,
        includeSuggestions: true,
        useMarkdown: true,
        colorizeOutput: false,
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
const ExecuteCommandSchema = zod_1.z.object({
    command: zod_1.z.string().describe('The shell command to execute'),
    args: zod_1.z.array(zod_1.z.string()).optional().describe('Command arguments'),
    cwd: zod_1.z.string().optional().describe('Working directory for command execution'),
    env: zod_1.z.record(zod_1.z.string()).optional().describe('Environment variables'),
    timeout: zod_1.z.number().optional().describe('Timeout in milliseconds'),
    shell: zod_1.z.union([zod_1.z.boolean(), zod_1.z.string()]).optional().describe('Shell to use for execution'),
    aiContext: zod_1.z.string().optional().describe('AI context/intent for this command'),
    session: zod_1.z.string().optional().describe('Session ID for interactive execution, or "new" to start new session'),
});
const GetContextSchema = zod_1.z.object({
    sessionId: zod_1.z.string().optional().describe('Session ID to get context for'),
});
const ListSessionsSchema = zod_1.z.object({});
const KillSessionSchema = zod_1.z.object({
    sessionId: zod_1.z.string().describe('Session ID to terminate'),
});
const ReadSessionOutputSchema = zod_1.z.object({
    sessionId: zod_1.z.string().describe('Session ID to read output from'),
});
const GetHistorySchema = zod_1.z.object({
    limit: zod_1.z.number().optional().describe('Number of history entries to return'),
    filter: zod_1.z.string().optional().describe('Filter commands by pattern'),
});
const SetWorkingDirectorySchema = zod_1.z.object({
    directory: zod_1.z.string().describe('Directory path to set as working directory'),
});
const ClearHistorySchema = zod_1.z.object({
    confirm: zod_1.z.boolean().optional().describe('Confirm clearing history'),
});
const GetFileSystemChangesSchema = zod_1.z.object({
    since: zod_1.z.string().optional().describe('ISO date string to filter changes since'),
});
const UpdateSecurityConfigSchema = zod_1.z.object({
    level: zod_1.z.enum(['strict', 'moderate', 'permissive']).optional().describe('Security level'),
    confirmDangerous: zod_1.z.boolean().optional().describe('Require confirmation for dangerous commands'),
    sandboxing: zod_1.z.object({
        enabled: zod_1.z.boolean().optional(),
        networkAccess: zod_1.z.boolean().optional(),
        fileSystemAccess: zod_1.z.enum(['read-only', 'restricted', 'full']).optional(),
    }).optional().describe('Sandboxing configuration'),
});
const GetSecurityStatusSchema = zod_1.z.object({});
const ConfirmCommandSchema = zod_1.z.object({
    confirmationId: zod_1.z.string().describe('Confirmation ID for the pending command'),
});
const GetPendingConfirmationsSchema = zod_1.z.object({});
const GetIntentSummarySchema = zod_1.z.object({});
const SuggestNextCommandsSchema = zod_1.z.object({
    command: zod_1.z.string().describe('Current command to get suggestions for'),
});
const GenerateAuditReportSchema = zod_1.z.object({
    startDate: zod_1.z.string().describe('Start date for report (ISO string)'),
    endDate: zod_1.z.string().describe('End date for report (ISO string)'),
    reportType: zod_1.z.enum(['standard', 'compliance']).optional().describe('Type of report to generate'),
});
const ExportLogsSchema = zod_1.z.object({
    format: zod_1.z.enum(['json', 'csv', 'xml']).describe('Export format'),
    startDate: zod_1.z.string().optional().describe('Start date filter (ISO string)'),
    endDate: zod_1.z.string().optional().describe('End date filter (ISO string)'),
    sessionId: zod_1.z.string().optional().describe('Filter by session ID'),
});
const GetAlertsSchema = zod_1.z.object({
    severity: zod_1.z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by severity'),
    acknowledged: zod_1.z.boolean().optional().describe('Filter by acknowledgment status'),
    limit: zod_1.z.number().optional().describe('Maximum number of alerts to return'),
});
const AcknowledgeAlertSchema = zod_1.z.object({
    alertId: zod_1.z.string().describe('Alert ID to acknowledge'),
    acknowledgedBy: zod_1.z.string().describe('User acknowledging the alert'),
});
const GetAuditConfigSchema = zod_1.z.object({});
const UpdateAuditConfigSchema = zod_1.z.object({
    logLevel: zod_1.z.enum(['debug', 'info', 'warn', 'error']).optional().describe('Audit log level'),
    retention: zod_1.z.number().optional().describe('Log retention in days'),
    logFile: zod_1.z.string().optional().describe('Full path to audit log file'),
    logDirectory: zod_1.z.string().optional().describe('Directory for audit log files'),
});
class MCPShellServer {
    server;
    shellExecutor;
    securityManager;
    contextManager;
    auditLogger;
    confirmationManager;
    displayFormatter;
    config;
    isShuttingDown = false;
    transport;
    shutdownTimeout;
    heartbeatInterval;
    lastActivity = Date.now();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.server = new index_js_1.Server({
            name: 'mcp-exec',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        // Initialize components
        this.securityManager = new manager_1.SecurityManager(this.config.security);
        this.contextManager = new manager_2.ContextManager(this.config.context);
        this.auditLogger = new logger_1.AuditLogger(this.config.audit);
        this.confirmationManager = new confirmation_1.ConfirmationManager();
        this.displayFormatter = new display_formatter_1.DisplayFormatter(this.config.display);
        this.shellExecutor = new executor_1.ShellExecutor(this.securityManager, this.contextManager, this.auditLogger, this.config);
        this.setupHandlers();
    }
    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'execute_command',
                        description: 'Execute a shell command with security validation and context preservation. Supports interactive sessions.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                command: { type: 'string', description: 'The shell command to execute' },
                                args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
                                cwd: { type: 'string', description: 'Working directory for command execution' },
                                env: { type: 'object', description: 'Environment variables' },
                                timeout: { type: 'number', description: 'Timeout in milliseconds' },
                                shell: { type: ['boolean', 'string'], description: 'Shell to use for execution' },
                                session: { type: 'string', description: 'Session ID for interactive execution, or "new" to start new session' },
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
                    {
                        name: 'list_sessions',
                        description: 'List all active interactive sessions',
                        inputSchema: {
                            type: 'object',
                            properties: {},
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
                    },
                ],
            };
        });
        // Handle tool calls
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            // Update activity on any tool call
            this.updateActivity();
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case 'execute_command': {
                        const parsed = ExecuteCommandSchema.parse(args);
                        const result = await this.shellExecutor.executeCommand(parsed);
                        // Build the full command string for display
                        const fullCommand = parsed.args && parsed.args.length > 0
                            ? `${parsed.command} ${parsed.args.join(' ')}`
                            : parsed.command;
                        // Format the output for enhanced display
                        const formattedOutput = this.displayFormatter.formatCommandOutput(fullCommand, result, {
                            showInput: true,
                            aiContext: parsed.aiContext
                        });
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: formattedOutput,
                                },
                            ],
                        };
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
                        }
                        else {
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
                        this.securityManager = new manager_1.SecurityManager(this.config.security);
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
                        }
                        else {
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
                        }
                        else {
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
                        const filters = {};
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
                        const sessions = await this.shellExecutor.listSessions();
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify({
                                        sessions: sessions.map(session => ({
                                            sessionId: session.sessionId,
                                            command: session.command,
                                            startTime: session.startTime,
                                            lastActivity: session.lastActivity,
                                            status: session.status,
                                            cwd: session.cwd,
                                            aiContext: session.aiContext,
                                        })),
                                        totalSessions: sessions.length,
                                        maxSessions: this.config.sessions.maxInteractiveSessions,
                                    }, null, 2),
                                },
                            ],
                        };
                    }
                    case 'kill_session': {
                        const parsed = KillSessionSchema.parse(args);
                        try {
                            await this.shellExecutor.killSession(parsed.sessionId);
                            return {
                                content: [
                                    {
                                        type: 'text',
                                        text: JSON.stringify({
                                            success: true,
                                            message: `Session ${parsed.sessionId} terminated`,
                                            sessionId: parsed.sessionId,
                                        }, null, 2),
                                    },
                                ],
                            };
                        }
                        catch (error) {
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
                        try {
                            const output = await this.shellExecutor.readSessionOutput(parsed.sessionId);
                            return {
                                content: [
                                    {
                                        type: 'text',
                                        text: JSON.stringify({
                                            sessionId: output.sessionId,
                                            stdout: output.stdout,
                                            stderr: output.stderr,
                                            hasMore: output.hasMore,
                                            status: output.status,
                                        }, null, 2),
                                    },
                                ],
                            };
                        }
                        catch (error) {
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
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
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
    async start() {
        // Load previous session if configured
        await this.contextManager.loadSession();
        this.transport = new stdio_js_1.StdioServerTransport();
        // Set up connection monitoring
        this.setupConnectionMonitoring();
        await this.server.connect(this.transport);
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
    setupConnectionMonitoring() {
        // Monitor stdin for closure (indicates client disconnection)
        process.stdin.on('end', () => {
            console.error('📡 Client disconnected (stdin closed)');
            this.gracefulShutdown('Client disconnection');
        });
        process.stdin.on('error', (error) => {
            console.error('📡 Stdin error:', error.message);
            this.gracefulShutdown('Stdin error');
        });
        // Monitor for broken pipe (client closed connection)
        process.stdout.on('error', (error) => {
            console.error('📡 Stdout error:', error.message);
            this.gracefulShutdown('Stdout error');
        });
        // Monitor stdin for data to track activity
        process.stdin.on('data', () => {
            this.updateActivity();
        });
        // Start heartbeat monitoring
        this.startHeartbeat();
    }
    updateActivity() {
        this.lastActivity = Date.now();
    }
    startHeartbeat() {
        if (!this.config.lifecycle.enableHeartbeat) {
            return;
        }
        // Check for activity every 30 seconds
        this.heartbeatInterval = setInterval(() => {
            const timeSinceLastActivity = Date.now() - this.lastActivity;
            if (timeSinceLastActivity > this.config.lifecycle.inactivityTimeout) {
                console.error(`⏰ No activity for ${Math.round(timeSinceLastActivity / 1000)}s, shutting down`);
                this.gracefulShutdown('Inactivity timeout');
            }
        }, 30000);
    }
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
        }
    }
    async cleanupResources() {
        console.error('🧹 Cleaning up resources...');
        try {
            // Cleanup shell executor (kill any running processes)
            if (this.shellExecutor && typeof this.shellExecutor.cleanup === 'function') {
                await this.shellExecutor.cleanup();
                console.error('🔧 Shell executor cleaned up');
            }
            // Cleanup audit logger (flush any pending logs)
            if (this.auditLogger && typeof this.auditLogger.flush === 'function') {
                await this.auditLogger.flush();
                console.error('📝 Audit logs flushed');
            }
            // Clear any pending confirmations
            if (this.confirmationManager && typeof this.confirmationManager.cleanup === 'function') {
                this.confirmationManager.cleanup();
                console.error('✅ Confirmations cleared');
            }
            // Remove stdin/stdout listeners to prevent memory leaks
            process.stdin.removeAllListeners('end');
            process.stdin.removeAllListeners('error');
            process.stdin.removeAllListeners('data');
            process.stdout.removeAllListeners('error');
            console.error('🎧 Event listeners removed');
        }
        catch (error) {
            console.error('⚠️  Error during resource cleanup:', error);
        }
    }
    async gracefulShutdown(reason) {
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
                await this.contextManager.persistSession();
                console.error('💾 Session state saved');
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
        }
        catch (error) {
            console.error('❌ Error during graceful shutdown:', error);
            process.exit(1);
        }
    }
    formatContextDisplay(context) {
        const lines = [];
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
    formatHistoryDisplay(history, limit) {
        const lines = [];
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
    formatSecurityStatusDisplay(securityData) {
        const lines = [];
        lines.push('## Security Status');
        lines.push('');
        const config = securityData.securityConfig;
        // Security level with icon
        const levelIcons = {
            strict: '🔒',
            moderate: '⚖️',
            permissive: '🔓'
        };
        const levelIcon = levelIcons[config.level] || '❓';
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
            config.blockedCommands.forEach((cmd) => {
                lines.push(`• \`${cmd}\``);
            });
        }
        // Allowed directories
        if (config.allowedDirectories && config.allowedDirectories.length > 0) {
            lines.push('');
            lines.push('**Allowed Directories:**');
            config.allowedDirectories.forEach((dir) => {
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
exports.MCPShellServer = MCPShellServer;
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
//# sourceMappingURL=index.js.map