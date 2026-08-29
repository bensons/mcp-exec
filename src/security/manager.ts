/**
 * Security manager for command validation and sandboxing
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { ValidationResult, LogLevel } from '../types/index';
import { AuditLogger } from '../audit/logger';

const SERVER_STARTUP_CWD = process.cwd();

type ShellToken =
  | { type: 'operator'; value: string }
  | {
      type: 'word';
      value: string;
      expandable: boolean[];
      unquoted: boolean[];
    };

/**
 * True when `child` is `parent` itself or lives underneath it.
 * Uses path.relative so allowing `/home/user` does not also allow `/home/user-other`.
 */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Expand a leading `~` and resolve against `baseDir` (not the server's own cwd). */
export function resolvePath(target: string, baseDir: string, expandTilde = true): string {
  if (expandTilde && (target === '~' || target.startsWith('~/') || target.startsWith(`~${path.sep}`))) {
    return path.resolve(os.homedir(), target.slice(2) || '.');
  }
  return path.resolve(baseDir, target);
}

/**
 * Resolve symlinks in the existing portion of a path. This keeps an allowlisted
 * symlink from granting access to a target outside the allowlist while still
 * permitting validation of output paths that do not exist yet.
 */
function canonicalizePath(target: string): string {
  let existing = target;
  const suffix: string[] = [];

  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      return path.normalize(target);
    }
    suffix.unshift(path.basename(existing));
    existing = parent;
  }

  try {
    return path.resolve(fs.realpathSync.native(existing), ...suffix);
  } catch {
    return path.normalize(target);
  }
}

/**
 * Only tokens containing a path separator (or a leading `~`, or `.`/`..`) are treated
 * as paths. Bare words like `hello.txt` or `1.2.3` are skipped: without a separator
 * they cannot escape the working directory, and checking them would false-positive on
 * ordinary arguments.
 */
function isPathLike(token: string): boolean {
  if (/^file:/i.test(token)) {
    return true;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(token)) {
    return false; // URL, not a path
  }
  return (
    token.includes('/') ||
    token.includes('\\') ||
    token.startsWith('~') ||
    /^[a-zA-Z]:/.test(token) ||
    token === '.' ||
    token === '..'
  );
}

function tokenizeShell(command: string): { tokens?: ShellToken[]; error?: string } {
  const tokens: ShellToken[] = [];
  const isWindows = process.platform === 'win32';
  let quote: "'" | '"' | null = null;
  let value = '';
  let expandable: boolean[] = [];
  let unquoted: boolean[] = [];

  const append = (character: string, canExpand: boolean, isUnquoted: boolean) => {
    value += character;
    for (let index = 0; index < character.length; index += 1) {
      expandable.push(canExpand);
      unquoted.push(isUnquoted);
    }
  };
  const flushWord = () => {
    if (value.length > 0) {
      tokens.push({ type: 'word', value, expandable, unquoted });
      value = '';
      expandable = [];
      unquoted = [];
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }
      if (!isWindows && quote === '"' && character === '\\') {
        const next = command[index + 1];
        if (next === undefined) {
          return { error: 'Trailing escape in quoted shell word' };
        }
        append(next, false, false);
        index += 1;
        continue;
      }
      append(character, quote !== "'", false);
      continue;
    }

    if (character === '"' || (!isWindows && character === "'")) {
      quote = character as "'" | '"';
      continue;
    }

    if ((!isWindows && character === '\\') || (isWindows && character === '^')) {
      const next = command[index + 1];
      if (next === undefined) {
        return { error: 'Trailing shell escape' };
      }
      append(next, false, true);
      index += 1;
      continue;
    }

    if (/\s/.test(character)) {
      flushWord();
      if (character === '\n' || character === '\r') {
        tokens.push({ type: 'operator', value: ';' });
      }
      continue;
    }

    if ('<>|&;()'.includes(character)) {
      flushWord();
      let operator = character;
      while (index + 1 < command.length && '<>|&;'.includes(command[index + 1])) {
        operator += command[index + 1];
        index += 1;
      }
      tokens.push({ type: 'operator', value: operator });
      continue;
    }

    if (character === '#' && value.length === 0) {
      break;
    }

    append(character, true, true);
  }

  if (quote) {
    return { error: 'Unterminated quoted shell word' };
  }
  flushWord();
  return { tokens };
}

