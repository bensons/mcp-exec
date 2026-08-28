/**
 * Context manager for preserving state across command executions
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

import {
  CommandHistoryEntry,
  CommandOutput,
  FileSystemDiff,
  CommandContext,
  LogLevel
} from '../types/index';
import { AuditLogger } from '../audit/logger';

export interface ContextConfig {
  preserveWorkingDirectory: boolean;
  sessionPersistence: boolean;
  maxHistorySize: number;
}

/** Persisted-session limits (issue #31): keep the file small and cheap to write. */
const PERSIST_DEBOUNCE_MS = 1000;
const PERSIST_MAX_HISTORY = 50;
const PERSIST_MAX_OUTPUT_CHARS = 1024;
const PERSIST_MAX_FS_CHANGES = 100;

// ponytail: local copy of the redaction helper; dedupe against src/audit/redact.ts from #30 once it lands.
const SECRET_KEY_PATTERN = /(pass|pwd|secret|token|key|credential|auth|session)/i;

function redactValue(key: string, value: string): string {
  return SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : value;
}

/** Redact `NAME=value` assignments with secret-looking names inside a command string. */
function redactCommand(command: string): string {
  return command.replace(/([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g, (match, key: string) =>
    SECRET_KEY_PATTERN.test(key) ? `${key}=[REDACTED]` : match
  );
}

export interface UpdateCommandOptions {
  id: string;
  command: string;
  workingDirectory: string;
  environment: Record<string, string>;
  output: CommandOutput;
  aiContext?: string;
  sessionId?: string;
  sessionType?: 'start' | 'input' | 'kill';
}

export class ContextManager {
  private config: ContextConfig;
  private sessionId: string;
  private currentDirectory: string;
  private environmentVariables: Map<string, string>;
  private commandHistory: CommandHistoryEntry[];
  private outputCache: Map<string, CommandOutput>;
  private fileSystemChanges: FileSystemDiff[];
  private auditLogger?: AuditLogger;
  private sessionFile: string;
  private persistTimer?: NodeJS.Timeout;

  constructor(config: ContextConfig, auditLogger?: AuditLogger) {
    this.config = config;
    this.auditLogger = auditLogger;
    this.sessionId = uuidv4();
    this.currentDirectory = process.cwd();
    this.environmentVariables = new Map();
    this.commandHistory = [];
    this.outputCache = new Map();
    this.fileSystemChanges = [];
    this.sessionFile = ContextManager.resolveSessionFile(auditLogger);

    // Initialize with current environment
    Object.entries(process.env).forEach(([key, value]) => {
      if (value !== undefined) {
        this.environmentVariables.set(key, value);
      }
    });

    // Log context manager initialization
    this.auditLogger?.notice('Context manager initialized', {
      sessionId: this.sessionId,
      currentDirectory: this.currentDirectory,
      preserveWorkingDirectory: config.preserveWorkingDirectory,
      sessionPersistence: config.sessionPersistence,
      maxHistorySize: config.maxHistorySize
    }, 'context-manager');
  }

  async getCurrentContext(sessionId?: string): Promise<CommandContext> {
    return {
      sessionId: sessionId || this.sessionId,
      currentDirectory: this.currentDirectory,
      workingDirectory: this.currentDirectory,
      environment: Object.fromEntries(this.environmentVariables),
      environmentVariables: Object.fromEntries(this.environmentVariables),
      commandHistory: this.commandHistory,
      outputCache: this.outputCache,
      fileSystemChanges: this.fileSystemChanges,
      previousCommands: this.commandHistory.slice(-5).map(h => h.command),
    };
  }

  async updateAfterCommand(options: UpdateCommandOptions): Promise<void> {
    const { id, command, workingDirectory, environment, output, aiContext, sessionId, sessionType } = options;

    this.auditLogger?.debug('Updating context after command execution', {
      commandId: id,
      command: command.substring(0, 50),
      workingDirectory,
      sessionId,
      sessionType
    }, 'context-manager');

    // Update working directory if command changed it
    if (this.config.preserveWorkingDirectory) {
      await this.updateWorkingDirectory(command, workingDirectory, output);
    }

    // Update environment variables
    this.updateEnvironmentVariables(environment);

    // Track file system changes
    await this.trackFileSystemChanges(command, workingDirectory, id);

    // Add to command history
    const historyEntry: CommandHistoryEntry = {
      id,
      command,
      timestamp: new Date(),
      workingDirectory,
      environment,
      output,
      relatedCommands: this.findRelatedCommands(command),
      aiContext,
      sessionId,
      sessionType,
    };

    this.commandHistory.push(historyEntry);

    // Maintain history size limit
    if (this.commandHistory.length > this.config.maxHistorySize) {
      const removed = this.commandHistory.shift();
      if (removed) {
        this.outputCache.delete(removed.id);
      }
    }

    // Cache output for reference
    this.outputCache.set(id, output);

    // Persist session if configured (debounced; see flushSession)
    this.schedulePersist();
  }

  async getHistory(limit?: number, filter?: string): Promise<CommandHistoryEntry[]> {
    let history = [...this.commandHistory];

    // Apply filter if provided
    if (filter) {
      const filterRegex = new RegExp(filter, 'i');
      history = history.filter(entry => 
        filterRegex.test(entry.command) || 
        (entry.aiContext && filterRegex.test(entry.aiContext))
      );
    }

    // Apply limit
    if (limit && limit > 0) {
      history = history.slice(-limit);
    }

    return history;
  }

  async getOutput(commandId: string): Promise<CommandOutput | undefined> {
    return this.outputCache.get(commandId);
  }

  async getFileSystemChanges(since?: Date): Promise<FileSystemDiff[]> {
    if (since) {
      return this.fileSystemChanges.filter(change => change.timestamp >= since);
    }
    return [...this.fileSystemChanges];
  }

  async setWorkingDirectory(directory: string): Promise<boolean> {
    try {
      const resolvedDir = path.resolve(directory);
      const stats = await fs.stat(resolvedDir);
      if (stats.isDirectory()) {
        this.currentDirectory = resolvedDir;
        return true;
      }
    } catch (error) {
      // Directory doesn't exist or not accessible
    }
    return false;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async clearHistory(): Promise<void> {
    this.commandHistory = [];
    this.outputCache.clear();
    this.fileSystemChanges = [];

    this.schedulePersist();
  }

  private async updateWorkingDirectory(
    command: string,
    currentWorkingDir: string,
    output: CommandOutput
  ): Promise<void> {
    // Check if command was a directory change
    const cdMatch = command.match(/^cd\s+(.+)$/i);
    if (cdMatch && output.exitCode === 0) {
      const targetDir = cdMatch[1].trim().replace(/['"]/g, '');

      try {
        let newDir: string;

        // Handle special directory shortcuts
        if (targetDir === '~') {
          newDir = process.env.HOME || process.env.USERPROFILE || currentWorkingDir;
        } else if (targetDir === '-') {
          // Previous directory - for now, just keep current
          return;
        } else if (targetDir === '..') {
          newDir = path.dirname(currentWorkingDir);
        } else if (targetDir === '.') {
          newDir = currentWorkingDir;
        } else if (path.isAbsolute(targetDir)) {
          newDir = targetDir;
        } else {
          newDir = path.resolve(currentWorkingDir, targetDir);
        }

        // Verify directory exists
        const stats = await fs.stat(newDir);
        if (stats.isDirectory()) {
          this.currentDirectory = newDir;
        }
      } catch (error) {
        // Directory doesn't exist or not accessible, keep current directory
      }
    }

    // Also check for pushd/popd commands
    const pushdMatch = command.match(/^pushd\s+(.+)$/i);
    if (pushdMatch && output.exitCode === 0) {
      const targetDir = pushdMatch[1].trim().replace(/['"]/g, '');
      await this.setWorkingDirectory(path.resolve(currentWorkingDir, targetDir));
    }
  }

  private updateEnvironmentVariables(environment: Record<string, string>): void {
    // Update environment variables that may have changed
    Object.entries(environment).forEach(([key, value]) => {
      this.environmentVariables.set(key, value);
    });

    // Look for export/set commands in recent history to track variable changes
    const recentCommands = this.commandHistory.slice(-5);
    for (const entry of recentCommands) {
      this.extractEnvironmentChanges(entry.command);
    }
  }

  private extractEnvironmentChangesFromCommand(command: string): Record<string, string> {
    const changes: Record<string, string> = {};

    // Extract environment variables from the current command
    this.extractEnvironmentChanges(command);

    // Return the changes that were made
    return changes;
  }

  private extractEnvironmentChanges(command: string): void {
    // Unix-style export with value
    const exportMatch = command.match(/export\s+(\w+)=(.+)/i);
    if (exportMatch) {
      const [, key, value] = exportMatch;
      this.environmentVariables.set(key, value.replace(/['"]/g, ''));
      return;
    }

    // Unix-style export without value (exports existing variable)
    const exportOnlyMatch = command.match(/export\s+(\w+)$/i);
    if (exportOnlyMatch) {
      const [, key] = exportOnlyMatch;
      // Keep existing value if it exists
      if (!this.environmentVariables.has(key) && process.env[key]) {
        this.environmentVariables.set(key, process.env[key]!);
      }
      return;
    }

    // Windows-style set
    const setMatch = command.match(/set\s+(\w+)=(.+)/i);
    if (setMatch) {
      const [, key, value] = setMatch;
      this.environmentVariables.set(key, value.replace(/['"]/g, ''));
      return;
    }

    // Inline variable assignment (VAR=value command)
    const inlineMatch = command.match(/^(\w+)=(.+?)\s+/);
    if (inlineMatch) {
      const [, key, value] = inlineMatch;
      this.environmentVariables.set(key, value.replace(/['"]/g, ''));
      return;
    }

    // Multiple inline assignments
    const multipleInlineMatches = command.match(/^((?:\w+=\S+\s+)+)/);
    if (multipleInlineMatches) {
      const assignments = multipleInlineMatches[1];
      const assignmentPattern = /(\w+)=(\S+)/g;
      let match;
      while ((match = assignmentPattern.exec(assignments)) !== null) {
        const [, key, value] = match;
        this.environmentVariables.set(key, value.replace(/['"]/g, ''));
      }
    }
  }

  private async trackFileSystemChanges(
    command: string, 
    workingDirectory: string, 
    commandId: string
  ): Promise<void> {
    // Simple heuristic-based file system change tracking
    // In a production system, this could use file system watchers
    
    const changePatterns = [
      { pattern: /^(touch|echo\s+.*>\s*|cat\s+.*>\s*)(.+)/, type: 'created' as const },
      { pattern: /^(cp|copy)\s+.+\s+(.+)/, type: 'created' as const },
      { pattern: /^(mv|move|ren)\s+(.+)\s+(.+)/, type: 'moved' as const },
      { pattern: /^(rm|del|rmdir)\s+(.+)/, type: 'deleted' as const },
      { pattern: /^(vim|nano|code|notepad)\s+(.+)/, type: 'modified' as const },
    ];

    for (const { pattern, type } of changePatterns) {
      const match = command.match(pattern);
      if (match) {
        let targetPath: string;
        let oldPath: string | undefined;

        if (type === 'moved' && match[3]) {
          oldPath = path.resolve(workingDirectory, match[2]);
          targetPath = path.resolve(workingDirectory, match[3]);
        } else {
          targetPath = path.resolve(workingDirectory, match[match.length - 1]);
        }

        const change: FileSystemDiff = {
          type,
          path: targetPath,
          oldPath,
          timestamp: new Date(),
          commandId,
        };

        this.fileSystemChanges.push(change);
        break;
      }
    }
  }

  private findRelatedCommands(command: string): string[] {
    const related: string[] = [];
    const commandWords = command.toLowerCase().split(/\s+/);

    // Find commands that share common elements
    for (const entry of this.commandHistory.slice(-10)) {
      const entryWords = entry.command.toLowerCase().split(/\s+/);
      const commonWords = commandWords.filter(word => 
        entryWords.includes(word) && word.length > 2
      );

      if (commonWords.length > 0) {
        related.push(entry.id);
      }
    }

    return related;
  }

  /**
   * Where the session snapshot lives: alongside the audit log (MCP_EXEC_LOG_DIR /
   * ~/.mcp-exec), never process.cwd() -- see issue #31.
   */
  private static resolveSessionFile(auditLogger?: AuditLogger): string {
    const filename = 'session.json';
    const logFile = auditLogger?.getLogFilePath?.();
    if (logFile) {
      return path.join(path.dirname(logFile), filename);
    }
    if (process.env.MCP_EXEC_LOG_DIR) {
      return path.join(path.resolve(process.env.MCP_EXEC_LOG_DIR), filename);
    }
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    return homeDir
      ? path.join(homeDir, '.mcp-exec', filename)
      : path.join(os.tmpdir(), filename);
  }

  /**
   * Environment variables that differ from the inherited process environment.
   * Only these are persisted -- the full process env holds the caller's secrets.
   */
  private getEnvironmentOverrides(): Record<string, string> {
    const overrides: Record<string, string> = {};
    for (const [key, value] of this.environmentVariables) {
      if (process.env[key] !== value) {
        overrides[key] = redactValue(key, value);
      }
    }
    return overrides;
  }

  /** Queue a trailing, unref'd write so a burst of commands costs one file write. */
  private schedulePersist(): void {
    if (!this.config.sessionPersistence || this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persistSession();
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  /** Write any pending session state now (called from gracefulShutdown). */
  async flushSession(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    if (this.config.sessionPersistence) {
      await this.persistSession();
    }
  }

  private async persistSession(): Promise<void> {
    try {
      const sessionData = {
        sessionId: this.sessionId,
        currentDirectory: this.currentDirectory,
        environmentOverrides: this.getEnvironmentOverrides(),
        commandHistory: this.commandHistory
          .slice(-PERSIST_MAX_HISTORY)
          .map(entry => ({
            id: entry.id,
            command: redactCommand(entry.command),
            timestamp: entry.timestamp,
            workingDirectory: entry.workingDirectory,
            output: {
              stdout: (entry.output.stdout || '').slice(0, PERSIST_MAX_OUTPUT_CHARS),
              stderr: (entry.output.stderr || '').slice(0, PERSIST_MAX_OUTPUT_CHARS),
              exitCode: entry.output.exitCode,
            },
            aiContext: entry.aiContext,
            sessionId: entry.sessionId,
            sessionType: entry.sessionType,
          })),
        fileSystemChanges: this.fileSystemChanges.slice(-PERSIST_MAX_FS_CHANGES),
        timestamp: new Date(),
      };

      const tmpFile = `${this.sessionFile}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(this.sessionFile), { recursive: true });
      await fs.writeFile(tmpFile, JSON.stringify(sessionData, null, 2));
      await fs.rename(tmpFile, this.sessionFile);
    } catch (error) {
      // Never disrupt (or spam stderr during) command execution because of persistence.
      this.auditLogger?.debug('Failed to persist session', {
        sessionFile: this.sessionFile,
        error: error instanceof Error ? error.message : String(error),
      }, 'context-manager');
    }
  }

  async loadSession(): Promise<void> {
    if (!this.config.sessionPersistence) {
      return;
    }

    try {
      const sessionData = JSON.parse(await fs.readFile(this.sessionFile, 'utf-8'));

      this.sessionId = sessionData.sessionId || this.sessionId;
      this.currentDirectory = sessionData.currentDirectory || this.currentDirectory;

      // Merge only the recorded overrides on top of the live process environment;
      // never restore a wholesale environment snapshot (issue #31).
      if (sessionData.environmentOverrides) {
        for (const [key, value] of Object.entries(sessionData.environmentOverrides)) {
          if (typeof value === 'string' && value !== '[REDACTED]') {
            this.environmentVariables.set(key, value);
          }
        }
      }

      if (Array.isArray(sessionData.commandHistory)) {
        this.commandHistory = sessionData.commandHistory.map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
          environment: entry.environment || {},
          relatedCommands: entry.relatedCommands || [],
        }));
        // Rebuild the output cache so get_output works for restored entries.
        this.outputCache.clear();
        for (const entry of this.commandHistory) {
          if (entry.output) {
            this.outputCache.set(entry.id, entry.output);
          }
        }
      }

      if (Array.isArray(sessionData.fileSystemChanges)) {
        this.fileSystemChanges = sessionData.fileSystemChanges.map((change: any) => ({
          ...change,
          timestamp: new Date(change.timestamp),
        }));
      }
    } catch (error) {
      // Silently fail session loading - start with fresh session
    }
  }
}
