/**
 * Output processor for AI-friendly command output formatting
 */
import { CommandOutput } from '../types/index';
export interface OutputConfig {
    formatStructured: boolean;
    stripAnsi: boolean;
    summarizeVerbose: boolean;
}
export declare class OutputProcessor {
    private config;
    constructor(config: OutputConfig);
    process(rawOutput: {
        stdout: string;
        stderr: string;
        exitCode: number;
    }): Promise<CommandOutput>;
    private stripAnsiCodes;
    private detectStructuredOutput;
    private inferJsonSchema;
    private parseCsv;
    private isTableFormat;
    private parseTable;
    private generateMetadata;
    private generateSummary;
}
//# sourceMappingURL=output-processor.d.ts.map