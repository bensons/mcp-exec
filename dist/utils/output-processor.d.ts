/**
 * Output processor for AI-friendly command output formatting
 */
import { CommandOutput } from '../types/index';
export interface OutputConfig {
    formatStructured: boolean;
    stripAnsi: boolean;
    summarizeVerbose: boolean;
    enableAiOptimizations: boolean;
    maxOutputLength: number;
}
/** Raw result of a spawned command, before AI-friendly processing. */
export interface RawCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    /** Set when the process was terminated by a signal (e.g. 'SIGTERM'). */
    signal?: string;
    /** Set when the process was killed because it exceeded its timeout. */
    timedOut?: boolean;
    timeoutMs?: number;
}
export declare class OutputProcessor {
    private config;
    constructor(config: OutputConfig);
    process(rawOutput: RawCommandResult, command?: string): Promise<CommandOutput>;
    private stripAnsiCodes;
    private optimizeForAI;
    private enhanceCommandSpecificOutput;
    private enhanceDirectoryListing;
    private enhanceProcessListing;
    private enhanceGitOutput;
    private enhancePackageManagerOutput;
    private truncateOutput;
    private detectStructuredOutput;
    private inferJsonSchema;
    private parseCsv;
    private isTableFormat;
    private parseTable;
    private generateMetadata;
    private detectAffectedResources;
    private classifyCommandType;
    private generateCommandSpecificSuggestions;
    private generateSummary;
}
//# sourceMappingURL=output-processor.d.ts.map