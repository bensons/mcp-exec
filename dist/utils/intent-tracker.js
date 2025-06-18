"use strict";
/**
 * Command intent tracker for AI optimization
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentTracker = void 0;
class IntentTracker {
    intentPatterns = new Map();
    commandHistory = [];
    constructor() {
        this.initializeIntentPatterns();
    }
    analyzeIntent(command, aiContext) {
        const normalizedCommand = command.toLowerCase().trim();
        // Check for explicit patterns first
        for (const [pattern, intent] of this.intentPatterns) {
            if (pattern.test(normalizedCommand)) {
                const enhancedIntent = this.enhanceIntentWithContext(intent, aiContext);
                this.recordIntent(command, enhancedIntent);
                return enhancedIntent;
            }
        }
        // Fallback to heuristic analysis
        const heuristicIntent = this.analyzeHeuristically(normalizedCommand, aiContext);
        this.recordIntent(command, heuristicIntent);
        return heuristicIntent;
    }
    getRecentIntents(limit = 10) {
        return this.commandHistory.slice(-limit);
    }
    suggestNextCommands(currentCommand) {
        const intent = this.analyzeIntent(currentCommand);
        const suggestions = [...intent.suggestedFollowups];
        // Add context-aware suggestions based on recent history
        const recentIntents = this.getRecentIntents(5);
        for (const entry of recentIntents) {
            if (entry.intent.category === intent.category) {
                suggestions.push(...entry.intent.relatedCommands);
            }
        }
        return [...new Set(suggestions)].slice(0, 5);
    }
    initializeIntentPatterns() {
        // File operations
        this.intentPatterns.set(/^ls|dir/, {
            category: 'exploration',
            purpose: 'List directory contents',
            confidence: 0.9,
            relatedCommands: ['cd', 'pwd', 'find'],
            suggestedFollowups: ['cd <directory>', 'cat <file>', 'less <file>'],
        });
        this.intentPatterns.set(/^cd\s+/, {
            category: 'navigation',
            purpose: 'Change directory',
            confidence: 0.95,
            relatedCommands: ['ls', 'pwd', 'find'],
            suggestedFollowups: ['ls', 'pwd', 'ls -la'],
        });
        this.intentPatterns.set(/^cat|less|more|head|tail/, {
            category: 'inspection',
            purpose: 'View file contents',
            confidence: 0.9,
            relatedCommands: ['grep', 'wc', 'sort'],
            suggestedFollowups: ['grep <pattern> <file>', 'wc -l <file>'],
        });
        // Development operations
        this.intentPatterns.set(/^git\s+(status|log|diff)/, {
            category: 'development',
            purpose: 'Check git repository status',
            confidence: 0.95,
            relatedCommands: ['git add', 'git commit', 'git push'],
            suggestedFollowups: ['git add .', 'git commit -m "message"', 'git push'],
        });
        this.intentPatterns.set(/^git\s+clone/, {
            category: 'development',
            purpose: 'Clone repository',
            confidence: 0.95,
            relatedCommands: ['cd', 'ls', 'npm install'],
            suggestedFollowups: ['cd <repo-name>', 'ls', 'npm install'],
        });
        this.intentPatterns.set(/^npm\s+(install|i)/, {
            category: 'development',
            purpose: 'Install dependencies',
            confidence: 0.9,
            relatedCommands: ['npm start', 'npm test', 'npm run'],
            suggestedFollowups: ['npm start', 'npm test', 'npm run dev'],
        });
        // System operations
        this.intentPatterns.set(/^ps|top|htop/, {
            category: 'monitoring',
            purpose: 'Monitor system processes',
            confidence: 0.9,
            relatedCommands: ['kill', 'killall', 'pgrep'],
            suggestedFollowups: ['kill <pid>', 'pgrep <process>'],
        });
        this.intentPatterns.set(/^find\s+/, {
            category: 'search',
            purpose: 'Search for files',
            confidence: 0.9,
            relatedCommands: ['grep', 'locate', 'which'],
            suggestedFollowups: ['grep <pattern> <file>', 'ls -la <found-file>'],
        });
        // Network operations
        this.intentPatterns.set(/^curl|wget/, {
            category: 'network',
            purpose: 'Download or test network resources',
            confidence: 0.9,
            relatedCommands: ['ping', 'nslookup', 'netstat'],
            suggestedFollowups: ['ping <host>', 'curl -I <url>'],
        });
    }
    enhanceIntentWithContext(baseIntent, aiContext) {
        if (!aiContext)
            return baseIntent;
        const enhanced = { ...baseIntent };
        const contextLower = aiContext.toLowerCase();
        // Adjust confidence based on context clarity
        if (contextLower.includes('debug') || contextLower.includes('troubleshoot')) {
            enhanced.confidence = Math.min(enhanced.confidence + 0.1, 1.0);
            enhanced.purpose += ' (debugging)';
        }
        if (contextLower.includes('setup') || contextLower.includes('install')) {
            enhanced.purpose += ' (setup/installation)';
        }
        if (contextLower.includes('test') || contextLower.includes('verify')) {
            enhanced.purpose += ' (testing/verification)';
        }
        return enhanced;
    }
    analyzeHeuristically(command, aiContext) {
        // Basic heuristic analysis for unknown commands
        const words = command.split(/\s+/);
        const firstWord = words[0];
        // Check if it's a known command type
        if (firstWord.endsWith('.sh') || firstWord.endsWith('.py') || firstWord.endsWith('.js')) {
            return {
                category: 'execution',
                purpose: 'Execute script',
                confidence: 0.7,
                relatedCommands: ['chmod +x', 'ls -la'],
                suggestedFollowups: ['echo $?', 'ls -la'],
            };
        }
        if (words.some(word => word.includes('='))) {
            return {
                category: 'configuration',
                purpose: 'Set environment variable',
                confidence: 0.8,
                relatedCommands: ['export', 'env', 'printenv'],
                suggestedFollowups: ['env | grep <var>', 'echo $<var>'],
            };
        }
        // Default fallback
        return {
            category: 'general',
            purpose: aiContext || 'Execute command',
            confidence: 0.5,
            relatedCommands: [],
            suggestedFollowups: ['echo $?', 'pwd'],
        };
    }
    recordIntent(command, intent) {
        this.commandHistory.push({
            command,
            intent,
            timestamp: new Date(),
        });
        // Keep only recent history
        if (this.commandHistory.length > 100) {
            this.commandHistory = this.commandHistory.slice(-50);
        }
    }
    getIntentSummary() {
        const categories = {};
        for (const entry of this.commandHistory) {
            const category = entry.intent.category;
            categories[category] = (categories[category] || 0) + 1;
        }
        return {
            categories,
            totalCommands: this.commandHistory.length,
        };
    }
}
exports.IntentTracker = IntentTracker;
//# sourceMappingURL=intent-tracker.js.map