/**
 * Conservative shell tokenization for command-policy checks.
 *
 * This is not intended to execute commands or replace a shell parser. It extracts
 * every executable that can be identified safely and reports incomplete parsing
 * so the security layer can fail closed instead of silently skipping a command.
 */

import * as path from 'path';
import * as os from 'os';

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

interface WrapperSpec {
  shortArgOptions: string;
  shortNoArgOptions: string;
  longArgOptions: Set<string>;
  longNoArgOptions: Set<string>;
  positionalArguments?: number;
  allowNumericOption?: boolean;
}

interface WrapperResult {
  argv: string[];
  wrappers: string[];
  complete: boolean;
  error?: string;
}

const set = (...values: string[]): Set<string> => new Set(values);

/** Options are explicit so an unfamiliar wrapper option fails closed. */
const WRAPPERS: Record<string, WrapperSpec> = {
  sudo: {
    shortArgOptions: 'ugpCTrRht',
    shortNoArgOptions: 'AbEHKnPSV',
    longArgOptions: set(
      'user', 'group', 'host', 'prompt', 'close-from', 'chdir', 'role', 'type',
      'other-user', 'command-timeout', 'preserve-env', 'remove-timestamp'
    ),
    longNoArgOptions: set(
      'background', 'bell', 'edit', 'help', 'login', 'non-interactive',
      'preserve-groups', 'reset-timestamp', 'stdin', 'validate', 'version'
    ),
  },
  doas: {
    shortArgOptions: 'aCu',
    shortNoArgOptions: 'Lns',
    longArgOptions: set(),
    longNoArgOptions: set(),
  },
  env: {
    shortArgOptions: 'uCS',
    shortNoArgOptions: 'i0v',
    longArgOptions: set('unset', 'chdir', 'split-string', 'block-signal', 'default-signal', 'ignore-signal'),
    longNoArgOptions: set('ignore-environment', 'null', 'debug', 'help', 'version'),
  },
  command: {
    shortArgOptions: '',
    shortNoArgOptions: 'p',
    longArgOptions: set(),
    longNoArgOptions: set(),
  },
  builtin: {
    shortArgOptions: '',
    shortNoArgOptions: '',
    longArgOptions: set(),
    longNoArgOptions: set(),
  },
  exec: {
    shortArgOptions: 'a',
    shortNoArgOptions: 'cl',
    longArgOptions: set(),
    longNoArgOptions: set(),
  },
  nohup: {
    shortArgOptions: '',
    shortNoArgOptions: '',
    longArgOptions: set(),
    longNoArgOptions: set('help', 'version'),
  },
  time: {
    shortArgOptions: 'fo',
    shortNoArgOptions: 'apqvV',
    longArgOptions: set('format', 'output'),
    longNoArgOptions: set('append', 'help', 'portability', 'quiet', 'verbose', 'version'),
  },
  nice: {
    shortArgOptions: 'n',
    shortNoArgOptions: '',
    longArgOptions: set('adjustment'),
    longNoArgOptions: set('help', 'version'),
    allowNumericOption: true,
  },
  ionice: {
    shortArgOptions: 'cnpPu',
    shortNoArgOptions: 'thV',
    longArgOptions: set('class', 'classdata', 'pid', 'pgid', 'uid'),
    longNoArgOptions: set('ignore', 'help', 'version'),
  },
  timeout: {
    shortArgOptions: 'sk',
    shortNoArgOptions: 'fv',
    longArgOptions: set('signal', 'kill-after'),
    longNoArgOptions: set('preserve-status', 'foreground', 'verbose', 'help', 'version'),
    positionalArguments: 1,
  },
  stdbuf: {
    shortArgOptions: 'ioe',
    shortNoArgOptions: '',
    longArgOptions: set('input', 'output', 'error'),
    longNoArgOptions: set('help', 'version'),
  },
  xargs: {
    shortArgOptions: 'aEdIinLopPsx',
    shortNoArgOptions: '0rt',
    longArgOptions: set(
      'arg-file', 'eof', 'replace', 'max-lines', 'max-args', 'max-chars',
      'max-procs', 'process-slot-var', 'delimiter'
    ),
    longNoArgOptions: set(
      'null', 'open-tty', 'interactive', 'verbose', 'no-run-if-empty',
      'exit', 'show-limits', 'help', 'version'
    ),
  },
};

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const POSIX_SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'ash']);
const POWERSHELLS = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const CONTROL_PREFIXES = new Set(['!', 'if', 'then', 'elif', 'else', 'while', 'until', 'do', '{']);
const CONTROL_ONLY = new Set(['fi', 'done', 'esac', '}', ';;', ';&', ';;&']);
const DECLARATION_PREFIXES = new Set(['for', 'select', 'case', 'function']);

