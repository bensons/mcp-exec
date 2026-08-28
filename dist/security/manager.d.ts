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
    validateCommand(command: string): Promise<ValidationResult>;
}
//# sourceMappingURL=manager.d.ts.map