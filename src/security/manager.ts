/**
 * Security manager for command validation and sandboxing
 */

import * as path from 'path';
import * as os from 'os';
import { ValidationResult, LogLevel, SecurityCategory } from '../types/index';
import { AuditLogger } from '../audit/logger';

export interface SecurityConfig {
  level: 'strict' | 'moderate' | 'permissive';
  confirmDangerous: boolean;
  allowedDirectories: string[];
  blockedCommands: string[];
  timeout: number;
  resourceLimits?: {
    maxMemoryUsage?: number; // in MB
    maxFileSize?: number; // in MB
    maxProcesses?: number;
  };
  sandboxing?: {
    enabled: boolean;
    networkAccess: boolean;
    fileSystemAccess: 'read-only' | 'restricted' | 'full';
  };
}

/* -------------------------------------------------------------------------- *
 * Command tokenization and risk classification
 *
 * Risk patterns are matched against the *command token* (basename of argv[0],
 * after skipping wrappers such as sudo/env/nice/time) instead of the raw
 * command string, so `git log --format=%H` is not read as `format` and
 * `echo departed` is not read as `parted`.
 *
 * ponytail: minimal hand-rolled tokenizer - no command substitution, glob or
 * alias expansion. Issue #26 adds src/security/tokenize.ts; dedupe on merge.
 * -------------------------------------------------------------------------- */

export type CommandConnector = 'start' | '|' | '&&' | '||' | ';' | '&';

export interface CommandSegment {
  /** Tokens of the segment, quotes removed and redirections stripped out. */
  argv: string[];
  /** Lowercased basename of argv[0] after skipping wrappers. */
  name: string;
  /** Arguments passed to `name`. */
  args: string[];
  /** True when the segment runs through sudo/doas/runas. */
  privileged: boolean;
  /** Targets of `>` / `>>` redirections. */
  redirects: string[];
  /** Operator preceding this segment. */
  connector: CommandConnector;
  /** Set when shell syntax cannot be modeled safely. */
  unsafeSyntax?: string;
}

/** Wrappers that prefix the real command, mapped to their value-taking options. */
const COMMAND_WRAPPERS: Record<string, string[]> = {
  sudo: ['-u', '--user', '-g', '--group', '-p', '--prompt', '-C', '--close-from', '-U', '--other-user', '-r', '--role', '-t', '--type', '-h', '--host'],
  doas: ['-u', '-C'],
  env: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
  nice: ['-n'],
  ionice: ['-c', '-n', '-p'],
  nohup: [],
  time: ['-f', '-o'],
  timeout: ['-k', '-s'],
  command: [],
  exec: [],
  setsid: [],
  stdbuf: ['-i', '-o', '-e'],
};