function defaultPlatform(): ShellPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix';
}

/**
 * Parse a command using the host shell's quoting rules by default.
 * `complete` is false when an executable cannot be determined safely.
 */
export function parseCommand(
  command: string,
  platform: ShellPlatform = defaultPlatform(),
  depth = 0
): CommandParseResult {
  if (depth > 12) {
    return { subCommands: [], complete: false, error: 'Command nesting exceeds the policy parser limit' };
  }

  const lexed = lexCommand(command, platform, depth);
  const subCommands = [...lexed.nested];
  let complete = lexed.complete;
  let error = lexed.error;

  for (const tokens of lexed.segments) {
    const normalized = stripControlSyntax(tokens);
    if (normalized.length === 0 || normalized.every(token => ASSIGNMENT.test(token))) {
      continue;
    }

    const converted = toSubCommand(normalized, platform);
    subCommands.push(converted.subCommand);
    if (!converted.complete) {
      complete = false;
      error ||= converted.error;
      continue;
    }

    const nested = parseInterpreterPayload(converted.subCommand, depth);
    if (nested) {
      subCommands.push(...nested.subCommands);
      if (!nested.complete) {
        complete = false;
        error ||= nested.error;
      }
    }
  }

  return { subCommands, complete, error };
}

/** Backward-compatible convenience API for callers that only need identified commands. */
export function tokenizeCommand(
  command: string,
  platform: ShellPlatform = defaultPlatform()
): SubCommand[] {
  return parseCommand(command, platform).subCommands;
}

interface LexResult {
  segments: string[][];
  nested: SubCommand[];
  complete: boolean;
  error?: string;
}

function lexCommand(command: string, platform: ShellPlatform, depth: number): LexResult {
  const segments: string[][] = [];
  const nested: SubCommand[] = [];
  let tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: '' | "'" | '"' = '';
  let complete = true;
  let error: string | undefined;

  const endToken = (): void => {
    if (started) {
      tokens.push(current);
      current = '';
      started = false;
    }
  };
  const endSub = (): void => {
    endToken();
    if (tokens.length > 0) {
      segments.push(tokens);
      tokens = [];
    }
  };
  const addNested = (payload: string): void => {
    const result = parseCommand(payload, 'posix', depth + 1);
    nested.push(...result.subCommands);
    if (!result.complete) {
      complete = false;
      error ||= result.error;
    }
  };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];

    if (platform === 'posix' && quote === "'") {
      if (c === "'") {
        quote = '';
      } else {
        current += c;
        started = true;
      }
      continue;
    }

    if (platform === 'win32' && !quote && c === '^') {
      if (i + 1 >= command.length) {
        complete = false;
        error ||= 'Dangling cmd.exe escape';
      } else {
        current += command[++i];
        started = true;
      }
      continue;
    }

    if (platform === 'posix' && c === '\\' && quote !== "'") {
      if (i + 1 >= command.length) {
        complete = false;
        error ||= 'Dangling shell escape';
      } else {
        current += command[++i];
        started = true;
      }
      continue;
    }

    if (platform === 'posix' && c === '$' && command[i + 1] === '(') {
      const substitution = findCommandSubstitution(command, i + 2);
      if (!substitution) {
        complete = false;
        error ||= 'Unterminated command substitution';
        current += command.slice(i);
        started = true;
        break;
      }
      addNested(substitution.payload);
      current += '$()';
      started = true;
      i = substitution.end;
      continue;
    }

    if (platform === 'posix' && c === '`' && quote !== "'") {
      const end = findBacktickEnd(command, i + 1);
      if (end < 0) {
        complete = false;
        error ||= 'Unterminated backtick substitution';
        current += command.slice(i);
        started = true;
        break;
      }
      addNested(command.slice(i + 1, end));
      current += '$()';
      started = true;
      i = end;
      continue;
    }

    if (quote) {
      if (c === quote) {
        quote = '';
        started = true;
      } else {
        current += c;
        started = true;
      }
      continue;
    }

    if (c === '"' || (platform === 'posix' && c === "'")) {
      quote = c as "'" | '"';
      started = true;
      continue;
    }

    if (c === ')' || c === '(' || c === ';' || c === '\n' || c === '&' || c === '|') {
      endSub();
      if (command[i + 1] === c && (c === '&' || c === '|')) {
        i++;
      }
      continue;
    }

    if ((c === '{' || c === '}') && !started) {
      endSub();
      continue;
    }

    if (c === ' ' || c === '\t' || c === '\r') {
      endToken();
      continue;
    }

    current += c;
    started = true;
  }

  if (quote) {
    complete = false;
    error ||= 'Unterminated shell quote';
  }
  endSub();
  return { segments, nested, complete, error };
}