function expandShellWord(
  word: Extract<ShellToken, { type: 'word' }>,
  environment: Record<string, string | undefined>,
  cwd: string
): { value?: string; error?: string } {
  let expanded = '';

  for (let index = 0; index < word.value.length; index += 1) {
    const character = word.value[index];

    if (word.expandable[index] && character === '`') {
      return { error: 'Command substitutions cannot be safely resolved' };
    }

    if (word.expandable[index] && character === '$') {
      const next = word.value[index + 1];
      if (next === '(') {
        return { error: 'Command substitutions cannot be safely resolved' };
      }

      let variableName = '';
      let endIndex = index;
      if (next === '{') {
        const closingBrace = word.value.indexOf('}', index + 2);
        if (closingBrace === -1) {
          return { error: 'Unterminated environment-variable expansion' };
        }
        variableName = word.value.slice(index + 2, closingBrace);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName)) {
          return { error: `Unsupported shell expansion: \${${variableName}}` };
        }
        endIndex = closingBrace;
      } else {
        const variableMatch = word.value.slice(index + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if (!variableMatch) {
          return { error: 'Unsupported shell parameter expansion' };
        }
        variableName = variableMatch[0];
        endIndex = index + variableName.length;
      }

      const value = variableName === 'PWD' ? cwd : (environment[variableName] ?? '');
      if (word.unquoted[index] && /\s/.test(value)) {
        return { error: `Unquoted expansion of ${variableName} would require shell word splitting` };
      }
      expanded += value;
      index = endIndex;
      continue;
    }

    if (process.platform === 'win32' && word.expandable[index] && character === '%') {
      const closingPercent = word.value.indexOf('%', index + 1);
      if (closingPercent === -1) {
        return { error: 'Unterminated Windows environment-variable expansion' };
      }
      const variableName = word.value.slice(index + 1, closingPercent);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName) || environment[variableName] === undefined) {
        return { error: `Unresolved Windows environment-variable expansion: %${variableName}%` };
      }
      expanded += environment[variableName];
      index = closingPercent;
      continue;
    }

    if (word.unquoted[index] && '{}'.includes(character)) {
      return { error: 'Shell brace expansion cannot be safely resolved' };
    }

    expanded += character;
  }

  if (expanded.startsWith('~') && word.unquoted[0]) {
    if (expanded !== '~' && !expanded.startsWith('~/') && !expanded.startsWith('~\\')) {
      return { error: 'Named-user home expansion cannot be safely resolved' };
    }
    const home = environment.HOME || environment.USERPROFILE || os.homedir();
    expanded = path.resolve(home, expanded.slice(2) || '.');
  }

  return { value: expanded };
}

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

export class SecurityManager {
  private config: SecurityConfig;
  private dangerousPatterns: RegExp[] = [];
  private systemDirectories: string[] = [];
  private allowedDirectories: string[] = [];
  private configurationBase: string;
  private auditLogger?: AuditLogger;

