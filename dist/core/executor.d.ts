/**
 * Core shell command executor with cross-platform support
 */
import { CommandOutput, ServerConfig, SessionOutput } from '../types/index';
import { SecurityManager } from '../security/manager';
import { CommandPolicyOptions } from '../security/command-policy';
import { ContextManager } from '../context/manager';
import { AuditLogger } from '../audit/logger';
import { StartSessionOptions, SendInputOptions } from './interactive-session-manager';
export interface ExecuteCommandOptions {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    shell?: boolean | string;
    aiContext?: string;
}
/** Default hard cap on bytes retained per stream when `output.maxCollectedBytes` is not configured. */
export declare function defaultMaxCollectedBytes(maxOutputLength: number): number;
export declare class ShellExecutor {
    private securityManager;
    private contextManager;
    private auditLogger;
    private outputProcessor;
    private intentTracker;
    private sessionManager;
    private config;
    constructor(securityManager: SecurityManager, contextManager: ContextManager, auditLogger: AuditLogger, config: ServerConfig);
    /**
     * Effective working directory a command will run in: explicit cwd, else the
     * session context directory, else the server's cwd. Relative and `~` paths in
     * the command are validated against this, not against process.cwd().
     */
    private getEffectiveCwd;
    executeCommand(options: ExecuteCommandOptions, policyOptions?: CommandPolicyOptions): Promise<CommandOutput>;
    getIntentSummary(): {
        categories: Record<string, number>;
        totalCommands: number;
    };
    suggestNextCommands(command: string): string[];
    getRecentIntents(limit?: number): {
        command: string;
        intent: import("../utils/intent-tracker").CommandIntent;
        timestamp: Date;
    }[];
    private buildFullCommand;
    private executeWithTimeout;
    private supportsShellStateCapture;
    private wrapPosixCommand;
    private extractPosixShellState;
    private wrapWindowsCommand;
    private extractWindowsShellState;
    listSessions(): Promise<import("../types/index").SessionInfo[]>;
    getSession(sessionId: string): import("../types/index").InteractiveSession | undefined;
    killSession(sessionId: string): Promise<void>;
    startInteractiveSession(options: StartSessionOptions): Promise<string>;
    sendInputToSession(options: SendInputOptions): Promise<void>;
    readSessionOutput(sessionId: string): Promise<SessionOutput>;
    /**
     * Apply a new config to the live components instead of recreating the
     * executor, which would orphan every running interactive session.
     */
    updateConfig(config: ServerConfig): void;
    /**
     * Rebind services that can be recreated by dynamic configuration without
     * replacing this executor (and orphaning its interactive sessions).
     */
    updateDependencies(securityManager: SecurityManager, contextManager: ContextManager, auditLogger: AuditLogger): void;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=executor.d.ts.map