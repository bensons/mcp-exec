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
    private mcpLogger;
    private confirmationManager;
    private displayFormatter;
    private terminalViewerService?;
    private terminalSessionManager?;
    private config;
    private isShuttingDown;
    private transport?;
    private shutdownTimeout?;
    private heartbeatInterval?;
    private lastActivity;
    private configurationHistory;
    private originalConfig;
    constructor(config?: Partial<ServerConfig>);
    private getDefaultShell;
    private setupHandlers;
    start(): Promise<void>;
    private setupConnectionMonitoring;
    private updateActivity;
    private hasActiveSessions;
    private hasActiveConnections;
    private startHeartbeat;
    private stopHeartbeat;
    private cleanupResources;
    gracefulShutdown(reason: string): Promise<void>;
    private formatContextDisplay;
    private formatHistoryDisplay;
    private recordConfigurationChange;
    private reinitializeComponents;
    private formatSecurityStatusDisplay;
}
export { MCPShellServer };
//# sourceMappingURL=index.d.ts.map