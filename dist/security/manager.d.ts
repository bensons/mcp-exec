/**
 * Security manager for command validation and sandboxing
 */
import { ValidationResult } from '../types/index';
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
export declare class SecurityManager {
    private config;
    private dangerousPatterns;
    private systemDirectories;
    private auditLogger?;
    constructor(config: SecurityConfig, auditLogger?: AuditLogger);
    private initializeDangerousPatterns;
    private initializeSystemDirectories;
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
    validateCommand(command: string): Promise<ValidationResult>;
}
//# sourceMappingURL=manager.d.ts.map