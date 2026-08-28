"use strict";
/**
 * Shared command-policy helpers used by execute_command and session tools.
 * Keeps full-command construction and deny logging consistent across entry points.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFullCommand = buildFullCommand;
exports.assertCommandAllowed = assertCommandAllowed;
function buildFullCommand(command, args) {
    if (!command) {
        return '';
    }
    if (args && args.length > 0) {
        return `${command} ${args.join(' ')}`;
    }
    return command;
}
async function assertCommandAllowed(securityManager, command, auditLogger, context = {}) {
    const trimmed = command.trim();
    if (!trimmed) {
        return;
    }
    const securityCheck = await securityManager.validateCommand(trimmed);
    if (securityCheck.allowed) {
        return;
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