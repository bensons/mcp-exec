"use strict";
/**
 * Shared command-policy helpers used by execute_command and session tools.
 * Keeps full-command construction and deny logging consistent across entry points.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmationRequiredError = void 0;
exports.buildFullCommand = buildFullCommand;
exports.assertCommandAllowed = assertCommandAllowed;
/** Thrown when a command is allowed but gated behind confirm_command. */
class ConfirmationRequiredError extends Error {
    command;
    validation;
    constructor(command, validation) {
        super(validation.reason || 'Command requires confirmation');
        this.command = command;
        this.validation = validation;
        this.name = 'ConfirmationRequiredError';
    }
}
exports.ConfirmationRequiredError = ConfirmationRequiredError;
function buildFullCommand(command, args) {
    if (!command) {
        return '';
    }
    if (args && args.length > 0) {
        return `${command} ${args.join(' ')}`;
    }
    return command;
}
async function assertCommandAllowed(securityManager, command, auditLogger, context = {}, options = {}) {
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
//# sourceMappingURL=command-policy.js.map