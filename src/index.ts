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

import { ShellExecutor } from './core/executor';
import { SecurityManager } from './security/manager';
import { ContextManager } from './context/manager';
import { AuditLogger } from './audit/logger';
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

class MCPShellServer {
  private server: Server;
  private shellExecutor: ShellExecutor;
  private securityManager: SecurityManager;
  private contextManager: ContextManager;
  private auditLogger: AuditLogger;
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
    const transport = new StdioServerTransport();
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

export { MCPShellServer };
