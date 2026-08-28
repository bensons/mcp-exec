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
export class ConfirmationRequiredError extends Error {
  constructor(public readonly command: string, public readonly validation: ValidationResult) {
    super(validation.reason || 'Command requires confirmation');
    this.name = 'ConfirmationRequiredError';
  }
}

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
  options: CommandPolicyOptions = {}
): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) {
    return;
  }

  const securityCheck = await securityManager.validateCommand(trimmed);
  if (securityCheck.allowed) {
    return;
  }

  if (securityCheck.requiresConfirmation) {
    if (options.skipConfirmation) {
      return;
    }
    throw new ConfirmationRequiredError(trimmed, securityCheck);
  }

  await auditLogger?.warning('Command blocked by security policy', {
    fullCommand: trimmed,
    reason: securityCheck.reason,
    riskLevel: securityCheck.riskLevel,
    ...context,
  }, 'security-validator');

  throw new Error(`Command blocked by security policy: ${securityCheck.reason}`);
}
