/**
 * Security manager for command validation and sandboxing
 */
import { ValidationResult } from '../types/index';
export interface SecurityConfig {
    level: 'strict' | 'moderate' | 'permissive';
    confirmDangerous: boolean;
    allowedDirectories: string[];
    blockedCommands: string[];
    timeout: number;
}
export declare class SecurityManager {
    private config;
    private dangerousPatterns;
    private systemDirectories;
    constructor(config: SecurityConfig);
    validateCommand(command: string): Promise<ValidationResult>;
    private initializeDangerousPatterns;
    private initializeSystemDirectories;
    private validateDirectoryAccess;
    private checkPrivilegeEscalation;
    private assessRiskLevel;
}
//# sourceMappingURL=manager.d.ts.map