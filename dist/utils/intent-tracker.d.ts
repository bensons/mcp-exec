/**
 * Command intent tracker for AI optimization
 */
export interface CommandIntent {
    category: string;
    purpose: string;
    confidence: number;
    relatedCommands: string[];
    suggestedFollowups: string[];
}
export declare class IntentTracker {
    private intentPatterns;
    private commandHistory;
    constructor();
    /**
     * Pure classification - no side effects, safe to call for suggestions/previews.
     */
    classify(command: string, aiContext?: string): CommandIntent;
    /**
     * Classify and record the command in history. Call once per executed command.
     */
    analyzeIntent(command: string, aiContext?: string): CommandIntent;
    getRecentIntents(limit?: number): Array<{
        command: string;
        intent: CommandIntent;
        timestamp: Date;
    }>;
    suggestNextCommands(currentCommand: string): string[];
    private initializeIntentPatterns;
    private enhanceIntentWithContext;
    private analyzeHeuristically;
    private recordIntent;
    getIntentSummary(): {
        categories: Record<string, number>;
        totalCommands: number;
    };
}
//# sourceMappingURL=intent-tracker.d.ts.map