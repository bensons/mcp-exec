/**
 * Security manager for command validation and sandboxing
 */
import { ValidationResult, SecurityCategory } from '../types/index';
import { AuditLogger } from '../audit/logger';
/**
 * True when `child` is `parent` itself or lives underneath it.
 * Uses path.relative so allowing `/home/user` does not also allow `/home/user-other`.
 */
export declare function isInside(parent: string, child: string): boolean;
/** Expand a leading `~` and resolve against `baseDir` (not the server's own cwd). */
export declare function resolvePath(target: string, baseDir: string, expandTilde?: boolean): string;
export interface SecurityConfig {
    level: 'strict' | 'moderate' | 'permissive';
    confirmDangerous: boolean;
    allowedDirectories: string[];
    blockedCommands: string[];
    timeout: number;
    resourceLimits?: {
        maxMemoryUsage?: number;
        maxFileSize?: number;
        maxProcesses?: number;
    };
    sandboxing?: {
        enabled: boolean;
        networkAccess: boolean;
        fileSystemAccess: 'read-only' | 'restricted' | 'full';
    };
}
export type CommandConnector = 'start' | '|' | '&&' | '||' | ';' | '&';
export interface CommandSegment {
    /** Tokens of the segment, quotes removed and redirections stripped out. */
    argv: string[];
    /** Lowercased basename of argv[0] after skipping wrappers. */
    name: string;
    /** Arguments passed to `name`. */
    args: string[];
    /** True when the segment runs through sudo/doas/runas. */
    privileged: boolean;
    /** Targets of `>` / `>>` redirections. */
    redirects: string[];
    /** Operator preceding this segment. */
    connector: CommandConnector;
    /** Set when shell syntax cannot be modeled safely. */
    unsafeSyntax?: string;
}
export declare function parseCommand(command: string): CommandSegment[];
export interface CommandClassification {
    riskLevel: 'low' | 'medium' | 'high';
    /** Genuinely dangerous: blocked in strict mode at high risk, confirmed when confirmDangerous is on. */
    dangerous: boolean;
    category?: SecurityCategory;
    /** Every applicable category, including secondary classifications. */
    categories?: SecurityCategory[];
    reason?: string;
}
/** Classify a command line by risk level and category, matching on command tokens. */
export declare function classifyCommand(command: string): CommandClassification;
export declare class SecurityManager {
    private config;
    private systemDirectories;
    private allowedDirectories;
    private configurationBase;
    private auditLogger?;
    constructor(config: SecurityConfig, auditLogger?: AuditLogger, configurationBase?: string);
    /**
     * Apply configuration changes in place. Callers must use this instead of
     * constructing a replacement manager, otherwise components that captured
     * this instance (e.g. ShellExecutor) keep validating against the old policy.
     */
    updateConfig(config: Partial<SecurityConfig>): void;
    private initializeSystemDirectories;
    private denyUnresolved;
    private validateResolvedPath;
    private resolveFileReference;
    private validateDirectoryAccess;
    private checkPrivilegeEscalation;
    private assessRiskLevel;
    validateResourceLimits(command: string): ValidationResult;
    validateSandboxing(command: string): ValidationResult;
    /**
     * Matches a `blockedCommands` entry against the parsed command.
     *
     * Entries are command patterns, not substrings: a single-word entry (`format`)
     * matches only when it is the command being run, and a multi-word entry
     * (`rm -rf /`) matches when the same command runs with at least those flags and
     * operands. An entry prefixed with `re:` is treated as a raw regex escape hatch.
     */
    private matchesBlockedCommand;
    validateCommand(command: string, options?: {
        cwd?: string;
        env?: Record<string, string | undefined>;
    }): Promise<ValidationResult>;
}
//# sourceMappingURL=manager.d.ts.map