function findCommandSubstitution(
  command: string,
  start: number
): { payload: string; end: number } | undefined {
  let nesting = 1;
  let quote: '' | "'" | '"' = '';
  for (let i = start; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = '';
      continue;
    }
    if (c === '\\') {
      i++;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = '';
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '$' && command[i + 1] === '(') {
      nesting++;
      i++;
      continue;
    }
    if (c === ')') {
      nesting--;
      if (nesting === 0) {
        return { payload: command.slice(start, i), end: i };
      }
    }
  }
  return undefined;
}

function findBacktickEnd(command: string, start: number): number {
  for (let i = start; i < command.length; i++) {
    if (command[i] === '\\') {
      i++;
    } else if (command[i] === '`') {
      return i;
    }
  }
  return -1;
}

function stripControlSyntax(tokens: string[]): string[] {
  const result = [...tokens];
  if (result.length === 0) return result;
  if (CONTROL_ONLY.has(result[0])) return [];
  if (DECLARATION_PREFIXES.has(result[0])) return [];
  while (result.length > 0 && CONTROL_PREFIXES.has(result[0])) {
    result.shift();
  }
  return result;
}

function toSubCommand(
  tokens: string[],
  platform: ShellPlatform
): { subCommand: SubCommand; complete: boolean; error?: string } {
  const stripped = stripWrappers(tokens, platform);
  const argv = stripped.argv;
  const flags = new Set<string>();
  const operands: string[] = [];
  let flagsDone = false;

  for (const token of argv.slice(1)) {
    if (!flagsDone && token === '--') {
      flagsDone = true;
      continue;
    }
    if (!flagsDone && token.startsWith('--') && token.length > 2) {
      const option = token.slice(2);
      const equals = option.indexOf('=');
      const name = normalizeFlag(equals >= 0 ? option.slice(0, equals) : option, platform);
      flags.add(name);
      if (equals >= 0) {
        flags.add(`${name}=${normalizeValue(option.slice(equals + 1), platform)}`);
      }
      continue;
    }
    if (!flagsDone && platform === 'win32' && /^\/[A-Za-z?]+(?::.*)?$/.test(token)) {
      const option = token.slice(1);
      const colon = option.indexOf(':');
      const name = option.slice(0, colon >= 0 ? colon : undefined).toLowerCase();
      flags.add(name);
      if (colon >= 0) flags.add(`${name}:${option.slice(colon + 1).toLowerCase()}`);
      continue;
    }
    if (!flagsDone && token.startsWith('-') && token.length > 1) {
      for (const letter of token.slice(1)) {
        flags.add(normalizeFlag(letter, platform));
      }
      continue;
    }
    operands.push(token);
  }

  const argv0 = argv.length > 0 ? executableBasename(argv[0], platform) : '';
  let complete = stripped.complete;
  let error = stripped.error;
  if (argv0 && isDynamicExecutable(argv[0], platform)) {
    complete = false;
    error ||= `Executable is determined dynamically: ${argv[0]}`;
  }

  return {
    subCommand: {
      tokens,
      argv,
      argv0,
      flags,
      operands,
      wrappers: stripped.wrappers,
      platform,
    },
    complete,
    error,
  };
}

function stripWrappers(tokens: string[], platform: ShellPlatform): WrapperResult {
  let i = 0;
  const wrappers: string[] = [];

  while (i < tokens.length && ASSIGNMENT.test(tokens[i])) i++;

  while (i < tokens.length) {
    const name = executableBasename(tokens[i], platform);
    const spec = platform === 'posix' ? WRAPPERS[name] : undefined;
    if (!spec) break;

    // `command -v` and `command -V` query names rather than executing them.
    if (name === 'command' && tokens.slice(i + 1).some(token => token === '-v' || token === '-V')) {
      break;
    }

    wrappers.push(name);
    i++;
    let optionsDone = false;
    while (i < tokens.length && !optionsDone) {
      const option = tokens[i];
      if (option === '--') {
        i++;
        optionsDone = true;
        break;
      }
      if (!option.startsWith('-') || option === '-') break;
      if (spec.allowNumericOption && /^-\d+$/.test(option)) {
        i++;
        continue;
      }
      const consumed = consumeWrapperOption(tokens, i, spec, name);
      if (!consumed.complete) {
        return { argv: [], wrappers, complete: false, error: consumed.error };
      }
      i = consumed.next;
    }

    if (name === 'env') {
      while (i < tokens.length && ASSIGNMENT.test(tokens[i])) i++;
    }

    const positionalArguments = spec.positionalArguments || 0;
    if (i + positionalArguments > tokens.length) {
      return { argv: [], wrappers, complete: false, error: `${name} is missing a required positional argument` };
    }
    i += positionalArguments;

    while (i < tokens.length && ASSIGNMENT.test(tokens[i])) i++;
    if (i >= tokens.length) {
      return { argv: [], wrappers, complete: false, error: `${name} does not identify a command to execute` };
    }
  }

  return { argv: tokens.slice(i), wrappers, complete: true };
}