const PRIVILEGE_WRAPPERS = new Set(['sudo', 'doas', 'runas']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WINDOWS_EXECUTABLE_SUFFIX = /\.(?:exe|com|cmd|bat)$/i;
const SHELL_CONTROL_WORDS = new Set([
  '!', '{', '}', 'if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'do', 'done',
  'for', 'select', 'in', 'case', 'esac', 'function',
]);
const SUBSTITUTION_TOKEN = '__mcp_exec_substitution__';
const MAX_PARSE_DEPTH = 8;

function normalizeCommandName(token: string): string {
  return path.basename(token).toLowerCase().replace(WINDOWS_EXECUTABLE_SUFFIX, '');
}

function buildSegment(
  argv: string[],
  redirects: string[],
  connector: CommandConnector
): CommandSegment {
  let privileged = false;
  let index = 0;

  // Skip environment assignments and command wrappers to find the real argv[0]
  while (index < argv.length) {
    if (ENV_ASSIGNMENT.test(argv[index])) {
      index++;
      continue;
    }

    const base = normalizeCommandName(argv[index]);

    if (SHELL_CONTROL_WORDS.has(base)) {
      index++;
      continue;
    }

    if (base === 'sudoedit') {
      privileged = true;
      break;
    }

    const valueOptions = COMMAND_WRAPPERS[base];
    if (!valueOptions) {
      break;
    }

    if (PRIVILEGE_WRAPPERS.has(base)) {
      privileged = true;
    }
    index++;

    while (index < argv.length) {
      const arg = argv[index];
      if (ENV_ASSIGNMENT.test(arg)) {
        index++;
      } else if (arg === '--') {
        index++;
        break;
      } else if (arg.startsWith('-')) {
        const option = arg.split('=', 1)[0];
        const takesSeparateValue = valueOptions.includes(option) && !arg.includes('=') &&
          !(/^-[A-Za-z].+/.test(arg) && !arg.startsWith('--'));
        index += takesSeparateValue ? 2 : 1;
      } else if (/^\d+(\.\d+)?[smhd]?$/.test(arg)) {
        index++; // e.g. `nice 10`, `timeout 5s`
      } else {
        break;
      }
    }
  }

  const nameToken = index < argv.length ? argv[index] : '';
  const name = normalizeCommandName(nameToken);
  const unsafeSyntax = nameToken.includes(SUBSTITUTION_TOKEN) || nameToken.startsWith('$')
    ? 'dynamic command name cannot be determined safely'
    : undefined;
  return { argv, name, args: argv.slice(index + 1), privileged, redirects, connector, unsafeSyntax };
}

interface NestedExpression {
  content: string;
  end: number;
}

function readParenthesized(command: string, start: number): NestedExpression | undefined {
  let depth = 1;
  let quote: "'" | '"' | undefined;

  for (let i = start + 2; i < command.length; i++) {
    const ch = command[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')' && --depth === 0) {
      return { content: command.slice(start + 2, i), end: i };
    }
  }

  return undefined;
}

function readBackticks(command: string, start: number): NestedExpression | undefined {
  for (let i = start + 1; i < command.length; i++) {
    if (command[i] === '\\') {
      i++;
      continue;
    }
    if (command[i] === '`') {
      return { content: command.slice(start + 1, i), end: i };
    }
  }
  return undefined;
}

function shellPayload(segment: CommandSegment): { payload?: string; unsafe?: string } {
  const args = segment.args;
  if (['sh', 'bash', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish'].includes(segment.name)) {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-c' || /^-[A-Za-z]*c[A-Za-z]*$/.test(args[i])) {
        return args[i + 1]
          ? { payload: args[i + 1] }
          : { unsafe: `${segment.name} command-string option has no inspectable payload` };
      }
    }
  }
  if (segment.name === 'cmd') {
    const index = args.findIndex(arg => /^\/[ck]$/i.test(arg));
    if (index >= 0) {
      return args[index + 1]
        ? { payload: args.slice(index + 1).join(' ') }
        : { unsafe: 'cmd command-string option has no inspectable payload' };
    }
  }
  if (segment.name === 'powershell' || segment.name === 'pwsh') {
    const encoded = args.findIndex(arg => /^-(?:enc|encodedcommand)$/i.test(arg));
    if (encoded >= 0) return { unsafe: 'encoded PowerShell payload cannot be inspected safely' };
    const index = args.findIndex(arg => /^-(?:c|command)$/i.test(arg));
    if (index >= 0) {
      return args[index + 1]
        ? { payload: args.slice(index + 1).join(' ') }
        : { unsafe: 'PowerShell command-string option has no inspectable payload' };
    }
  }
  return {};
}

