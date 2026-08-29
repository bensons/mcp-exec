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
     * Always returns a detached intent (cloned arrays included): the pattern table
     * holds long-lived objects, so handing one out would let a caller's edit rewrite
     * every future classification and every already-recorded history entry.
     */
    classify(command: string, aiContext?: string): CommandIntent;
    private cloneIntent;
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