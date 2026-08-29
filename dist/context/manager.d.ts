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
    constructor(config: ContextConfig, auditLogger?: AuditLogger);
    /**
     * Apply configuration changes while preserving this manager's history and
     * working directory. Callers must use this instead of constructing a
     * replacement manager, otherwise ShellExecutor keeps writing to the old
     * instance.
     */
    updateConfig(config: Partial<ContextConfig>): void;
    private validateMaxHistorySize;
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
    private persistSession;
    loadSession(): Promise<void>;
}
//# sourceMappingURL=manager.d.ts.map