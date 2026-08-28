/**
 * Context manager for preserving state across command executions
 */

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

export interface UpdateCommandOptions {
  id: string;
  command: string;
  workingDirectory: string;
  /** Environment the command actually ran with (recorded in history). */
  environment: Record<string, string>;
  /**
   * Per-command `env` overrides supplied by the caller. Recorded for the audit trail
   * but never merged into the persistent session environment.
   */
  envOverrides?: Record<string, string>;
  output: CommandOutput;
  aiContext?: string;
  sessionId?: string;
  sessionType?: 'start' | 'input' | 'kill';
}

export class ContextManager {
  private config: ContextConfig;
  private sessionId: string;
  private currentDirectory: string;
  private previousDirectory?: string;
  private directoryStack: string[] = [];
  private environmentVariables: Map<string, string>;
  private commandHistory: CommandHistoryEntry[];
  private outputCache: Map<string, CommandOutput>;
  private fileSystemChanges: FileSystemDiff[];
  private auditLogger?: AuditLogger;

  constructor(config: ContextConfig, auditLogger?: AuditLogger) {
    this.config = config;
    this.auditLogger = auditLogger;
    this.sessionId = uuidv4();
    this.currentDirectory = process.cwd();
    this.environmentVariables = new Map();
    this.commandHistory = [];
    this.outputCache = new Map();
    this.fileSystemChanges = [];

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
    const { id, command, workingDirectory, environment, envOverrides, output, aiContext, sessionId, sessionType } = options;

    this.auditLogger?.debug('Updating context after command execution', {
      commandId: id,
      command: command.substring(0, 50),
      workingDirectory,
      envOverrides: envOverrides ? Object.keys(envOverrides) : undefined,
      sessionId,
      sessionType
    }, 'context-manager');

    // Update working directory if command changed it
    if (this.config.preserveWorkingDirectory) {
      await this.updateWorkingDirectory(command, workingDirectory, output);
    }

    // Apply only the environment changes the command itself made; per-command
    // `envOverrides` stay scoped to that command.
    this.updateEnvironmentVariables(command, output);

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

    // Persist session if configured
    if (this.config.sessionPersistence) {
      await this.persistSession();
    }
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
        this.previousDirectory = this.currentDirectory;
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

    if (this.config.sessionPersistence) {
      await this.persistSession();
    }
  }

  /**
   * Track `cd`/`pushd`/`popd` in the executed command.
   *
   * Heuristic: the command already ran in its own shell, so its final cwd is not
   * observable here. We re-evaluate the directory-changing sub-commands instead,
   * and only when the command as a whole succeeded. Known ceiling: `cd /a || cd /b`
   * applies both (the `||` short-circuit is not modelled) -- upgrade path is to have
   * the executor append `printf '\0%s' "$PWD"` and read the real cwd back from stdout.
   */
  private async updateWorkingDirectory(
    command: string,
    currentWorkingDir: string,
    output: CommandOutput
  ): Promise<void> {
    if (output.exitCode !== 0) {
      return;
    }

    let cwd = currentWorkingDir;
    let changed = false;

    for (const subCommand of ContextManager.splitSubCommands(command)) {
      const tokens = ContextManager.tokenize(subCommand);
      const verb = tokens[0]?.toLowerCase();

      if (verb === 'popd') {
        const popped = this.directoryStack.pop();
        if (popped && await this.isDirectory(popped)) {
          this.previousDirectory = cwd;
          cwd = popped;
          changed = true;
        }
        continue;
      }

      if (verb !== 'cd' && verb !== 'pushd') {
        continue;
      }

      // Ignore option flags (`cd -P foo`); `cd -` is handled by expandDirectory.
      const target = tokens.slice(1).find(t => t === '-' || !t.startsWith('-'));
      const resolved = this.expandDirectory(target, cwd);
      if (!resolved || !(await this.isDirectory(resolved))) {
        continue;
      }

      if (verb === 'pushd') {
        this.directoryStack.push(cwd);
      }
      this.previousDirectory = cwd;
      cwd = resolved;
      changed = true;
    }

    if (changed) {
      this.currentDirectory = cwd;
    }
  }

  /** Resolve a `cd` argument (undefined/`~`/`$HOME`/`-`/relative/absolute) to an absolute path. */
  private expandDirectory(target: string | undefined, base: string): string | undefined {
    const home = process.env.HOME || process.env.USERPROFILE;

    if (target === undefined || target === '~' || target === '$HOME' || target === '${HOME}') {
      return home;
    }
    if (target === '-') {
      return this.previousDirectory;
    }
    for (const prefix of ['~/', '$HOME/', '${HOME}/']) {
      if (target.startsWith(prefix)) {
        return home ? path.resolve(home, target.slice(prefix.length)) : undefined;
      }
    }
    if (target.startsWith('$') || target.includes('$(') || target.includes('`')) {
      // Unresolvable without running a shell; leave the tracked directory alone.
      return undefined;
    }
    return path.resolve(base, target);
  }

