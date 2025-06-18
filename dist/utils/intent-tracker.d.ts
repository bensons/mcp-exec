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