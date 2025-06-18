#!/usr/bin/env node
/**
 * MCP Shell Execution Server
 * Enhanced shell command execution with security, context preservation, and AI optimization
 */
import { ServerConfig } from './types/index';
declare class MCPShellServer {
    private server;
    private shellExecutor;
    private securityManager;
    private contextManager;
    private auditLogger;
    private confirmationManager;
    private config;
    constructor(config?: Partial<ServerConfig>);
    private setupHandlers;
    start(): Promise<void>;
}
export { MCPShellServer };
//# sourceMappingURL=index.d.ts.map