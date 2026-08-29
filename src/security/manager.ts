/**
 * Security manager for command validation and sandboxing
 */

import * as path from 'path';
import * as os from 'os';
import { ValidationResult, LogLevel } from '../types/index';
import { AuditLogger } from '../audit/logger';
import { parseCommand, tokenizeCommand, matchesPattern, SubCommand } from './tokenize';

/** A dangerous-command check. `RegExp` satisfies this structurally. */
interface DangerousCheck {
  readonly source: string;
  test(command: string): boolean;
}

const RM_DESTRUCTIVE_FLAGS = ['r', 'R', 'recursive', 'f', 'force', 'no-preserve-root'];

/** True when any sub-command is an `rm` carrying a recursive/force flag, however the flags are spelled. */
function hasDestructiveRm(command: string): boolean {
  return tokenizeCommand(command).some(
    sub => sub.argv0 === 'rm' && RM_DESTRUCTIVE_FLAGS.some(flag => sub.flags.has(flag))
  );
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
  private dangerousPatterns: DangerousCheck[] = [];
  private systemDirectories: string[] = [];
  private auditLogger?: AuditLogger;

  constructor(config: SecurityConfig, auditLogger?: AuditLogger) {
    this.config = config;
    this.auditLogger = auditLogger;
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
      // File system destruction. Token-aware so flag order/clustering cannot hide it
      // (`rm -vrf`, `rm --no-preserve-root -r`, `sudo -u root rm -rf` all match).
      { source: 'rm with recursive/force flag', test: hasDestructiveRm },
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

  /**
   * Matches a `blockedCommands` entry against the parsed command.
   *
   * Entries are command patterns, not substrings: a single-word entry (`format`)
   * matches only when it is the command being run, and a multi-word entry
   * (`rm -rf /`) matches when the same command runs with at least those flags and
   * operands. An entry prefixed with `re:` is treated as a raw regex escape hatch.
   */
  private matchesBlockedCommand(command: string, subCommands: SubCommand[], blocked: string): boolean {
    const entry = blocked.trim();
    if (!entry) {
      return false;
    }

    if (entry.toLowerCase().startsWith('re:')) {
      try {
        return new RegExp(entry.slice(3), 'i').test(command);
      } catch (error) {
        this.auditLogger?.warning('Invalid regex in blockedCommands entry', {
          entry,
          error: error instanceof Error ? error.message : String(error),
        }, 'security-validator');
        return false;
      }
    }

    const pattern = parseCommand(entry).subCommands[0];
    if (!pattern) {
      return false;
    }
    return subCommands.some(sub => matchesPattern(sub, pattern));
  }

  async validateCommand(command: string): Promise<ValidationResult> {
    const normalizedCommand = command.trim().toLowerCase();

    this.auditLogger?.debug('Starting command validation', {
      command: command.substring(0, 100), // Truncate for logging
      securityLevel: this.config.level
    }, 'security-validator');

    // Check blocked commands first
    const parsedCommand = parseCommand(command);
    if (!parsedCommand.complete) {
      const parseError = parsedCommand.error || 'Unable to identify every executable';
      this.auditLogger?.warning('Command blocked because policy parsing was incomplete', {
        command: command.substring(0, 100),
        parseError,
        securityLevel: this.config.level,
      }, 'security-validator');
      return {
        allowed: false,
        reason: `Unable to safely parse command: ${parseError}`,
        riskLevel: 'high',
        suggestions: ['Use explicit command names and supported shell syntax'],
      };
    }
    const subCommands = parsedCommand.subCommands;
    for (const blocked of this.config.blockedCommands) {
      if (this.matchesBlockedCommand(command, subCommands, blocked)) {
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
    };
  }
}