  private async isDirectory(dir: string): Promise<boolean> {
    try {
      return (await fs.stat(dir)).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Apply persistent environment changes made by the executed command.
   *
   * Per-command `env` overrides are deliberately NOT applied: they are scoped to the
   * single command that requested them. Only `export`/`set`/`unset` parsed out of the
   * command itself persist, and only when the command succeeded.
   */
  private updateEnvironmentVariables(command: string, output: CommandOutput): void {
    if (output.exitCode !== 0) {
      return;
    }

    for (const subCommand of ContextManager.splitSubCommands(command)) {
      const tokens = ContextManager.tokenize(subCommand);
      if (tokens.length === 0) {
        continue;
      }
      const verb = tokens[0].toLowerCase();

      if (verb === 'unset') {
        for (const name of tokens.slice(1)) {
          if (/^\w+$/.test(name)) {
            this.environmentVariables.delete(name);
          }
        }
        continue;
      }

      // `export A=1 B=2 C` / `set NAME=value` (cmd.exe). Bash's `set -e`/`set -o ...`
      // takes no NAME=value argument, so it simply matches nothing here.
      if (verb === 'export' || verb === 'set') {
        for (const token of tokens.slice(1)) {
          const assignment = ContextManager.parseAssignment(token);
          if (assignment) {
            this.environmentVariables.set(assignment.name, assignment.value);
          } else if (
            verb === 'export' &&
            /^\w+$/.test(token) &&
            !this.environmentVariables.has(token) &&
            process.env[token]
          ) {
            this.environmentVariables.set(token, process.env[token]!);
          }
        }
        continue;
      }

      // A bare `FOO=bar` assignment (no command word after it) persists in a shell.
      // `FOO=bar make` does not -- it is scoped to that one command.
      const bare = ContextManager.parseAssignment(tokens[0]);
      if (bare && tokens.length === 1) {
        this.environmentVariables.set(bare.name, bare.value);
      }
    }
  }

  private static parseAssignment(token: string): { name: string; value: string } | undefined {
    const match = token.match(/^(\w+)=([\s\S]*)$/);
    return match ? { name: match[1], value: match[2] } : undefined;
  }

  /** Split a command line into sub-commands on unquoted `;` `&&` `||` `|` `&` and newlines. */
  private static splitSubCommands(command: string): string[] {
    const parts: string[] = [];
    let current = '';
    let quote: string | undefined;

    for (let i = 0; i < command.length; i++) {
      const ch = command[i];
      if (quote) {
        current += ch;
        if (ch === '\\' && quote === '"' && i + 1 < command.length) {
          current += command[++i];
        } else if (ch === quote) {
          quote = undefined;
        }
        continue;
      }
      if (ch === '\\' && i + 1 < command.length) {
        current += ch + command[++i];
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === ';' || ch === '\n' || ch === '|' || ch === '&') {
        if ((ch === '|' || ch === '&') && command[i + 1] === ch) {
          i++;
        }
        parts.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    parts.push(current);

    return parts.map(part => part.trim()).filter(part => part.length > 0);
  }

  /** Split on unquoted whitespace, removing one level of quoting/escaping. */
  private static tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let started = false;
    let quote: string | undefined;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (quote) {
        if (ch === '\\' && quote === '"' && i + 1 < input.length) {
          current += input[++i];
        } else if (ch === quote) {
          quote = undefined;
        } else {
          current += ch;
        }
        continue;
      }
      if (ch === '\\' && i + 1 < input.length) {
        current += input[++i];
        started = true;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        started = true;
        continue;
      }
      if (/\s/.test(ch)) {
        if (started) {
          tokens.push(current);
          current = '';
          started = false;
        }
        continue;
      }
      current += ch;
      started = true;
    }
    if (started) {
      tokens.push(current);
    }

    return tokens;
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

  private async persistSession(): Promise<void> {
    try {
      const sessionData = {
        sessionId: this.sessionId,
        currentDirectory: this.currentDirectory,
        environmentVariables: Object.fromEntries(this.environmentVariables),
        commandHistory: this.commandHistory,
        fileSystemChanges: this.fileSystemChanges,
        timestamp: new Date(),
      };

      const sessionFile = path.join(process.cwd(), '.mcp-exec-session.json');
      await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2));
    } catch (error) {
      // Silently fail session persistence to avoid disrupting command execution
      console.warn('Failed to persist session:', error);
    }
  }

  async loadSession(): Promise<void> {
    if (!this.config.sessionPersistence) {
      return;
    }

    try {
      const sessionFile = path.join(process.cwd(), '.mcp-exec-session.json');
      const sessionData = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));

      this.sessionId = sessionData.sessionId || this.sessionId;
      this.currentDirectory = sessionData.currentDirectory || this.currentDirectory;
      
      if (sessionData.environmentVariables) {
        this.environmentVariables = new Map(Object.entries(sessionData.environmentVariables));
      }
      
      if (sessionData.commandHistory) {
        this.commandHistory = sessionData.commandHistory.map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        }));
      }
      
      if (sessionData.fileSystemChanges) {
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