function consumeWrapperOption(
  tokens: string[],
  index: number,
  spec: WrapperSpec,
  wrapper: string
): { complete: boolean; next: number; error?: string } {
  const option = tokens[index];
  if (option.startsWith('--')) {
    const equals = option.indexOf('=');
    const name = option.slice(2, equals >= 0 ? equals : undefined);
    if (spec.longNoArgOptions.has(name)) {
      if (equals >= 0) {
        return { complete: false, next: index, error: `${wrapper} option --${name} does not accept a value` };
      }
      return { complete: true, next: index + 1 };
    }
    if (spec.longArgOptions.has(name)) {
      if (equals >= 0) return { complete: true, next: index + 1 };
      if (index + 1 >= tokens.length) {
        return { complete: false, next: index, error: `${wrapper} option --${name} is missing its value` };
      }
      return { complete: true, next: index + 2 };
    }
    return { complete: false, next: index, error: `Unknown ${wrapper} option --${name}` };
  }

  const cluster = option.slice(1);
  for (let offset = 0; offset < cluster.length; offset++) {
    const flag = cluster[offset];
    if (spec.shortNoArgOptions.includes(flag)) continue;
    if (spec.shortArgOptions.includes(flag)) {
      if (offset + 1 < cluster.length) {
        return { complete: true, next: index + 1 };
      }
      if (index + 1 >= tokens.length) {
        return { complete: false, next: index, error: `${wrapper} option -${flag} is missing its value` };
      }
      return { complete: true, next: index + 2 };
    }
    return { complete: false, next: index, error: `Unknown ${wrapper} option -${flag}` };
  }
  return { complete: true, next: index + 1 };
}

function parseInterpreterPayload(sub: SubCommand, depth: number): CommandParseResult | undefined {
  const name = sub.argv0;
  if (POSIX_SHELLS.has(name)) {
    let commandMode = false;
    for (let i = 1; i < sub.argv.length; i++) {
      const token = sub.argv[i];
      if (token === '--') break;
      if (token === '--command') {
        commandMode = true;
        if (i + 1 >= sub.argv.length) {
          return { subCommands: [], complete: false, error: `${name} -c is missing its command string` };
        }
        return parseCommand(sub.argv[i + 1], 'posix', depth + 1);
      }
      if (token.startsWith('-') && token.slice(1).includes('c')) {
        commandMode = true;
        if (i + 1 >= sub.argv.length) {
          return { subCommands: [], complete: false, error: `${name} -c is missing its command string` };
        }
        return parseCommand(sub.argv[i + 1], 'posix', depth + 1);
      }
      if (!token.startsWith('-')) break;
    }
    if (commandMode) {
      return { subCommands: [], complete: false, error: `${name} command payload could not be identified` };
    }
    return undefined;
  }

  if (name === 'cmd' || name === 'cmd.exe') {
    for (let i = 1; i < sub.argv.length; i++) {
      const lower = sub.argv[i].toLowerCase();
      if (lower === '/c' || lower === '/k') {
        const payload = sub.argv.slice(i + 1).join(' ');
        return payload
          ? parseCommand(payload, 'win32', depth + 1)
          : { subCommands: [], complete: false, error: `${name} ${lower} is missing its command string` };
      }
      if ((lower.startsWith('/c') || lower.startsWith('/k')) && lower.length > 2) {
        return parseCommand([sub.argv[i].slice(2), ...sub.argv.slice(i + 1)].join(' '), 'win32', depth + 1);
      }
    }
    return undefined;
  }

  if (POWERSHELLS.has(name)) {
    for (let i = 1; i < sub.argv.length; i++) {
      const lower = sub.argv[i].toLowerCase();
      if (lower === '-encodedcommand' || lower === '-enc' || lower === '-e') {
        return { subCommands: [], complete: false, error: 'Encoded PowerShell command cannot be inspected safely' };
      }
      if (lower === '-command' || lower === '-c') {
        const payload = sub.argv.slice(i + 1).join(' ');
        return payload
          ? parseCommand(payload, 'win32', depth + 1)
          : { subCommands: [], complete: false, error: `${name} ${lower} is missing its command string` };
      }
    }
    return undefined;
  }

  if (name === 'eval' && sub.argv.length > 1) {
    return parseCommand(sub.argv.slice(1).join(' '), sub.platform, depth + 1);
  }
  return undefined;
}

