"use strict";
/**
 * Single reusable redaction helper.
 *
 * Anything that leaves the process — audit log lines, exports, context output,
 * MCP notifications — should pass through `redactSecrets` first so that values
 * stored under secret-looking keys never reach disk or the wire.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_REDACT_PATTERN = exports.REDACTED = void 0;
exports.compileRedactPatterns = compileRedactPatterns;
exports.redactSecrets = redactSecrets;
exports.REDACTED = '[REDACTED]';
/** Keys matching this are considered secret-bearing. */
exports.DEFAULT_REDACT_PATTERN = /(secret|token|password|passwd|api[_-]?key|auth|credential|private)/i;
/**
 * Build a redaction pattern list from user-supplied sources (config /
 * `MCP_EXEC_AUDIT_REDACT_PATTERNS`). Invalid patterns are dropped rather than
 * crashing startup, and the `g` flag is never set so `.test()` stays stateless.
 */
function compileRedactPatterns(sources) {
    const patterns = (sources || []).reduce((acc, source) => {
        try {
            acc.push(new RegExp(source, 'i'));
        }
        catch {
            console.error(`Ignoring invalid audit redact pattern: ${source}`);
        }
        return acc;
    }, []);
    // Custom rules extend the built-in protection; they must never replace it.
    return [exports.DEFAULT_REDACT_PATTERN, ...patterns];
}
/**
 * Deep-copy `value`, replacing every value stored under a matching key with
 * `[REDACTED]`. Dates and other non-plain objects are passed through unchanged;
 * only object/array structure is walked.
 */
function redactSecrets(value, patterns = [exports.DEFAULT_REDACT_PATTERN]) {
    return redact(value, patterns, new WeakSet());
}
function redact(value, patterns, seen) {
    if (Array.isArray(value)) {
        if (seen.has(value)) {
            return '[Circular]';
        }
        seen.add(value);
        return value.map(item => redact(item, patterns, seen));
    }
    if (value === null || typeof value !== 'object' || value instanceof Date) {
        return value;
    }
    // Non-plain objects (Map, Set, Error, class instances) are left alone: they
    // serialize to `{}` anyway and walking them would invent structure.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        return value;
    }
    if (seen.has(value)) {
        return '[Circular]';
    }
    seen.add(value);
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = patterns.some(pattern => pattern.test(key))
            ? exports.REDACTED
            : redact(item, patterns, seen);
    }
    return result;
}
//# sourceMappingURL=redact.js.map