  constructor(
    config: SecurityConfig,
    auditLogger?: AuditLogger,
    configurationBase: string = SERVER_STARTUP_CWD
  ) {
    this.config = config;
    this.auditLogger = auditLogger;
    this.configurationBase = canonicalizePath(path.resolve(configurationBase));
    // Configuration paths are resolved once against a trusted, stable base.
    // They must never move with a caller-controlled command cwd.
    this.allowedDirectories = config.allowedDirectories.map(directory =>
      canonicalizePath(resolvePath(directory, this.configurationBase))
    );
    this.initializeDangerousPatterns();
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



  private initializeDangerousPatterns(): void {
    this.dangerousPatterns = [
      // File system destruction
      /rm\s+(-[rf]+|--recursive|--force)/i,
      /del\s+\/[fs]/i,
      /rmdir\s+\/s/i,
      /format\s+[a-z]:/i,
      
      // System modification
      /dd\s+if=/i,
      /mkfs/i,
      /fdisk/i,
      /parted/i,
      /diskpart/i,
      
      // Network operations
      /wget\s+.*\|\s*(sh|bash|cmd)/i,
      /curl\s+.*\|\s*(sh|bash|cmd)/i,
      
      // Process manipulation
      /kill\s+-9/i,
      /killall/i,
      /pkill/i,
      
      // System control
      /shutdown/i,
      /reboot/i,
      /halt/i,
      /systemctl\s+(stop|disable)/i,
      /service\s+.*\s+stop/i,
      
      // Privilege escalation
      /sudo\s+su/i,
      /su\s+-/i,
      
      // Dangerous redirects
      />\s*\/dev\/(null|zero|random)/i,
      />\s*\/etc\//i,
      />\s*\/sys\//i,
      />\s*\/proc\//i,
    ];
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

  private denyUnresolved(reason: string): ValidationResult {
    return {
      allowed: false,
      reason: `Directory policy could not safely resolve command: ${reason}`,
      riskLevel: 'high',
      suggestions: ['Use explicit, fully resolved paths and simple shell syntax'],
    };
  }

  private validateResolvedPath(resolvedPath: string, displayPath: string): ValidationResult {
    const canonicalPath = canonicalizePath(resolvedPath);

    if (this.config.level === 'strict') {
      for (const sysDir of this.systemDirectories) {
        if (isInside(canonicalizePath(sysDir), canonicalPath)) {
          return {
            allowed: false,
            reason: `Access to system directory blocked: ${sysDir}`,
            riskLevel: 'high',
            suggestions: ['Use a path within allowed directories'],
          };
        }
      }
    }

    if (
      this.allowedDirectories.length > 0 &&
      !this.allowedDirectories.some(allowedDirectory => isInside(allowedDirectory, canonicalPath))
    ) {
      return {
        allowed: false,
        reason: `Path not in allowed directories: ${displayPath}`,
        riskLevel: 'medium',
        suggestions: [`Use a path within: ${this.config.allowedDirectories.join(', ')}`],
      };
    }

    return { allowed: true, riskLevel: 'low' };
  }

  private resolveFileReference(token: string, baseDir: string): { path?: string; error?: string } {
    if (!/^file:/i.test(token)) {
      return { path: canonicalizePath(resolvePath(token, baseDir, false)) };
    }

    try {
      const fileUrl = new URL(token);
      if (fileUrl.protocol !== 'file:') {
        return { error: 'Unsupported URL scheme in local path' };
      }
      return { path: canonicalizePath(fileURLToPath(fileUrl)) };
    } catch {
      return { error: 'Invalid or unsupported local file URL' };
    }
  }

  private validateDirectoryAccess(
    command: string,
    cwd?: string,
    environment: Record<string, string | undefined> = process.env
  ): ValidationResult {
    if (this.allowedDirectories.length === 0 && this.config.level !== 'strict') {
      return { allowed: true, riskLevel: 'low' };
    }

    const baseDir = canonicalizePath(resolvePath(cwd || process.cwd(), this.configurationBase, false));
    const cwdCheck = this.validateResolvedPath(baseDir, `working directory ${cwd || baseDir}`);
    if (!cwdCheck.allowed) {
      return cwdCheck;
    }

    const parsed = tokenizeShell(command);
    if (!parsed.tokens) {
      return this.denyUnresolved(parsed.error || 'Invalid shell syntax');
    }

    const effectiveEnvironment: Record<string, string | undefined> = {
      ...environment,
      PWD: baseDir,
      CD: baseDir,
    };
    const expandedWords = new Map<ShellToken, string>();

    for (const token of parsed.tokens) {
      if (token.type !== 'word') {
        if (token.value.startsWith('<<')) {
          return this.denyUnresolved('Here-document syntax is not supported by directory policy');
        }
        continue;
      }

      const expanded = expandShellWord(token, effectiveEnvironment, baseDir);
      if (expanded.value === undefined) {
        return this.denyUnresolved(expanded.error || 'Unresolved shell expansion');
      }
      expandedWords.set(token, expanded.value);
    }

    // Stateful shells need a deterministic cwd after every accepted directory
    // change. Compound changes and directory-stack builtins are rejected rather
    // than guessed.
    let atCommandStart = true;
    let directoryCommand: string | undefined;
    for (let index = 0; index < parsed.tokens.length; index += 1) {
      const token = parsed.tokens[index];
      if (token.type === 'operator') {
        if (/[|&;()]/.test(token.value)) {
          atCommandStart = true;
        }
        continue;
      }
      if (!atCommandStart) {
        continue;
      }

      const value = expandedWords.get(token) || '';
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) {
        continue;
      }

      const commandName = path.basename(value).toLowerCase();
      if (commandName === 'builtin' || commandName === 'command') {
        const next = parsed.tokens[index + 1];
        if (next?.type === 'word') {
          directoryCommand = path.basename(expandedWords.get(next) || '').toLowerCase();
        }
      } else {
        directoryCommand = commandName;
      }

      if (directoryCommand && ['cd', 'chdir', 'pushd', 'popd'].includes(directoryCommand)) {
        break;
      }
      directoryCommand = undefined;
      atCommandStart = false;
    }

    let resultingCwd: string | undefined;
    if (directoryCommand) {
      const operators = parsed.tokens.filter(token => token.type === 'operator');
      const words = parsed.tokens
        .filter((token): token is Extract<ShellToken, { type: 'word' }> => token.type === 'word')
        .map(token => expandedWords.get(token) || '');
      const cdIndex = words.findIndex(word => path.basename(word).toLowerCase() === directoryCommand);

      if (directoryCommand !== 'cd' || operators.length > 0 || cdIndex === -1) {
        return this.denyUnresolved(`Stateful directory command '${directoryCommand}' is not safely trackable`);
      }

      let args = words.slice(cdIndex + 1);
      if (process.platform === 'win32' && args[0]?.toLowerCase() === '/d') {
        args = args.slice(1);
      }
      while (args[0] === '-L' || args[0] === '-P' || args[0] === '--') {
        args = args.slice(1);
      }
      if (args.length > 1 || args[0] === '-') {
        return this.denyUnresolved('The requested cd form is not safely trackable');
      }

      const target = args[0] || effectiveEnvironment.HOME || effectiveEnvironment.USERPROFILE || os.homedir();
      if (!path.isAbsolute(target) && effectiveEnvironment.CDPATH) {
        return this.denyUnresolved('Relative cd with CDPATH is not safely trackable');
      }
      const resolved = this.resolveFileReference(target, baseDir);
      if (!resolved.path) {
        return this.denyUnresolved(resolved.error || 'Could not resolve cd target');
      }
      const targetCheck = this.validateResolvedPath(resolved.path, 'cd target');
      if (!targetCheck.allowed) {
        return targetCheck;
      }
      resultingCwd = resolved.path;
    }

    for (const token of parsed.tokens) {
      if (token.type !== 'word') {
        continue;
      }

      let candidate = expandedWords.get(token) || '';
      let displayCandidate = token.value;
      const equals = candidate.indexOf('=');
      if (equals !== -1) {
        candidate = candidate.slice(equals + 1);
        displayCandidate = displayCandidate.slice(displayCandidate.indexOf('=') + 1);
      }
      if (!candidate || !isPathLike(candidate)) {
        continue;
      }
      if (token.unquoted.some(Boolean) && /[*?[]/.test(candidate)) {
        return this.denyUnresolved('Wildcard path expansion is not supported');
      }

      const resolved = this.resolveFileReference(candidate, baseDir);
      if (!resolved.path) {
        return this.denyUnresolved(resolved.error || 'Could not resolve path');
      }
      // Diagnostics retain the user's expression rather than its potentially
      // sensitive environment-derived expansion.
      const pathCheck = this.validateResolvedPath(resolved.path, displayCandidate);
      if (!pathCheck.allowed) {
        return pathCheck;
      }
    }

    return { allowed: true, riskLevel: 'low', resultingCwd };
  }

  private checkPrivilegeEscalation(command: string): ValidationResult {
    const privilegePatterns = [
      /sudo/i,
      /su\s/i,
      /runas/i,
      /elevate/i,
    ];

    for (const pattern of privilegePatterns) {
      if (pattern.test(command)) {
        if (this.config.level === 'strict') {
          return {
            allowed: false,
            reason: 'Privilege escalation commands blocked in strict mode',
            riskLevel: 'high',
            suggestions: ['Run without elevated privileges or switch security level'],
          };
        }

        return {
          allowed: true,
          reason: 'Privilege escalation detected',
          riskLevel: 'high',
          suggestions: ['Ensure you understand the implications of elevated privileges'],
        };
      }
    }

    return { allowed: true, riskLevel: 'low' };
  }

  private assessRiskLevel(command: string): 'low' | 'medium' | 'high' {
    const normalizedCommand = command.toLowerCase();

    // High risk indicators
    const highRiskPatterns = [
      /rm\s+.*-r/,
      /del\s+\/[fs]/,
      /format/,
      /dd\s+if=/,
      /sudo/,
      /shutdown/,
      /reboot/,
      /mkfs/,
      /fdisk/,
      /parted/,
    ];

    // Medium risk indicators
    const mediumRiskPatterns = [
      /rm\s+/,
      /del\s+/,
      /mv\s+.*\/dev\/null/,
      /kill\s+/,
      /chmod\s+777/,
      /chown\s+/,
      /wget.*\|/,
      /curl.*\|/,
      />\s*\/etc/,
      />\s*\/sys/,
    ];

    for (const pattern of highRiskPatterns) {
      if (pattern.test(normalizedCommand)) {
        return 'high';
      }
    }

    for (const pattern of mediumRiskPatterns) {
      if (pattern.test(normalizedCommand)) {
        return 'medium';
      }
    }

    return 'low';
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

    // Check network access
    if (!sandbox.networkAccess) {
      const networkPatterns = [
        /wget/i,
        /curl/i,
        /ssh/i,
        /scp/i,
        /rsync.*::/i,
        /git\s+(clone|pull|push|fetch)/i,
        /npm\s+(install|update)/i,
        /pip\s+(install|upgrade)/i,
      ];

      for (const pattern of networkPatterns) {
        if (pattern.test(command)) {
          return {
            allowed: false,
            reason: 'Network access is disabled in sandbox mode',
            riskLevel: 'medium',
            suggestions: ['Enable network access or use offline alternatives'],
          };
        }
      }
    }

    // Check file system access
    if (sandbox.fileSystemAccess === 'read-only') {
      const writePatterns = [
        />\s*[^&]/,
        />>/,
        /touch/i,
        /mkdir/i,
        /rm/i,
        /del/i,
        /mv/i,
        /cp.*\s+\S+$/i,
        /echo.*>/,
      ];

      for (const pattern of writePatterns) {
        if (pattern.test(command)) {
          return {
            allowed: false,
            reason: 'Write operations are disabled in read-only sandbox mode',
            riskLevel: 'medium',
            suggestions: ['Switch to restricted or full file system access'],
          };
        }
      }
    }

    return { allowed: true, riskLevel: 'low' };
  }

  async validateCommand(
    command: string,
    options: { cwd?: string; env?: Record<string, string | undefined> } = {}
  ): Promise<ValidationResult> {
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

    // Check dangerous patterns
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(normalizedCommand)) {
        const riskLevel = this.assessRiskLevel(command);

        this.auditLogger?.warning('Dangerous pattern detected in command', {
          command: command.substring(0, 100),
          pattern: pattern.source,
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
            suggestions: ['Review command carefully before proceeding'],
          };
        }
      }
    }

    // Check directory access
    const directoryCheck = this.validateDirectoryAccess(command, options.cwd, options.env);
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

    const finalRiskLevel = this.assessRiskLevel(command);

    this.auditLogger?.debug('Command validation completed', {
      command: command.substring(0, 100),
      allowed: true,
      riskLevel: finalRiskLevel,
      securityLevel: this.config.level
    }, 'security-validator');

    return {
      allowed: true,
      riskLevel: finalRiskLevel,
      resultingCwd: directoryCheck.resultingCwd,
    };
  }
}
