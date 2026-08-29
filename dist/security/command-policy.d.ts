/**
 * Shared command-policy helpers used by execute_command and session tools.
 * Keeps full-command construction and deny logging consistent across entry points.
 */
import { SecurityManager } from './manager';
import { AuditLogger } from '../audit/logger';
import { ValidationResult } from '../types/index';
export interface CommandPolicyOptions {
    /** Bypass only the "needs confirmation" branch; hard blocks still apply. */
    skipConfirmation?: boolean;
}
export type CommandGuard = (command: string, options?: CommandPolicyOptions) => Promise<void>;
/** Thrown when a command is allowed but gated behind confirm_command. */
export declare class ConfirmationRequiredError extends Error {
    readonly command: string;
    readonly validation: ValidationResult;
    constructor(command: string, validation: ValidationResult);
}
export declare function buildFullCommand(command?: string, args?: string[]): string;
export declare function assertCommandAllowed(securityManager: SecurityManager, command: string, auditLogger?: AuditLogger, context?: Record<string, unknown>, options?: CommandPolicyOptions): Promise<void>;
//# sourceMappingURL=command-policy.d.ts.map