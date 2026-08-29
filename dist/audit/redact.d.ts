/**
 * Single reusable redaction helper.
 *
 * Anything that leaves the process — audit log lines, exports, context output,
 * MCP notifications — should pass through `redactSecrets` first so that values
 * stored under secret-looking keys never reach disk or the wire.
 */
export declare const REDACTED = "[REDACTED]";
/** Keys matching this are considered secret-bearing. */
export declare const DEFAULT_REDACT_PATTERN: RegExp;
/**
 * Build a redaction pattern list from user-supplied sources (config /
 * `MCP_EXEC_AUDIT_REDACT_PATTERNS`). Invalid patterns are dropped rather than
 * crashing startup, and the `g` flag is never set so `.test()` stays stateless.
 */
export declare function compileRedactPatterns(sources?: string[]): RegExp[];
/**
 * Deep-copy `value`, replacing every value stored under a matching key with
 * `[REDACTED]`. Dates and other non-plain objects are passed through unchanged;
 * only object/array structure is walked.
 */
export declare function redactSecrets<T>(value: T, patterns?: RegExp[]): T;
//# sourceMappingURL=redact.d.ts.map