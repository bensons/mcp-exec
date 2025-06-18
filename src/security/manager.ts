/**
 * Security manager for command validation and sandboxing
 */

import * as path from 'path';
import * as os from 'os';
import { ValidationResult } from '../types/index';

export interface SecurityConfig {
  level: 'strict' | 'moderate' | 'permissive';
  confirmDangerous: boolean;
  allowedDirectories: string[];
  blockedCommands: string[];
  timeout: number;
}

export class SecurityManager {
  private config: SecurityConfig;
  private dangerousPatterns: RegExp[] = [];
  private systemDirectories: string[] = [];

  constructor(config: SecurityConfig) {
    this.config = config;
    this.initializeDangerousPatterns();
    this.initializeSystemDirectories();
  }

  async validateCommand(command: string): Promise<ValidationResult> {
    const normalizedCommand = command.trim().toLowerCase();

    // Check blocked commands
    for (const blocked of this.config.blockedCommands) {
      if (normalizedCommand.includes(blocked.toLowerCase())) {
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
        
        if (this.config.level === 'strict' && riskLevel === 'high') {
          return {
            allowed: false,
            reason: 'High-risk command blocked in strict mode',
            riskLevel,
            suggestions: ['Use a safer alternative or switch to moderate security level'],
          };
        }

        if (this.config.confirmDangerous && riskLevel !== 'low') {
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

    // Check for privilege escalation
    const privilegeCheck = this.checkPrivilegeEscalation(command);
    if (!privilegeCheck.allowed) {
      return privilegeCheck;
    }

    return {
      allowed: true,
      riskLevel: this.assessRiskLevel(command),
    };
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
    ];

    // Medium risk indicators
    const mediumRiskPatterns = [
      /rm\s+/,
      /del\s+/,
      /mv\s+.*\/dev\/null/,
      /kill\s+/,
      /chmod\s+777/,
      /chown\s+/,
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
}
