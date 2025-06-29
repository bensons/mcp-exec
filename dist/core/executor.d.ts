/**
 * Core shell command executor with cross-platform support
 */
import { CommandOutput, ServerConfig, SessionOutput } from '../types/index';
import { SecurityManager } from '../security/manager';
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
export declare class ShellExecutor {
    private securityManager;
    private contextManager;
    private auditLogger;
    private outputProcessor;
    private intentTracker;
    private sessionManager;
    private config;
    constructor(securityManager: SecurityManager, contextManager: ContextManager, auditLogger: AuditLogger, config: ServerConfig);
    executeCommand(options: ExecuteCommandOptions): Promise<CommandOutput>;
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
    listSessions(): Promise<import("../types/index").SessionInfo[]>;
    killSession(sessionId: string): Promise<void>;
    startInteractiveSession(options: StartSessionOptions): Promise<string>;
    sendInputToSession(options: SendInputOptions): Promise<void>;
    readSessionOutput(sessionId: string): Promise<SessionOutput>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=executor.d.ts.map