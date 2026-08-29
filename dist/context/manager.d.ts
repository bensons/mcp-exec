/**
 * Context manager for preserving state across command executions
 */
import { CommandHistoryEntry, CommandOutput, FileSystemDiff, CommandContext } from '../types/index';
import { AuditLogger } from '../audit/logger';
export interface ContextConfig {
    preserveWorkingDirectory: boolean;
    sessionPersistence: boolean;
    maxHistorySize: number;
}
export interface ContextManagerOptions {
    /** Stable workspace identity used to isolate persisted sessions. */
    workspaceDirectory?: string;
    /** Optional stable server/client identity for multiple servers in one workspace. */
    sessionScope?: string;
    /** Test/diagnostic hook invoked after an atomic session publication. */
    onSessionPersisted?: (sessionFile: string) => void | Promise<void>;
}
export interface UpdateCommandOptions {
    id: string;
    command: string;
    workingDirectory: string;
    environment: Record<string, string>;
    output: CommandOutput;
    aiContext?: string;
    sessionId?: string;
    sessionType?: 'start' | 'input' | 'kill';
}
export declare class ContextManager {
    private config;
    private sessionId;
    private currentDirectory;
    private environmentVariables;
    private commandHistory;
    private outputCache;
    private fileSystemChanges;
    private auditLogger?;
    private sessionFile;
    private legacySessionFiles;
    private workspaceDirectory;
    private onSessionPersisted?;
    private persistTimer?;
    private persistQueue;
    private persistenceDirty;
    private disposed;
    constructor(config: ContextConfig, auditLogger?: AuditLogger, options?: ContextManagerOptions);
    getCurrentContext(sessionId?: string): Promise<CommandContext>;
    updateAfterCommand(options: UpdateCommandOptions): Promise<void>;
    getHistory(limit?: number, filter?: string): Promise<CommandHistoryEntry[]>;
    getOutput(commandId: string): Promise<CommandOutput | undefined>;
    getFileSystemChanges(since?: Date): Promise<FileSystemDiff[]>;
    setWorkingDirectory(directory: string): Promise<boolean>;
    getSessionId(): string;
    clearHistory(): Promise<void>;
    private updateWorkingDirectory;
    private updateEnvironmentVariables;
    private extractEnvironmentChangesFromCommand;
    private extractEnvironmentChanges;
    private trackFileSystemChanges;
    private findRelatedCommands;
    /** Resolve an isolated, stable session path and the safely scoped legacy paths. */
    private static resolveSessionLocation;
    /**
     * Environment variables that differ from the inherited process environment.
     * Only these are persisted -- the full process env holds the caller's secrets.
     */
    private getEnvironmentOverrides;
    /** Queue a trailing, unref'd write so a burst of commands costs one file write. */
    private schedulePersist;
    /** Write any dirty session state now, after all earlier publications finish. */
    flushSession(): Promise<void>;
    /** Update persistence settings without orphaning timers or losing live context. */
    updateConfig(config: ContextConfig): Promise<void>;
    /** Stop this manager from publishing after it has been replaced. */
    dispose(): Promise<void>;
    private cancelPendingPersistence;
    /** Serialize every publication and build its snapshot only when it reaches the queue. */
    private enqueuePersist;
    private createSessionData;
    private persistSession;
    loadSession(): Promise<void>;
    private isLegacySessionForWorkspace;
}
//# sourceMappingURL=manager.d.ts.map