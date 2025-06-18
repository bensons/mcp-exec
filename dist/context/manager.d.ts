/**
 * Context manager for preserving state across command executions
 */
import { CommandHistoryEntry, CommandOutput, FileSystemDiff, CommandContext } from '../types/index';
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
}
export declare class ContextManager {
    private config;
    private sessionId;
    private currentDirectory;
    private environmentVariables;
    private commandHistory;
    private outputCache;
    private fileSystemChanges;
    constructor(config: ContextConfig);
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