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
    private assertCommandAllowed;
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
    /**
     * Restore a configuration section to its original values without replacing
     * the canonical section object itself. Components are refreshed through
     * reinitializeComponents after the mutation so they keep the new values
     * without replacing the long-lived manager instances.
     */
    private resetSectionInPlace;
    private reinitializeComponents;
    private restartTerminalViewerService;
    private formatSecurityStatusDisplay;
}
export { MCPShellServer };
//# sourceMappingURL=index.d.ts.map