/** Split a command line into segments with quote-aware argv and redirect targets. */
function parseCommandAtDepth(command: string, depth: number): CommandSegment[] {
  const segments: CommandSegment[] = [];
  const embeddedSegments: CommandSegment[] = [];
  let argv: string[] = [];
  let redirects: string[] = [];
  let connector: CommandConnector = 'start';
  let token = '';
  let hasToken = false;
  let redirectTarget = false;

  const markUnsafe = (reason: string): void => {
    embeddedSegments.push(buildSegment([], [], 'start'));
    embeddedSegments[embeddedSegments.length - 1].unsafeSyntax = reason;
  };

  const addNested = (expression: NestedExpression | undefined, reason: string): number | undefined => {
    token += SUBSTITUTION_TOKEN;
    hasToken = true;
    if (!expression) {
      markUnsafe(reason);
      return undefined;
    }
    if (depth >= MAX_PARSE_DEPTH) {
      markUnsafe('maximum shell parsing depth exceeded');
    } else {
      embeddedSegments.push(...parseCommandAtDepth(expression.content, depth + 1));
    }
    return expression.end;
  };

  const endToken = (): void => {
    if (!hasToken) return;
    if (redirectTarget) {
      redirects.push(token);
      redirectTarget = false;
    } else {
      argv.push(token);
    }
    token = '';
    hasToken = false;
  };

  const endSegment = (next: CommandConnector): void => {
    endToken();
    if (argv.length > 0 || redirects.length > 0) {
      segments.push(buildSegment(argv, redirects, connector));
    }
    argv = [];
    redirects = [];
    redirectTarget = false;
    connector = next;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (ch === '\\' && i + 1 < command.length) {
      token += command[++i];
      hasToken = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      hasToken = true;
      i++;
      while (i < command.length && command[i] !== quote) {
        if (quote === '"' && command[i] === '\\' && i + 1 < command.length) {
          token += command[++i];
          i++;
          continue;
        }
        if (quote === '"' && command[i] === '$' && command[i + 1] === '(') {
          const end = addNested(readParenthesized(command, i), 'unterminated command substitution');
          if (end === undefined) {
            i = command.length;
            break;
          }
          i = end + 1;
          continue;
        }
        if (quote === '"' && command[i] === '`') {
          const end = addNested(readBackticks(command, i), 'unterminated backtick substitution');
          if (end === undefined) {
            i = command.length;
            break;
          }
          i = end + 1;
          continue;
        }
        token += command[i++];
      }
      if (i >= command.length && command[command.length - 1] !== quote) {
        markUnsafe(`unterminated ${quote} quote`);
      }
      continue;
    }

    if (ch === '$' && command[i + 1] === '(') {
      const end = addNested(readParenthesized(command, i), 'unterminated command substitution');
      if (end === undefined) break;
      i = end;
      continue;
    }

    if (ch === '`') {
      const end = addNested(readBackticks(command, i), 'unterminated backtick substitution');
      if (end === undefined) break;
      i = end;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '<') {
      endToken();
      continue;
    }

    // Grouping and control operators divide commands into separately classified segments.
    if (ch === '\n' || ch === ';' || ch === '(' || ch === ')') {
      endSegment(';');
      continue;
    }

    if (ch === '|') {
      if (command[i + 1] === '|') {
        i++;
        endSegment('||');
      } else {
        endSegment('|');
      }
      continue;
    }

    if (ch === '&') {
      if (command[i + 1] === '&') {
        i++;
        endSegment('&&');
      } else if (command[i + 1] === '>') {
        i++;
        if (command[i + 1] === '>') i++;
        endToken();
        redirectTarget = true;
      } else {
        endSegment('&');
      }
      continue;
    }

    if (ch === '>') {
      if (hasToken && /^\d+$/.test(token)) {
        token = ''; // file descriptor prefix, e.g. `2>`
        hasToken = false;
      } else {
        endToken();
      }
      if (command[i + 1] === '>' || command[i + 1] === '|') i++;
      if (command[i + 1] === '&') {
        // `2>&1` duplicates a descriptor, it has no file target
        i++;
        while (i + 1 < command.length && /[\d-]/.test(command[i + 1])) i++;
        continue;
      }
      redirectTarget = true;
      continue;
    }

    token += ch;
    hasToken = true;
  }

  endSegment(';');
  const expanded = [...segments, ...embeddedSegments];
  for (const segment of segments) {
    const nested = shellPayload(segment);
    if (nested.unsafe) {
      const unsafe = buildSegment([], [], 'start');
      unsafe.unsafeSyntax = nested.unsafe;
      expanded.push(unsafe);
    } else if (nested.payload) {
      if (depth >= MAX_PARSE_DEPTH) {
        const unsafe = buildSegment([], [], 'start');
        unsafe.unsafeSyntax = 'maximum shell parsing depth exceeded';
        expanded.push(unsafe);
      } else {
        expanded.push(...parseCommandAtDepth(nested.payload, depth + 1));
      }
    }
  }
  return expanded;
}

export function parseCommand(command: string): CommandSegment[] {
  return parseCommandAtDepth(command, 0);
}

