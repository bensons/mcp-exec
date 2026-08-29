/**
 * Security manager for command validation and sandboxing
 */
import { ValidationResult, SecurityCategory } from '../types/index';
import { AuditLogger } from '../audit/logger';
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
    private auditLogger?;
    constructor(config: SecurityConfig, auditLogger?: AuditLogger);
    private initializeSystemDirectories;
    private validateDirectoryAccess;
    private checkPrivilegeEscalation;
    private assessRiskLevel;
    validateResourceLimits(command: string): ValidationResult;
    validateSandboxing(command: string): ValidationResult;
    validateCommand(command: string): Promise<ValidationResult>;
}
//# sourceMappingURL=manager.d.ts.map