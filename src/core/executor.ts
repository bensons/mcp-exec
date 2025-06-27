/**
 * Core shell command executor with cross-platform support
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

import { CommandOutput, ServerConfig } from '../types/index';
import { SecurityManager } from '../security/manager';
import { ContextManager } from '../context/manager';
import { AuditLogger } from '../audit/logger';
import { OutputProcessor } from '../utils/output-processor';
import { IntentTracker } from '../utils/intent-tracker';

export interface ExecuteCommandOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  shell?: boolean | string;
  aiContext?: string;
}

export class ShellExecutor {
  private securityManager: SecurityManager;
  private contextManager: ContextManager;
  private auditLogger: AuditLogger;
  private outputProcessor: OutputProcessor;
  private intentTracker: IntentTracker;
  private config: ServerConfig;

  constructor(
    securityManager: SecurityManager,
    contextManager: ContextManager,
    auditLogger: AuditLogger,
    config: ServerConfig
  ) {
    this.securityManager = securityManager;
    this.contextManager = contextManager;
    this.auditLogger = auditLogger;
    this.config = config;
    this.outputProcessor = new OutputProcessor(config.output);
    this.intentTracker = new IntentTracker();
  }

  async executeCommand(options: ExecuteCommandOptions): Promise<CommandOutput> {
    const commandId = uuidv4();
    const startTime = Date.now();

    try {
      // Security validation
      const fullCommand = this.buildFullCommand(options);
      const securityCheck = await this.securityManager.validateCommand(fullCommand);

      if (!securityCheck.allowed) {
        throw new Error(`Command blocked by security policy: ${securityCheck.reason}`);
      }

      // Analyze command intent
      const intent = this.intentTracker.analyzeIntent(fullCommand, options.aiContext);

      // Get current context
      const context = await this.contextManager.getCurrentContext();
      
      // Determine working directory
      const workingDirectory = options.cwd || context.currentDirectory || process.cwd();
      
      // Merge environment variables
      const environment = {
        ...process.env,
        ...context.environmentVariables,
        ...options.env,
      };

      // Execute command
      const result = await this.executeWithTimeout(
        options.command,
        options.args || [],
        {
          cwd: workingDirectory,
          env: environment,
          shell: options.shell !== undefined ? options.shell : true,
          timeout: options.timeout || this.config.security.timeout,
        }
      );

      // Process output
      const processedOutput = await this.outputProcessor.process(result, fullCommand);

      // Enhance output with intent information
      processedOutput.metadata.commandIntent = intent;
      processedOutput.summary.nextSteps = [
        ...(processedOutput.summary.nextSteps || []),
        ...this.intentTracker.suggestNextCommands(fullCommand).slice(0, 3)
      ];

      // Update context
      await this.contextManager.updateAfterCommand({
        id: commandId,
        command: fullCommand,
        workingDirectory,
        environment: environment as Record<string, string>,
        output: processedOutput,
        aiContext: options.aiContext,
      });

      // Log execution
      await this.auditLogger.logCommand({
        commandId,
        command: fullCommand,
        context: {
          ...context,
          workingDirectory,
          environment: environment as Record<string, string>,
          aiIntent: options.aiContext,
        },
        result: processedOutput,
        securityCheck,
        executionTime: Date.now() - startTime,
      });

      return processedOutput;

    } catch (error) {
      const errorOutput: CommandOutput = {
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error',
        exitCode: 1,
        metadata: {
          executionTime: Date.now() - startTime,
          commandType: 'error',
          affectedResources: [],
          warnings: [],
          suggestions: ['Check command syntax and permissions'],
        },
        summary: {
          success: false,
          mainResult: `Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          sideEffects: [],
          nextSteps: ['Review error message and correct command'],
        },
      };

      // Log error
      const errorContext = await this.contextManager.getCurrentContext();
      await this.auditLogger.logError({
        commandId,
        command: this.buildFullCommand(options),
        error: error instanceof Error ? error : new Error('Unknown error'),
        context: errorContext,
      });

      return errorOutput;
    }
  }

  getIntentSummary() {
    return this.intentTracker.getIntentSummary();
  }

  suggestNextCommands(command: string): string[] {
    return this.intentTracker.suggestNextCommands(command);
  }

  getRecentIntents(limit?: number) {
    return this.intentTracker.getRecentIntents(limit);
  }

  private buildFullCommand(options: ExecuteCommandOptions): string {
    if (options.args && options.args.length > 0) {
      return `${options.command} ${options.args.join(' ')}`;
    }
    return options.command;
  }

  private async executeWithTimeout(
    command: string,
    args: string[],
    options: SpawnOptions & { timeout: number }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const { timeout, ...spawnOptions } = options;

      // Determine execution method based on shell option
      let execCommand: string;
      let execArgs: string[];

      if (spawnOptions.shell) {
        // When shell=true, let Node.js handle the shell execution
        execCommand = command;
        execArgs = args;
      } else {
        // When shell=false, manually construct shell command
        if (process.platform === 'win32') {
          execCommand = 'cmd.exe';
          execArgs = ['/c', command, ...args];
        } else {
          execCommand = '/bin/sh';
          const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
          execArgs = ['-c', fullCommand];
        }
      }



      const child = spawn(execCommand, execArgs, {
        ...spawnOptions,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout;

      // Set up timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      }

      // Collect output
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle completion
      child.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }



        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        });
      });

      // Handle errors
      child.on('error', (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(error);
      });
    });
  }
}