export interface CommandClassification {
  riskLevel: 'low' | 'medium' | 'high';
  /** Genuinely dangerous: blocked in strict mode at high risk, confirmed when confirmDangerous is on. */
  dangerous: boolean;
  category?: SecurityCategory;
  /** Every applicable category, including secondary classifications. */
  categories?: SecurityCategory[];
  reason?: string;
}

const RISK_ORDER: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 1, high: 2 };

const SHELLS = new Set([
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish',
  'cmd', 'powershell', 'pwsh', 'python', 'python3', 'perl', 'ruby', 'node',
]);
const FETCHERS = new Set(['curl', 'wget', 'fetch']);
const DISK_COMMANDS = new Set([
  'mkfs', 'fdisk', 'gdisk', 'sgdisk', 'parted', 'diskpart', 'mkswap', 'wipefs', 'shred',
  'format', 'format.com',
]);
const HALT_COMMANDS = new Set(['shutdown', 'reboot', 'halt', 'poweroff']);
const KILL_COMMANDS = new Set(['kill', 'killall', 'pkill']);
const DEVICE_PATH = /^\/dev\/(sd|hd|vd|nvme|disk|rdisk|mapper)/i;
const SYSTEM_PATH = /^\/(etc|sys|proc|boot)\//i;
const RECURSIVE_OR_FORCED = /^(-[a-zA-Z]*[rRf]|--recursive|--force|--no-preserve-root)/;

function optionPosition(args: string[], valueOptions: Set<string> = new Set()): number {
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--') return index + 1;
    if (!arg.startsWith('-') || arg === '-') return index;
    const option = arg.split('=', 1)[0];
    if (valueOptions.has(option) && !arg.includes('=')) index++;
    index++;
  }
  return index;
}

function serviceAction(segment: CommandSegment): string | undefined {
  if (segment.name === 'systemctl') {
    const valueOptions = new Set([
      '-H', '--host', '-M', '--machine', '-t', '--type', '--state', '-p', '--property',
      '-P', '--value', '--job-mode', '--kill-whom', '-s', '--signal', '--root', '--image',
      '--lines', '-o', '--output', '--namespace',
    ]);
    return segment.args[optionPosition(segment.args, valueOptions)]?.toLowerCase();
  }
  if (segment.name === 'service') {
    const serviceIndex = optionPosition(segment.args);
    return segment.args[serviceIndex + 1]?.toLowerCase();
  }
  return undefined;
}

