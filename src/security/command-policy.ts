/**
 * Shared command-policy helpers used by execute_command and session tools.
 * Keeps full-command construction and deny logging consistent across entry points.
 */

import { SecurityManager } from './manager';
import { AuditLogger } from '../audit/logger';

export type CommandGuard = (
  command: string,
  cwd?: string,
  env?: Record<string, string | undefined>
) => Promise<string | undefined>;

export function buildFullCommand(command?: string, args?: string[]): string {
  if (!command) {
    return '';
  }
  if (args && args.length > 0) {
    return `${command} ${args.join(' ')}`;
  }
  return command;
}

export async function assertCommandAllowed(
  securityManager: SecurityManager,
  command: string,
  auditLogger?: AuditLogger,
  context: Record<string, unknown> = {},
  cwd?: string,
  env?: Record<string, string | undefined>
): Promise<string | undefined> {
  const trimmed = command.trim();
  if (!trimmed && cwd === undefined) {
    return;
  }

  const securityCheck = await securityManager.validateCommand(trimmed, { cwd, env });
  if (securityCheck.allowed) {
    return securityCheck.resultingCwd;
  }

  await auditLogger?.warning('Command blocked by security policy', {
    fullCommand: trimmed,
    cwd,
    reason: securityCheck.reason,
    riskLevel: securityCheck.riskLevel,
    ...context,
  }, 'security-validator');

  throw new Error(`Command blocked by security policy: ${securityCheck.reason}`);
}
