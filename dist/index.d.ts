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
    /**
     * Effective working directory a command will run in: explicit cwd, else the
     * session context directory, else the server's cwd. Relative and `~` paths in
     * the command are validated against this, not against process.cwd().
     */
    private getEffectiveCwd;
    private assertCommandAllowed;
    /**
     * Runs the command policy for an entry point. Returns undefined when the
     * caller may proceed, or the text to return when the command is parked
     * pending confirm_command. Hard blocks still throw.
     */
    private gateCommand;
    /**
     * Create a TerminalSessionManager wired so that any session removal (kill, terminate,
     * or the inactivity/finished sweep) also drops the session from the terminal viewer service.
     */
    private createTerminalSessionManager;
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
    private restartTerminalViewerService;
    private formatSecurityStatusDisplay;
}
export { MCPShellServer };
//# sourceMappingURL=index.d.ts.map