function classifySegment(
  segment: CommandSegment,
  previous?: CommandSegment
): CommandClassification[] {
  const { name, args } = segment;
  const found: CommandClassification[] = [];

  if (segment.unsafeSyntax) {
    found.push({
      riskLevel: 'high',
      dangerous: true,
      category: 'remote-execution',
      reason: segment.unsafeSyntax,
    });
    return found;
  }

  // Downloaded content piped into an interpreter
  if (segment.connector === '|' && previous && FETCHERS.has(previous.name)) {
    found.push(SHELLS.has(name)
      ? { riskLevel: 'high', dangerous: true, category: 'remote-execution', reason: `${previous.name} output piped into ${name}` }
      : { riskLevel: 'medium', dangerous: false, category: 'remote-execution', reason: `${previous.name} output piped into ${name || 'another command'}` });
  }

  if (name === 'su' || (segment.privileged && SHELLS.has(name))) {
    found.push({ riskLevel: 'high', dangerous: true, category: 'privilege-escalation', reason: 'interactive shell with elevated privileges' });
  } else if (segment.privileged || name === 'runas') {
    found.push({ riskLevel: 'high', dangerous: false, category: 'privilege-escalation', reason: 'command run with elevated privileges' });
  }

  if (DISK_COMMANDS.has(name) || name.startsWith('mkfs.')) {
    found.push({ riskLevel: 'high', dangerous: true, category: 'destructive', reason: `disk/filesystem command: ${name}` });
  }

  if (HALT_COMMANDS.has(name) || (name === 'init' && args.some(arg => arg === '0' || arg === '6'))) {
    found.push({ riskLevel: 'high', dangerous: true, category: 'system-control', reason: `system control command: ${name}` });
  }

  const action = serviceAction(segment);
  if ((name === 'systemctl' && action !== undefined && ['stop', 'disable', 'mask', 'kill'].includes(action)) ||
      (name === 'service' && action === 'stop')) {
    found.push({ riskLevel: 'medium', dangerous: true, category: 'system-control', reason: `service disruption: ${name}` });
  }

  if (name === 'rm' || name === 'rmdir') {
    const forced = args.some(arg => RECURSIVE_OR_FORCED.test(arg) || /^\/[sq]$/i.test(arg));
    found.push(forced
      ? { riskLevel: 'high', dangerous: true, category: 'destructive', reason: 'recursive or forced file deletion' }
      : { riskLevel: 'medium', dangerous: false, category: 'destructive', reason: 'file deletion' });
  }

  if (name === 'del' || name === 'erase') {
    const forced = args.some(arg => /^[/-][fsq]/i.test(arg));
    found.push(forced
      ? { riskLevel: 'high', dangerous: true, category: 'destructive', reason: 'forced file deletion' }
      : { riskLevel: 'medium', dangerous: false, category: 'destructive', reason: 'file deletion' });
  }

  if (name === 'dd' && args.some(arg => /^(if|of)=/i.test(arg))) {
    found.push({ riskLevel: 'high', dangerous: true, category: 'destructive', reason: 'raw device/data copy (dd)' });
  }

  if (name === 'chmod' && args.some(arg => /^0?777$/.test(arg))) {
    found.push({ riskLevel: 'medium', dangerous: false, reason: 'world-writable permissions' });
  }

  if (name === 'chown') {
    found.push({ riskLevel: 'medium', dangerous: false, reason: 'ownership change' });
  }

  if (KILL_COMMANDS.has(name)) {
    found.push({ riskLevel: 'medium', dangerous: false, reason: `process termination: ${name}` });
  }

  if (name === 'mv' && args.includes('/dev/null')) {
    found.push({ riskLevel: 'medium', dangerous: false, category: 'destructive', reason: 'move to /dev/null' });
  }

  for (const target of segment.redirects) {
    if (DEVICE_PATH.test(target) || SYSTEM_PATH.test(target)) {
      found.push({ riskLevel: 'high', dangerous: true, category: 'destructive', reason: `redirect overwrites ${target}` });
    }
  }

  return found;
}

function combineClassifications(candidates: CommandClassification[]): CommandClassification {
  if (candidates.length === 0) {
    return { riskLevel: 'low', dangerous: false };
  }

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  for (const candidate of candidates) {
    if (RISK_ORDER[candidate.riskLevel] > RISK_ORDER[riskLevel]) {
      riskLevel = candidate.riskLevel;
    }
  }

  const dangerous = candidates.filter(candidate => candidate.dangerous);
  const pool = dangerous.length > 0 ? dangerous : candidates;
  const primary = pool.reduce((worst, candidate) =>
    RISK_ORDER[candidate.riskLevel] > RISK_ORDER[worst.riskLevel] ? candidate : worst);

  return {
    riskLevel,
    dangerous: dangerous.length > 0,
    category: primary.category,
    categories: Array.from(new Set(candidates.flatMap(candidate =>
      candidate.categories ?? (candidate.category ? [candidate.category] : [])
    ))),
    reason: primary.reason,
  };
}

/** Classify a command line by risk level and category, matching on command tokens. */
export function classifyCommand(command: string): CommandClassification {
  const segments = parseCommand(command);
  const candidates: CommandClassification[] = [];
  segments.forEach((segment, index) => {
    candidates.push(...classifySegment(segment, segments[index - 1]));
  });
  return combineClassifications(candidates);
}

