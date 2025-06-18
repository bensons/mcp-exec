#!/usr/bin/env node
"use strict";
/**
 * MCP Shell Execution Server
 * Enhanced shell command execution with security, context preservation, and AI optimization
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPShellServer = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const executor_1 = require("./core/executor");
const manager_1 = require("./security/manager");
const manager_2 = require("./context/manager");
const logger_1 = require("./audit/logger");
const confirmation_1 = require("./security/confirmation");
// Default configuration
const DEFAULT_CONFIG = {
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
});
const GetContextSchema = zod_1.z.object({
    sessionId: zod_1.z.string().optional().describe('Session ID to get context for'),
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
class MCPShellServer {
    server;
    shellExecutor;
    securityManager;
    contextManager;
    auditLogger;
    confirmationManager;
    config;
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
                ],
            };
        });
        // Handle tool calls
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
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
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        // Log server start
        await this.auditLogger.log({
            level: 'info',
            message: 'MCP Shell Server started',
            context: {
                config: this.config,
                pid: process.pid,
                platform: process.platform,
                nodeVersion: process.version,
            },
        });
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
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('Shutting down MCP Shell Server...');
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        console.log('Shutting down MCP Shell Server...');
        process.exit(0);
    });
}
//# sourceMappingURL=index.js.map