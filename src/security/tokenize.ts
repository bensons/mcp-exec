/**
 * Minimal, quote-aware shell tokenizer for the security layer.
 *
 * It is deliberately not a full shell parser: it exists so policy checks can ask
 * "what command is actually being run here, with which flags and operands?"
 * instead of doing substring matching on the raw command line.
 */

import * as path from 'path';
import * as os from 'os';

export interface SubCommand {
  /** Raw tokens of the sub-command, with quotes removed. */
  tokens: string[];
  /** Tokens after leading `VAR=value` assignments and wrappers (sudo, env, ...) are stripped. */
  argv: string[];
  /** Lowercased basename of `argv[0]`; empty string for an empty sub-command. */
  argv0: string;
  /** Short flag clusters expanded to letters plus long flag names: `-rf` -> r,f; `--force` -> force. */
  flags: Set<string>;
  /** Non-flag arguments after `argv[0]`. */
  operands: string[];
}

/**
 * Wrapper commands that are transparent for policy purposes, mapped to the short
 * options that consume the following token (so `sudo -u root rm` still yields `rm`).
 */
const WRAPPERS: Record<string, string> = {
  sudo: 'ugpCTUrt',
  doas: 'u',
  env: 'uS',
  command: '',
  builtin: '',
  exec: '',
  nohup: '',
  time: '',
  nice: 'n',
  ionice: 'cn',
  timeout: 'sk',
  stdbuf: 'ioe',
  xargs: 'InPsad',
};

/** Long wrapper options that consume the following token when not written as `--opt=value`. */
const WRAPPER_LONG_ARG_OPTIONS = new Set([
  '--user', '--group', '--prompt', '--other-user', '--close-from', '--type', '--role',
  '--chdir', '--signal', '--kill-after', '--adjustment', '--replace', '--max-args',
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Splits a command line into sub-commands on `;`, `&&`, `||`, `|`, `&`, newlines and `$( )` / backticks. */
export function tokenizeCommand(command: string): SubCommand[] {
  const subs: string[][] = [];
  let tokens: string[] = [];
  let current = '';
  let started = false;

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
      subs.push(tokens);
      tokens = [];
    }
  };

  let quote: '' | "'" | '"' = '';
  for (let i = 0; i < command.length; i++) {
    const c = command[i];

    if (quote === "'") {
      if (c === "'") {
        quote = '';
      } else {
        current += c;
        started = true;
      }
      continue;
    }

    if (c === '\\' && i + 1 < command.length) {
      current += command[i + 1];
      started = true;
      i++;
      continue;
    }

    // Command substitution starts a nested sub-command, inside double quotes too.
    if (c === '$' && command[i + 1] === '(') {
      endSub();
      quote = '';
      i++;
      continue;
    }
    if (c === '`') {
      endSub();
      quote = '';
      continue;
    }

    if (quote === '"') {
      if (c === '"') {
        quote = '';
        started = true;
      } else {
        current += c;
        started = true;
      }
      continue;
    }

    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (c === ')' || c === ';' || c === '\n' || c === '&' || c === '|') {
      endSub();
      // Collapse `&&` and `||` into a single separator.
      if (command[i + 1] === c && (c === '&' || c === '|')) {
        i++;
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endToken();
      continue;
    }

    current += c;
    started = true;
  }
  endSub();

  return subs.map(toSubCommand);
}

function toSubCommand(tokens: string[]): SubCommand {
  const argv = stripWrappers(tokens);
  const flags = new Set<string>();
  const operands: string[] = [];
  let flagsDone = false;

  for (const token of argv.slice(1)) {
    if (!flagsDone && token === '--') {
      flagsDone = true;
      continue;
    }
    if (!flagsDone && token.startsWith('--') && token.length > 2) {
      flags.add(token.slice(2).split('=')[0]);
      continue;
    }
    if (!flagsDone && token.startsWith('-') && token.length > 1) {
      for (const letter of token.slice(1)) {
        flags.add(letter);
      }
      continue;
    }
    operands.push(token);
  }

  return {
    tokens,
    argv,
    argv0: argv.length > 0 ? path.basename(argv[0]).toLowerCase() : '',
    flags,
    operands,
  };
}

/** Drops leading environment assignments and transparent wrappers such as `sudo`/`env`. */
function stripWrappers(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (ASSIGNMENT.test(token)) {
      i++;
      continue;
    }
    const argTakingShorts = WRAPPERS[path.basename(token).toLowerCase()];
    if (argTakingShorts === undefined) {
      break;
    }
    i++;
    while (i < tokens.length && tokens[i].startsWith('-') && tokens[i].length > 1) {
      const option = tokens[i];
      i++;
      const takesArgument = option.startsWith('--')
        ? WRAPPER_LONG_ARG_OPTIONS.has(option) && !option.includes('=')
        : argTakingShorts.includes(option[option.length - 1]);
      if (takesArgument && i < tokens.length) {
        i++;
      }
    }
  }
  return tokens.slice(i);
}

/**
 * True when `sub` runs the same command as `pattern` with at least the pattern's
 * flags and operands. Flag order and clustering are irrelevant (`-rf` == `-fr` ==
 * `-r -f`); path operands are compared by resolved path, so `rm -rf /` matches
 * `rm -rf //` and `rm -rf /*` but not `rm -rf /tmp/x`.
 */
export function matchesPattern(sub: SubCommand, pattern: SubCommand): boolean {
  if (!pattern.argv0 || !commandNameMatches(sub.argv0, pattern.argv0)) {
    return false;
  }
  for (const flag of pattern.flags) {
    if (!sub.flags.has(flag)) {
      return false;
    }
  }
  for (const operand of pattern.operands) {
    if (!sub.operands.some(candidate => operandMatches(candidate, operand))) {
      return false;
    }
  }
  return true;
}

/** `mkfs` matches `mkfs` and `mkfs.ext4`; `fdisk` matches `fdisk.exe`. */
function commandNameMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.startsWith(`${expected}.`);
}

function operandMatches(actual: string, expected: string): boolean {
  if (actual === expected) {
    return true;
  }
  if (!looksLikePath(actual) || !looksLikePath(expected)) {
    return false;
  }
  return normalizePathOperand(actual) === normalizePathOperand(expected);
}

function looksLikePath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('~') || value.startsWith('.') || value.startsWith('\\');
}

/** Expands `~`, drops a trailing glob (`/*`), and resolves, so `/`, `//` and `/*` collapse together. */
export function normalizePathOperand(value: string): string {
  let normalized = value.replace(/\/+\*?$/, '/');
  if (normalized === '*') {
    normalized = '.';
  }
  if (normalized === '~' || normalized.startsWith('~/')) {
    normalized = path.join(os.homedir(), normalized.slice(1));
  }
  return path.resolve(normalized);
}