/** Commands whose mere use requires the network. */
const NETWORK_COMMANDS = new Set(['wget', 'curl', 'ssh', 'scp', 'sftp', 'telnet', 'ftp', 'nc', 'ncat', 'netcat']);
/** Commands that only reach the network for particular sub-commands. */
const NETWORK_SUBCOMMANDS: Record<string, string[]> = {
  git: ['clone', 'pull', 'push', 'fetch'],
  npm: ['install', 'update'],
  pip: ['install', 'upgrade'],
  pip3: ['install', 'upgrade'],
};
const NETWORK_VALUE_OPTIONS: Record<string, Set<string>> = {
  git: new Set(['-C', '-c', '--config-env', '--exec-path', '--git-dir', '--work-tree', '--namespace', '--super-prefix']),
  npm: new Set(['--prefix', '--workspace', '-w', '--registry', '--cache', '--userconfig']),
  pip: new Set(['--proxy', '--timeout', '--retries', '--cert', '--client-cert', '--cache-dir', '--config-settings']),
  pip3: new Set(['--proxy', '--timeout', '--retries', '--cert', '--client-cert', '--cache-dir', '--config-settings']),
};
const WRITE_COMMANDS = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'touch', 'mkdir', 'dd', 'tee', 'truncate', 'ln', 'install',
  'shred', 'chmod', 'chown', 'unlink', 'rename', 'del', 'erase', 'md', 'rd', 'sudoedit',
]);
/** Redirect targets that do not actually write to the file system. */
const NON_FILE_REDIRECTS = new Set(['/dev/null', '/dev/zero', '/dev/stdout', '/dev/stderr', '/dev/tty']);

function networkSubcommand(segment: CommandSegment): string | undefined {
  const position = optionPosition(segment.args, NETWORK_VALUE_OPTIONS[segment.name]);
  return segment.args[position]?.toLowerCase();
}

function isScpRemoteOperand(arg: string): boolean {
  if (/^scp:\/\//i.test(arg)) return true;
  if (/^[A-Za-z]:[\\/]/.test(arg)) return false;
  return /^(?:[^@/:\s]+@)?[^/:\s]+:/.test(arg);
}

function scpWritesLocal(args: string[]): boolean {
  const valueOptions = new Set(['-c', '-D', '-F', '-i', '-J', '-l', '-o', '-P', '-S', '-X']);
  const operands: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') {
      operands.push(...args.slice(index + 1));
      break;
    }
    const option = arg.split('=', 1)[0];
    if (arg.startsWith('-')) {
      if (valueOptions.has(option) && !arg.includes('=')) index++;
      continue;
    }
    operands.push(arg);
  }
  if (operands.length < 2) return false;
  const destination = operands[operands.length - 1];
  return !isScpRemoteOperand(destination) && operands.slice(0, -1).some(isScpRemoteOperand);
}

export class SecurityManager {
  private config: SecurityConfig;
  private systemDirectories: string[] = [];
  private auditLogger?: AuditLogger;

  constructor(config: SecurityConfig, auditLogger?: AuditLogger) {
    this.config = config;
    this.auditLogger = auditLogger;
    this.initializeSystemDirectories();

    // Log security manager initialization
    this.auditLogger?.notice('Security manager initialized', {
      securityLevel: config.level,
      confirmDangerous: config.confirmDangerous,
      allowedDirectories: config.allowedDirectories,
      blockedCommandsCount: config.blockedCommands.length,
      sandboxingEnabled: config.sandboxing?.enabled || false
    }, 'security-manager');
  }



  private initializeSystemDirectories(): void {
    if (process.platform === 'win32') {
      this.systemDirectories = [
        'C:\\Windows',
        'C:\\Program Files',
        'C:\\Program Files (x86)',
        'C:\\System Volume Information',
      ];
    } else {
      this.systemDirectories = [
        '/bin',
        '/sbin',
        '/usr/bin',
        '/usr/sbin',
        '/etc',
        '/sys',
        '/proc',
        '/dev',
        '/boot',
        '/root',
      ];
    }
  }

  private validateDirectoryAccess(command: string): ValidationResult {
    // Extract potential paths from command
    const pathMatches = command.match(/(?:^|\s)([\/\\]?[\w\-\.\/\\]+)/g);
    
    if (!pathMatches) {
      return { allowed: true, riskLevel: 'low' };
    }

    for (const match of pathMatches) {
      const cleanPath = match.trim();
      
      // Check if accessing system directories
      for (const sysDir of this.systemDirectories) {
        if (cleanPath.startsWith(sysDir)) {
          if (this.config.level === 'strict') {
            return {
              allowed: false,
              reason: `Access to system directory blocked: ${sysDir}`,
              riskLevel: 'high',
              suggestions: ['Use a path within allowed directories'],
            };
          }
        }
      }

      // Check allowed directories
      if (this.config.allowedDirectories.length > 0) {
        const isAllowed = this.config.allowedDirectories.some(allowedDir => {
          const resolvedAllowed = path.resolve(allowedDir);
          const resolvedPath = path.resolve(cleanPath);
          return resolvedPath.startsWith(resolvedAllowed);
        });

        if (!isAllowed && path.isAbsolute(cleanPath)) {
          return {
            allowed: false,
            reason: `Path not in allowed directories: ${cleanPath}`,
            riskLevel: 'medium',
            suggestions: [`Use a path within: ${this.config.allowedDirectories.join(', ')}`],
          };
        }
      }
    }

    return { allowed: true, riskLevel: 'low' };
  }

