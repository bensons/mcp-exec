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
const uuid_1 = require("uuid");
const executor_1 = require("./core/executor");
const manager_1 = require("./security/manager");
const manager_2 = require("./context/manager");
const logger_1 = require("./audit/logger");
const confirmation_1 = require("./security/confirmation");
const display_formatter_1 = require("./utils/display-formatter");
const viewer_service_1 = require("./terminal/viewer-service");
const terminal_session_manager_1 = require("./terminal/terminal-session-manager");
// Default configuration
const DEFAULT_CONFIG = {
    security: {
        level: process.env.MCP_EXEC_SECURITY_LEVEL || 'permissive',
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
            fileSystemAccess: process.env.MCP_EXEC_FILESYSTEM_ACCESS || 'full',
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
        inactivityTimeout: parseInt(process.env.MCP_EXEC_INACTIVITY_TIMEOUT || '300000'), // 5 minutes default
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
        logLevel: process.env.MCP_EXEC_AUDIT_LOG_LEVEL || 'debug',
        retention: parseInt(process.env.MCP_EXEC_AUDIT_RETENTION || '30'),
        logDirectory: process.env.MCP_EXEC_LOG_DIR ||
            (process.env.HOME && path.join(process.env.HOME, '.mcp-exec')) ||
            (process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.mcp-exec')), // Safer default
        monitoring: {
            enabled: process.env.MCP_EXEC_MONITORING_ENABLED !== 'false', // Enabled by default
            alertRetention: parseInt(process.env.MCP_EXEC_ALERT_RETENTION || '7'),
            maxAlertsPerHour: parseInt(process.env.MCP_EXEC_MAX_ALERTS_PER_HOUR || '100'),
        },
    },
    terminalViewer: {
        enabled: process.env.MCP_EXEC_TERMINAL_VIEWER_ENABLED === 'true', // Disabled by default
        port: parseInt(process.env.MCP_EXEC_TERMINAL_VIEWER_PORT || '3000'),
        host: process.env.MCP_EXEC_TERMINAL_VIEWER_HOST || '127.0.0.1',
        maxSessions: parseInt(process.env.MCP_EXEC_TERMINAL_VIEWER_MAX_SESSIONS || '10'),
        sessionTimeout: parseInt(process.env.MCP_EXEC_TERMINAL_VIEWER_SESSION_TIMEOUT || '1800000'), // 30 minutes
        bufferSize: parseInt(process.env.MCP_EXEC_TERMINAL_VIEWER_BUFFER_SIZE || '1000'),
        enableAuth: process.env.MCP_EXEC_TERMINAL_VIEWER_ENABLE_AUTH === 'true',
        authToken: process.env.MCP_EXEC_TERMINAL_VIEWER_AUTH_TOKEN,
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
    enableTerminalViewer: zod_1.z.boolean().optional().describe('Create a terminal session with browser viewer instead of regular execution'),
    terminalSize: zod_1.z.object({
        cols: zod_1.z.number().default(80),
        rows: zod_1.z.number().default(24)
    }).optional().describe('Terminal size when enableTerminalViewer is true'),
});
const StartInteractiveSessionSchema = zod_1.z.object({
    command: zod_1.z.string().optional().describe('Initial command to run in the session (defaults to system shell)'),
    args: zod_1.z.array(zod_1.z.string()).optional().describe('Command arguments'),
    cwd: zod_1.z.string().optional().describe('Working directory for the session'),
    env: zod_1.z.record(zod_1.z.string()).optional().describe('Environment variables'),
    shell: zod_1.z.union([zod_1.z.boolean(), zod_1.z.string()]).optional().describe('Shell to use for execution'),
    aiContext: zod_1.z.string().optional().describe('AI context/intent for this session'),
});
const StartTerminalSessionSchema = zod_1.z.object({
    command: zod_1.z.string().optional().describe('Initial command to run in the terminal session (defaults to system shell)'),
    args: zod_1.z.array(zod_1.z.string()).optional().describe('Command arguments'),
    cwd: zod_1.z.string().optional().describe('Working directory for the session'),
    env: zod_1.z.record(zod_1.z.string()).optional().describe('Environment variables'),
    terminalSize: zod_1.z.object({
        cols: zod_1.z.number().default(80),
        rows: zod_1.z.number().default(24)
    }).optional().describe('Terminal size'),
    aiContext: zod_1.z.string().optional().describe('AI context/intent for this session'),
});
const SendToSessionSchema = zod_1.z.object({
    sessionId: zod_1.z.string().describe('Session ID to send input to'),
    input: zod_1.z.string().describe('Input to send to the session'),
    addNewline: zod_1.z.boolean().optional().default(true).describe('Whether to add a newline to the input'),
});
const TerminateTerminalSessionSchema = zod_1.z.object({
    sessionId: zod_1.z.string().describe('Terminal session ID to terminate'),
    force: zod_1.z.boolean().optional().default(false).describe('Force termination without graceful shutdown'),
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
// Terminal Viewer Schemas
const ToggleTerminalViewerSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().describe('Enable or disable the terminal viewer service'),
    port: zod_1.z.number().optional().describe('Port for the terminal viewer service'),
});
const GetTerminalViewerStatusSchema = zod_1.z.object({});
class MCPShellServer {
    server;
    shellExecutor;
    securityManager;
    contextManager;
    auditLogger;
    confirmationManager;
    displayFormatter;
    terminalViewerService;
    terminalSessionManager;
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
                resources: {},
                prompts: {},
            },
        });
        // Initialize components
        this.securityManager = new manager_1.SecurityManager(this.config.security);
        this.contextManager = new manager_2.ContextManager(this.config.context);
        this.auditLogger = new logger_1.AuditLogger(this.config.audit);
        this.confirmationManager = new confirmation_1.ConfirmationManager();
        this.displayFormatter = new display_formatter_1.DisplayFormatter(this.config.display);
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
        // Initialize terminal components
        this.terminalSessionManager = new terminal_session_manager_1.TerminalSessionManager(this.config.sessions, this.config.terminalViewer);
        // Auto-start terminal viewer service if enabled in config
        if (this.config.terminalViewer.enabled) {
            try {
                this.terminalViewerService = new viewer_service_1.TerminalViewerService(this.config.terminalViewer);
                this.terminalViewerService.start().catch((error) => {
                    console.error('Failed to auto-start terminal viewer service:', error);
                    // Don't throw - let the server continue without terminal viewer
                    this.terminalViewerService = undefined;
                });
            }
            catch (error) {
                console.error('Failed to create terminal viewer service:', error);
                // Don't throw - let the server continue without terminal viewer
            }
        }
        this.shellExecutor = new executor_1.ShellExecutor(this.securityManager, this.contextManager, this.auditLogger, this.config);
        this.setupHandlers();
    }
    getDefaultShell() {
        if (process.platform === 'win32') {
            return 'cmd.exe';
        }
        else {
            return process.env.SHELL || '/bin/bash';
        }
    }
    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'execute_command',
                        title: 'Execute Shell Command',
                        description: 'Execute a one-shot shell command with security validation and context preservation. For interactive sessions, use start_terminal_session or start_interactive_session instead.',
                        openWorldHint: true,
                        readOnlyHint: false,
                        destructiveHint: true,
                        idempotentHint: false,
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
                    },
                    {
                        name: 'start_interactive_session',
                        title: 'Start Interactive Session',
                        description: 'Start a new interactive shell session for command execution. The session will run the specified command (or default shell) and terminate when the process exits.',
                        openWorldHint: true,
                        readOnlyHint: false,
                        destructiveHint: true,
                        idempotentHint: false,
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
                    },
                    {
                        name: 'start_terminal_session',
                        title: 'Start Terminal Session',
                        description: 'Start a new terminal session with full PTY support and browser-based viewing. The terminal provides a persistent shell environment that continues running even after individual commands exit. Use kill_session to terminate the entire terminal session.',
                        openWorldHint: true,
                        readOnlyHint: false,
                        destructiveHint: true,
                        idempotentHint: false,
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
                    },
                    {
                        name: 'send_to_session',
                        title: 'Send Input to Session',
                        description: 'Send input to an existing interactive or terminal session',
                        openWorldHint: true,
                        readOnlyHint: false,
                        destructiveHint: true,
                        idempotentHint: false,
                        inputSchema: {
                            type: 'object',
                            properties: {
                                sessionId: { type: 'string', description: 'Session ID to send input to' },
                                input: { type: 'string', description: 'Input to send to the session' },
                                addNewline: { type: 'boolean', default: true, description: 'Whether to add a newline to the input' },
                            },
                            required: ['sessionId', 'input'],
                        },
                    },
                    {
                        name: 'terminate_terminal_session',
                        title: 'Terminate Terminal Session',
                        description: 'Explicitly terminate a terminal session and its PTY process. This is different from sending "exit" commands, which only exit individual programs within the terminal.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                sessionId: { type: 'string', description: 'Terminal session ID to terminate' },
                                force: { type: 'boolean', default: false, description: 'Force termination without graceful shutdown' },
                            },
                            required: ['sessionId'],
                        },
                    },
                    {
                        name: 'get_context',
                        title: 'Get Execution Context',
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
                        title: 'Get Command History',
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
                        title: 'Set Working Directory',
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
                        title: 'Clear Command History',
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
                        title: 'Get File System Changes',
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
                        title: 'Update Security Settings',
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
                        title: 'Get Security Status',
                        description: 'Get current security configuration and status',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'confirm_command',
                        title: 'Confirm Dangerous Command',
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
                        title: 'Get Pending Confirmations',
                        description: 'Get list of commands pending confirmation',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'get_intent_summary',
                        title: 'Get AI Intent Summary',
                        description: 'Get summary of command intents and AI optimization insights',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'suggest_next_commands',
                        title: 'Suggest Next Commands',
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
                        title: 'Generate Audit Report',
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
                        title: 'Export Audit Logs',
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
                        title: 'Get Security Alerts',
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
                        title: 'Acknowledge Alert',
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
                        title: 'Get Audit Configuration',
                        description: 'Get current audit configuration including log file location',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'update_audit_config',
                        title: 'Update Audit Settings',
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
                        title: 'List Active Sessions',
                        description: 'List all active interactive sessions',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'kill_session',
                        title: 'Kill Session',
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
                        title: 'Read Session Output',
                        description: 'Read buffered output from an interactive session',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                sessionId: { type: 'string', description: 'Session ID to read output from' },
                            },
                            required: ['sessionId'],
                        },
                    },
                    {
                        name: 'toggle_terminal_viewer',
                        title: 'Toggle Terminal Viewer',
                        description: 'Enable or disable the terminal viewer HTTP service for live terminal viewing in browser',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                enabled: { type: 'boolean', description: 'Enable or disable the terminal viewer service' },
                                port: { type: 'number', description: 'Port for the terminal viewer service (optional)' },
                            },
                            required: ['enabled'],
                        },
                    },
                    {
                        name: 'get_terminal_viewer_status',
                        title: 'Get Terminal Viewer Status',
                        description: 'Get the current status of the terminal viewer service and active sessions',
                        inputSchema: {
                            type: 'object',
                            properties: {},
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
                                    this.terminalViewerService = new viewer_service_1.TerminalViewerService(this.config.terminalViewer);
                                }
                                if (!this.terminalViewerService.isEnabled()) {
                                    await this.terminalViewerService.start();
                                }
                                // Create terminal session using enhanced session manager
                                const sessionId = await this.terminalSessionManager.startSession({
                                    command: parsed.command,
                                    args: parsed.args,
                                    cwd: parsed.cwd,
                                    env: parsed.env,
                                    enableTerminalViewer: true,
                                    terminalSize: parsed.terminalSize || { cols: 80, rows: 24 },
                                    aiContext: parsed.aiContext,
                                });
                                // Add session to terminal viewer service
                                const terminalSession = this.terminalSessionManager.getSession(sessionId);
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
                            }
                            catch (error) {
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
                            const environment = {
                                ...Object.fromEntries(Object.entries(process.env).filter(([_, value]) => value !== undefined)),
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
                        }
                        catch (error) {
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
                                this.terminalViewerService = new viewer_service_1.TerminalViewerService(this.config.terminalViewer);
                            }
                            if (!this.terminalViewerService.isEnabled()) {
                                await this.terminalViewerService.start();
                            }
                            // Create terminal session using enhanced session manager
                            const sessionId = await this.terminalSessionManager.startSession({
                                command: parsed.command, // Don't default to shell - let PTY spawn the shell directly
                                args: parsed.args,
                                cwd: parsed.cwd,
                                env: parsed.env,
                                enableTerminalViewer: true,
                                terminalSize: parsed.terminalSize || { cols: 80, rows: 24 },
                                aiContext: parsed.aiContext,
                            });
                            // Add session to terminal viewer service
                            const terminalSession = this.terminalSessionManager.getSession(sessionId);
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
                        }
                        catch (error) {
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
                                }
                                else {
                                    // Fallback to direct terminal session manager
                                    await this.terminalSessionManager.sendInput({
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
                        }
                        catch (error) {
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
                            await this.terminalSessionManager.killSession(parsed.sessionId);
                            return {
                                content: [
                                    {
                                        type: 'text',
                                        text: `✅ **Terminal Session Terminated**\n\n**Session ID:** \`${parsed.sessionId}\`\n**Method:** ${parsed.force ? 'Force termination' : 'Graceful termination'}\n\nThe PTY process and all associated shell processes have been terminated.`,
                                    },
                                ],
                            };
                        }
                        catch (error) {
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
                        this.auditLogger.log({
                            level: 'debug',
                            message: 'Listing sessions from both managers',
                            context: { requestId: (0, uuid_1.v4)() }
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
                                    this.terminalViewerService = new viewer_service_1.TerminalViewerService(config);
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
                            }
                            else {
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
                        }
                        catch (error) {
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
                            const status = this.terminalViewerService.getStatus();
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
                            }
                            else {
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
                        }
                        catch (error) {
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
        // List available resources
        this.server.setRequestHandler(types_js_1.ListResourcesRequestSchema, async () => {
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
        this.server.setRequestHandler(types_js_1.ListPromptsRequestSchema, async () => {
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
        this.server.setRequestHandler(types_js_1.GetPromptRequestSchema, async (request) => {
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
        this.server.setRequestHandler(types_js_1.ReadResourceRequestSchema, async (request) => {
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
    async hasActiveSessions() {
        try {
            // Check interactive sessions
            const interactiveSessions = await this.shellExecutor.listSessions();
            const activeInteractiveSessions = interactiveSessions.filter((session) => session.status === 'running');
            // Check terminal sessions
            let activeTerminalSessions = 0;
            if (this.terminalSessionManager) {
                const terminalSessions = this.terminalSessionManager.listSessions();
                activeTerminalSessions = terminalSessions.filter((session) => session.status === 'running').length;
            }
            const totalActiveSessions = activeInteractiveSessions.length + activeTerminalSessions;
            if (totalActiveSessions > 0) {
                console.error(`🔄 Keeping server alive: ${activeInteractiveSessions.length} interactive + ${activeTerminalSessions} terminal sessions active`);
                return true;
            }
            return false;
        }
        catch (error) {
            console.error('Error checking active sessions:', error);
            return false;
        }
    }
    hasActiveConnections() {
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
        }
        catch (error) {
            console.error('Error checking active connections:', error);
            return false;
        }
    }
    startHeartbeat() {
        if (!this.config.lifecycle.enableHeartbeat) {
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
                }
                else {
                    console.error(`⏰ No activity for ${Math.round(timeSinceLastActivity / 1000)}s, shutting down`);
                    this.gracefulShutdown('Inactivity timeout');
                }
            }
        }, heartbeatInterval);
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