/**
 * True when `sub` runs the same command as `pattern` with at least the pattern's
 * flags and operands. Flag order is irrelevant; positional operand order is not.
 */
export function matchesPattern(sub: SubCommand, pattern: SubCommand): boolean {
  if (!pattern.argv0) {
    return pattern.wrappers.length === 1 && sub.wrappers.includes(pattern.wrappers[0]);
  }
  if (!commandNameMatches(sub.argv0, pattern.argv0)) return false;
  for (const flag of pattern.flags) {
    if (!sub.flags.has(flag)) return false;
  }

  let candidateIndex = 0;
  for (const operand of pattern.operands) {
    let found = false;
    while (candidateIndex < sub.operands.length) {
      if (operandMatches(sub.operands[candidateIndex++], operand, sub.platform)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/** `mkfs` matches `mkfs` and `mkfs.ext4`; `fdisk` matches `fdisk.exe`. */
function commandNameMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.startsWith(`${expected}.`);
}

function operandMatches(actual: string, expected: string, platform: ShellPlatform): boolean {
  const normalizedActual = normalizeValue(actual, platform);
  const normalizedExpected = normalizeValue(expected, platform);
  if (normalizedActual === normalizedExpected) return true;
  if (!looksLikePath(actual, platform) || !looksLikePath(expected, platform)) return false;
  return normalizePathOperand(actual, platform) === normalizePathOperand(expected, platform);
}

function looksLikePath(value: string, platform: ShellPlatform): boolean {
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/') || value.startsWith('.');
  }
  return value.startsWith('/') || value.startsWith('~') || value.startsWith('.');
}

/** Expands `~`, drops a trailing root glob, and resolves equivalent path spellings. */
export function normalizePathOperand(
  value: string,
  platform: ShellPlatform = defaultPlatform()
): string {
  if (platform === 'win32') {
    let normalized = value.replace(/[\\/]+\*?$/, '\\');
    normalized = path.win32.resolve(normalized);
    return normalized.toLowerCase();
  }

  let normalized = value.replace(/\/+\*?$/, '/');
  if (normalized === '*') normalized = '.';
  if (normalized === '~' || normalized.startsWith('~/')) {
    normalized = path.join(os.homedir(), normalized.slice(1));
  }
  return path.resolve(normalized);
}

function normalizeFlag(value: string, platform: ShellPlatform): string {
  return platform === 'win32' ? value.toLowerCase() : value;
}

function normalizeValue(value: string, platform: ShellPlatform): string {
  return platform === 'win32' ? value.toLowerCase() : value;
}

function executableBasename(value: string, platform: ShellPlatform): string {
  const basename = platform === 'win32' ? path.win32.basename(value) : path.basename(value);
  return basename.toLowerCase();
}

function isDynamicExecutable(value: string, platform: ShellPlatform): boolean {
  return platform === 'win32'
    ? /[%!]/.test(value)
    : /[$`*?]/.test(value);
}

/**
 * Parse the documented comma-separated blocked-command environment value.
 * Commas in regex quantifiers/character classes are preserved; other literal
 * commas can be escaped as `\,`.
 */
export function parseBlockedCommandsEnvironment(value: string): string[] {
  const entries: string[] = [];
  let current = '';
  let inCharacterClass = false;
  let quantifierDepth = 0;

  const push = (): void => {
    entries.push(current.trim());
    current = '';
    inCharacterClass = false;
    quantifierDepth = 0;
  };

  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    const regexMode = current.trimStart().toLowerCase().startsWith('re:');
    if (c === '\\' && value[i + 1] === ',') {
      current += ',';
      i++;
      continue;
    }
    if (regexMode && c === '\\' && i + 1 < value.length) {
      current += c + value[++i];
      continue;
    }
    if (regexMode && c === '[') inCharacterClass = true;
    if (regexMode && c === ']' && inCharacterClass) inCharacterClass = false;
    if (regexMode && c === '{' && !inCharacterClass) quantifierDepth++;
    if (regexMode && c === '}' && quantifierDepth > 0 && !inCharacterClass) quantifierDepth--;
    if (c === ',' && !inCharacterClass && quantifierDepth === 0) {
      push();
      continue;
    }
    current += c;
  }
  push();
  return entries;
}
