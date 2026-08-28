/**
 * Shared command-policy helpers used by execute_command and session tools.
 * Keeps full-command construction and deny logging consistent across entry points.
 */
import { SecurityManager } from './manager';
import { AuditLogger } from '../audit/logger';
export type CommandGuard = (command: string) => Promise<void>;
export declare function buildFullCommand(command?: string, args?: string[]): string;
export declare function assertCommandAllowed(securityManager: SecurityManager, command: string, auditLogger?: AuditLogger, context?: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=command-policy.d.ts.map