  private checkPrivilegeEscalation(command: string): ValidationResult {
    const escalates = parseCommand(command).some(
      segment => segment.privileged || segment.name === 'su' || segment.name === 'runas' || segment.name === 'sudoedit'
    );

    if (!escalates) {
      return { allowed: true, riskLevel: 'low' };
    }

    if (this.config.level === 'strict') {
      return {
        allowed: false,
        reason: 'Privilege escalation commands blocked in strict mode',
        riskLevel: 'high',
        category: 'privilege-escalation',
        categories: ['privilege-escalation'],
        suggestions: ['Run without elevated privileges or switch security level'],
      };
    }

    return {
      allowed: true,
      reason: 'Privilege escalation detected',
      riskLevel: 'high',
      category: 'privilege-escalation',
      categories: ['privilege-escalation'],
      suggestions: ['Ensure you understand the implications of elevated privileges'],
    };
  }

  private assessRiskLevel(command: string): 'low' | 'medium' | 'high' {
    return classifyCommand(command).riskLevel;
  }

  validateResourceLimits(command: string): ValidationResult {
    if (!this.config.resourceLimits) {
      return { allowed: true, riskLevel: 'low' };
    }

    const limits = this.config.resourceLimits;

    // Check for commands that might consume excessive resources
    const resourceIntensivePatterns = [
      { pattern: /find\s+\/\s+/, reason: 'Full filesystem search may consume excessive resources' },
      { pattern: /grep\s+-r.*\//, reason: 'Recursive grep may consume excessive resources' },
      { pattern: /tar\s+.*\*/, reason: 'Large archive operations may consume excessive resources' },
      { pattern: /dd\s+.*bs=\d+[MG]/, reason: 'Large data operations may consume excessive memory' },
      { pattern: /sort\s+.*-S\s*\d+[MG]/, reason: 'Large sort operations may consume excessive memory' },
    ];

    for (const { pattern, reason } of resourceIntensivePatterns) {
      if (pattern.test(command)) {
        if (this.config.level === 'strict') {
          return {
            allowed: false,
            reason: `Resource-intensive command blocked: ${reason}`,
            riskLevel: 'medium',
            suggestions: ['Use more specific parameters to limit resource usage'],
          };
        }

        return {
          allowed: true,
          reason: `Resource-intensive command detected: ${reason}`,
          riskLevel: 'medium',
          suggestions: ['Monitor resource usage during execution'],
        };
      }
    }

    return { allowed: true, riskLevel: 'low' };
  }

  validateSandboxing(command: string): ValidationResult {
    if (!this.config.sandboxing?.enabled) {
      return { allowed: true, riskLevel: 'low' };
    }

    const sandbox = this.config.sandboxing;
    const segments = parseCommand(command);

    if (segments.some(segment => segment.unsafeSyntax)) {
      return {
        allowed: false,
        reason: 'Command contains shell syntax that cannot be inspected safely in sandbox mode',
        riskLevel: 'high',
        category: 'remote-execution',
        categories: ['remote-execution'],
        suggestions: ['Use a literal command without dynamic or encoded shell execution'],
      };
    }

    // Check network access
    if (!sandbox.networkAccess) {
      const usesNetwork = segments.some(segment =>
        NETWORK_COMMANDS.has(segment.name) ||
        (segment.name === 'rsync' && segment.args.some(arg => arg.includes('::') || /^[\w.-]+@/.test(arg))) ||
        (NETWORK_SUBCOMMANDS[segment.name] ?? []).includes(networkSubcommand(segment) ?? '')
      );

      if (usesNetwork) {
        return {
          allowed: false,
          reason: 'Network access is disabled in sandbox mode',
          riskLevel: 'medium',
          suggestions: ['Enable network access or use offline alternatives'],
        };
      }
    }

    // Check file system access
    if (sandbox.fileSystemAccess === 'read-only') {
      const writes = segments.some(segment =>
        WRITE_COMMANDS.has(segment.name) ||
        (segment.name === 'scp' && scpWritesLocal(segment.args)) ||
        (segment.name === 'sed' && segment.args.some(arg => arg.startsWith('-i'))) ||
        segment.redirects.some(target => !NON_FILE_REDIRECTS.has(target.toLowerCase()))
      );

      if (writes) {
        return {
          allowed: false,
          reason: 'Write operations are disabled in read-only sandbox mode',
          riskLevel: 'medium',
          suggestions: ['Switch to restricted or full file system access'],
        };
      }
    }

    return { allowed: true, riskLevel: 'low' };
  }

  async validateCommand(command: string): Promise<ValidationResult> {
    const normalizedCommand = command.trim().toLowerCase();

    this.auditLogger?.debug('Starting command validation', {
      command: command.substring(0, 100), // Truncate for logging
      securityLevel: this.config.level
    }, 'security-validator');

    // Check blocked commands first
    for (const blocked of this.config.blockedCommands) {
      if (normalizedCommand.includes(blocked.toLowerCase())) {
        this.auditLogger?.warning('Command blocked by explicit block list', {
          command: command.substring(0, 100),
          blockedPattern: blocked,
          securityLevel: this.config.level
        }, 'security-validator');

        return {
          allowed: false,
          reason: `Command contains blocked pattern: ${blocked}`,
          riskLevel: 'high',
          suggestions: ['Use a safer alternative command'],
        };
      }
    }

    // Check dangerous commands (matched on command tokens, not raw substrings)
    const classification = classifyCommand(command);
    if (classification.dangerous) {
      const riskLevel = classification.riskLevel;

      this.auditLogger?.warning('Dangerous pattern detected in command', {
        command: command.substring(0, 100),
        pattern: classification.reason,
        category: classification.category,
        riskLevel,
        securityLevel: this.config.level
      }, 'security-validator');

      if (this.config.level === 'strict' && riskLevel === 'high') {
        this.auditLogger?.alert('High-risk command blocked in strict mode', {
          command: command.substring(0, 100),
          riskLevel,
          securityLevel: this.config.level
        }, 'security-validator');

        return {
          allowed: false,
          reason: 'High-risk command blocked in strict mode',
          riskLevel,
          category: classification.category,
          categories: classification.categories,
          suggestions: ['Use a safer alternative or switch to moderate security level'],
        };
      }

      if (this.config.confirmDangerous && riskLevel !== 'low') {
        this.auditLogger?.notice('Dangerous command requires confirmation', {
          command: command.substring(0, 100),
          riskLevel,
          confirmDangerous: this.config.confirmDangerous
        }, 'security-validator');

        return {
          allowed: false,
          reason: 'Dangerous command requires confirmation',
          riskLevel,
          category: classification.category,
          categories: classification.categories,
          suggestions: ['Review command carefully before proceeding'],
        };
      }
    }

    // Check directory access
    const directoryCheck = this.validateDirectoryAccess(command);
    if (!directoryCheck.allowed) {
      return directoryCheck;
    }

    // Check privilege escalation
    const privilegeCheck = this.checkPrivilegeEscalation(command);
    if (!privilegeCheck.allowed) {
      return privilegeCheck;
    }

    // Check resource limits
    const resourceCheck = this.validateResourceLimits(command);
    if (!resourceCheck.allowed) {
      return resourceCheck;
    }

    // Check sandboxing restrictions
    const sandboxCheck = this.validateSandboxing(command);
    if (!sandboxCheck.allowed) {
      return sandboxCheck;
    }

    const finalRiskLevel = classification.riskLevel;

    this.auditLogger?.debug('Command validation completed', {
      command: command.substring(0, 100),
      allowed: true,
      riskLevel: finalRiskLevel,
      category: classification.category,
      categories: classification.categories,
      securityLevel: this.config.level
    }, 'security-validator');

    return {
      allowed: true,
      riskLevel: finalRiskLevel,
      category: classification.category,
      categories: classification.categories,
    };
  }
}
