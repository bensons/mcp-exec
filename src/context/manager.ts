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
  CommandContext
} from '../types/index';

export interface ContextConfig {
  preserveWorkingDirectory: boolean;
  sessionPersistence: boolean;
  maxHistorySize: number;
}

export interface UpdateCommandOptions {
  id: string;
  command: string;
  workingDirectory: string;
  environment: Record<string, string>;
  output: CommandOutput;
  aiContext?: string;
}

export class ContextManager {
  private config: ContextConfig;
  private sessionId: string;
  private currentDirectory: string;
  private environmentVariables: Map<string, string>;
  private commandHistory: CommandHistoryEntry[];
  private outputCache: Map<string, CommandOutput>;
  private fileSystemChanges: FileSystemDiff[];

  constructor(config: ContextConfig) {
    this.config = config;
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
    const { id, command, workingDirectory, environment, output, aiContext } = options;

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
