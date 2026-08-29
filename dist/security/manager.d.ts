/**
 * Security manager for command validation and sandboxing
 */
import { ValidationResult } from '../types/index';
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
export declare class SecurityManager {
    private config;
    private dangerousPatterns;
    private systemDirectories;
    private allowedDirectories;
    private configurationBase;
    private auditLogger?;
    constructor(config: SecurityConfig, auditLogger?: AuditLogger, configurationBase?: string);
    private initializeDangerousPatterns;
    private initializeSystemDirectories;
    private denyUnresolved;
    private validateResolvedPath;
    private resolveFileReference;
    private validateDirectoryAccess;
    private checkPrivilegeEscalation;
    private assessRiskLevel;
    validateResourceLimits(command: string): ValidationResult;
    validateSandboxing(command: string): ValidationResult;
    validateCommand(command: string, options?: {
        cwd?: string;
        env?: Record<string, string | undefined>;
    }): Promise<ValidationResult>;
}
//# sourceMappingURL=manager.d.ts.map