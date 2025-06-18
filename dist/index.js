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
class MCPShellServer {
    server;
    shellExecutor;
    securityManager;
    contextManager;
    auditLogger;
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