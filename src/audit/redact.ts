/**
 * Single reusable redaction helper.
 *
 * Anything that leaves the process — audit log lines, exports, context output,
 * MCP notifications — should pass through `redactSecrets` first so that values
 * stored under secret-looking keys never reach disk or the wire.
 */

export const REDACTED = '[REDACTED]';

/** Keys matching this are considered secret-bearing. */
export const DEFAULT_REDACT_PATTERN =
  /(secret|token|password|passwd|api[_-]?key|auth|credential|private)/i;

/**
 * Build a redaction pattern list from user-supplied sources (config /
 * `MCP_EXEC_AUDIT_REDACT_PATTERNS`). Invalid patterns are dropped rather than
 * crashing startup, and the `g` flag is never set so `.test()` stays stateless.
 */
export function compileRedactPatterns(sources?: string[]): RegExp[] {
  const patterns = (sources || []).reduce<RegExp[]>((acc, source) => {
    try {
      acc.push(new RegExp(source, 'i'));
    } catch {
      console.error(`Ignoring invalid audit redact pattern: ${source}`);
    }
    return acc;
  }, []);

  // Custom rules extend the built-in protection; they must never replace it.
  return [DEFAULT_REDACT_PATTERN, ...patterns];
}

/**
 * Deep-copy `value`, replacing every value stored under a matching key with
 * `[REDACTED]`. Dates and other non-plain objects are passed through unchanged;
 * only object/array structure is walked.
 */
export function redactSecrets<T>(
  value: T,
  patterns: RegExp[] = [DEFAULT_REDACT_PATTERN]
): T {
  return redact(value, patterns) as T;
}

function redact(value: unknown, patterns: RegExp[]): unknown {
  if (Array.isArray(value)) {
    return value.map(item => redact(item, patterns));
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

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = patterns.some(pattern => pattern.test(key))
      ? REDACTED
      : redact(item, patterns);
  }
  return result;
}
