/**
 * Conservative shell tokenization for command-policy checks.
 *
 * This is not intended to execute commands or replace a shell parser. It extracts
 * every executable that can be identified safely and reports incomplete parsing
 * so the security layer can fail closed instead of silently skipping a command.
 */
export type ShellPlatform = 'posix' | 'win32';
export interface SubCommand {
    /** Raw tokens of the sub-command, with shell quotes removed. */
    tokens: string[];
    /** Tokens after leading assignments and transparent wrappers are stripped. */
    argv: string[];
    /** Lowercased basename of `argv[0]`; empty when a wrapper has no command. */
    argv0: string;
    /** Normalized flags. Attached long-option values are retained as `name=value`. */
    flags: Set<string>;
    /** Non-flag arguments after `argv[0]`, in their original order. */
    operands: string[];
    /** Transparent wrapper executable names encountered before `argv0`. */
    wrappers: string[];
    /** Shell rules used to parse and compare this command. */
    platform: ShellPlatform;
}
export interface CommandParseResult {
    subCommands: SubCommand[];
    complete: boolean;
    error?: string;
}
/**
 * Parse a command using the host shell's quoting rules by default.
 * `complete` is false when an executable cannot be determined safely.
 */
export declare function parseCommand(command: string, platform?: ShellPlatform, depth?: number): CommandParseResult;
/** Backward-compatible convenience API for callers that only need identified commands. */
export declare function tokenizeCommand(command: string, platform?: ShellPlatform): SubCommand[];
/**
 * True when `sub` runs the same command as `pattern` with at least the pattern's
 * flags and operands. Flag order is irrelevant; positional operand order is not.
 */
export declare function matchesPattern(sub: SubCommand, pattern: SubCommand): boolean;
/** Expands `~`, drops a trailing root glob, and resolves equivalent path spellings. */
export declare function normalizePathOperand(value: string, platform?: ShellPlatform): string;
/**
 * Parse the documented comma-separated blocked-command environment value.
 * Commas in regex quantifiers/character classes are preserved; other literal
 * commas can be escaped as `\,`.
 */
export declare function parseBlockedCommandsEnvironment(value: string): string[];
//# sourceMappingURL=tokenize.d.ts.map