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
    /** Environment the command actually ran with (recorded in history). */
    environment: Record<string, string>;
    /**
     * Per-command `env` overrides supplied by the caller. Recorded for the audit trail
     * but never merged into the persistent session environment.
     */
    envOverrides?: Record<string, string>;
    /** Exported environment observed in the shell after the command completed. */
    resultingEnvironment?: Record<string, string>;
    /** Working directory observed in the shell after the command completed. */
    resultingWorkingDirectory?: string;
    output: CommandOutput;
    aiContext?: string;
    sessionId?: string;
    sessionType?: 'start' | 'input' | 'kill';
}
export declare class ContextManager {
    private config;
    private sessionId;
    private currentDirectory;
    private previousDirectory?;
    private directoryStack;
    private environmentVariables;
    private commandHistory;
    private outputCache;
    private fileSystemChanges;
    private auditLogger?;
    constructor(config: ContextConfig, auditLogger?: AuditLogger);
    getCurrentContext(sessionId?: string): Promise<CommandContext>;
    updateAfterCommand(options: UpdateCommandOptions): Promise<void>;
    getHistory(limit?: number, filter?: string): Promise<CommandHistoryEntry[]>;
    getOutput(commandId: string): Promise<CommandOutput | undefined>;
    getFileSystemChanges(since?: Date): Promise<FileSystemDiff[]>;
    setWorkingDirectory(directory: string): Promise<boolean>;
    getSessionId(): string;
    clearHistory(): Promise<void>;
    /** Apply the final directory observed inside the shell. */
    private updateWorkingDirectory;
    private isDirectory;
    private canonicalDirectory;
    /**
     * Replace persistent environment state with the shell's exported environment.
     * Per-command overrides and shell-maintained bookkeeping remain scoped.
     */
    private updateEnvironmentVariables;
    private trackFileSystemChanges;
    private findRelatedCommands;
    private persistSession;
    loadSession(): Promise<void>;
}
//# sourceMappingURL=manager.d.ts.map