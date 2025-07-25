"use strict";
/**
 * Security manager for command validation and sandboxing
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityManager = void 0;
const path = __importStar(require("path"));
class SecurityManager {
    config;
    dangerousPatterns = [];
    systemDirectories = [];
    auditLogger;
    constructor(config, auditLogger) {
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
    initializeDangerousPatterns() {
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
    initializeSystemDirectories() {
        if (process.platform === 'win32') {
            this.systemDirectories = [
                'C:\\Windows',
                'C:\\Program Files',
                'C:\\Program Files (x86)',
                'C:\\System Volume Information',
            ];
        }
        else {
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
    validateDirectoryAccess(command) {
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
    checkPrivilegeEscalation(command) {
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
    assessRiskLevel(command) {
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
    validateResourceLimits(command) {
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
    validateSandboxing(command) {
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
    async validateCommand(command) {
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
exports.SecurityManager = SecurityManager;
//# sourceMappingURL=manager.js.map