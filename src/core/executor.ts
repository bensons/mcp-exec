/**
 * Core shell command executor with cross-platform support
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

import { CommandOutput, ServerConfig, SessionOutput } from '../types/index';
import { SecurityManager } from '../security/manager';
import { assertCommandAllowed } from '../security/command-policy';
import { ContextManager } from '../context/manager';
import { AuditLogger } from '../audit/logger';
import { OutputProcessor } from '../utils/output-processor';
import { IntentTracker } from '../utils/intent-tracker';
import { InteractiveSessionManager, StartSessionOptions, SendInputOptions } from './interactive-session-manager';

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
  private sessionManager: InteractiveSessionManager;
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
    this.sessionManager = new InteractiveSessionManager(
      config.sessions,
      (command) => assertCommandAllowed(this.securityManager, command, this.auditLogger, {
        source: 'interactive-session',
      })
    );
  }

  async executeCommand(options: ExecuteCommandOptions): Promise<CommandOutput> {
    const commandId = uuidv4();
    const startTime = Date.now();

    // Debug logging through audit logger to avoid JSON-RPC interference
    await this.auditLogger.log({
      level: 'debug',
      message: 'ShellExecutor.executeCommand called',
      context: { command: options.command }
    });

    // Log command execution at info level
    await this.auditLogger.info('Executing shell command', {
      commandId,
      command: options.command,
      args: options.args,
      cwd: options.cwd
    }, 'shell-executor');

    try {
      // Security validation
      const fullCommand = this.buildFullCommand(options);
      await this.auditLogger.debug('Validating command security', {
        commandId,
        fullCommand
      }, 'security-validator');

      const securityCheck = await this.securityManager.validateCommand(fullCommand);

      if (!securityCheck.allowed) {
        await this.auditLogger.warning('Command blocked by security policy', {
          commandId,
          fullCommand,
          reason: securityCheck.reason,
          riskLevel: securityCheck.riskLevel
        }, 'security-validator');
        throw new Error(`Command blocked by security policy: ${securityCheck.reason}`);
      }

      await this.auditLogger.debug('Command passed security validation', {
        commandId,
        riskLevel: securityCheck.riskLevel
      }, 'security-validator');

      // Analyze command intent
      const intent = this.intentTracker.analyzeIntent(fullCommand, options.aiContext);

      // Get current context
      const context = await this.contextManager.getCurrentContext();
      
      // Determine working directory
      const workingDirectory = options.cwd || context.currentDirectory || process.cwd();
      
      // Merge environment variables
      const environment = {
        ...context.environmentVariables,
        ...options.env,
      };

      // Execute command
      await this.auditLogger.debug('Starting command execution', {
        commandId,
        workingDirectory,
        timeout: options.timeout || this.config.security.timeout
      }, 'command-executor');

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

      await this.auditLogger.info('Command executed successfully', {
        commandId,
        exitCode: result.exitCode,
        executionTime: Date.now() - startTime
      }, 'command-executor');

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
        // Per-command overrides are reported separately so they are not mistaken for
        // persistent session state.
        envOverrides: options.env,
        resultingEnvironment: result.environment,
        resultingWorkingDirectory: result.workingDirectory,
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
      await this.auditLogger.error('Command execution failed', {
        commandId,
        command: this.buildFullCommand(options),
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      }, 'command-executor');

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
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    environment?: Record<string, string>;
    workingDirectory?: string;
  }> {
    return new Promise((resolve, reject) => {
      const { timeout, ...spawnOptions } = options;
      const stateMarker = `__MCP_EXEC_STATE_${uuidv4().replace(/-/g, '')}`;
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
      const captureShellState = this.supportsShellStateCapture(spawnOptions.shell);
      const wrappedCommand = captureShellState
        ? process.platform === 'win32'
          ? this.wrapWindowsCommand(fullCommand, stateMarker)
          : this.wrapPosixCommand(fullCommand, stateMarker)
        : fullCommand;
      const childEnvironment = { ...spawnOptions.env };
      if (captureShellState && process.platform !== 'win32' && childEnvironment.OLDPWD !== undefined) {
        // Some /bin/sh implementations discard inherited OLDPWD during startup.
        // Carry it under an internal name, restore it before the user command, and
        // immediately remove the internal names from the command's environment.
        childEnvironment.__MCP_EXEC_OLDPWD_PRESENT = '1';
        childEnvironment.__MCP_EXEC_OLDPWD_VALUE = childEnvironment.OLDPWD;
      }

      // Determine execution method based on shell option
      let execCommand: string;
      let execArgs: string[];

      if (spawnOptions.shell) {
        // When shell=true, let Node.js handle the shell execution
        execCommand = captureShellState ? wrappedCommand : command;
        execArgs = captureShellState ? [] : args;
      } else {
        // When shell=false, manually construct shell command
        if (process.platform === 'win32') {
          execCommand = 'cmd.exe';
          execArgs = ['/d', '/s', '/c', wrappedCommand];
        } else {
          execCommand = '/bin/sh';
          execArgs = ['-c', wrappedCommand];
        }
      }

      const child = spawn(execCommand, execArgs, {
        ...spawnOptions,
        env: childEnvironment,
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

        const shellState = !captureShellState
          ? { stderr }
          : process.platform === 'win32'
            ? this.extractWindowsShellState(stderr, stateMarker)
            : this.extractPosixShellState(stderr, stateMarker);

        resolve({
          stdout,
          stderr: shellState.stderr,
          exitCode: code || 0,
          environment: shellState.environment,
          workingDirectory: shellState.workingDirectory,
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

  private supportsShellStateCapture(shell: boolean | string | undefined): boolean {
    if (typeof shell !== 'string') {
      return true;
    }
    const shellName = path.basename(shell).toLowerCase().replace(/\.exe$/, '');
    return process.platform === 'win32'
      ? shellName === 'cmd'
      : ['sh', 'bash', 'dash', 'zsh', 'ksh'].includes(shellName);
  }

  private wrapPosixCommand(command: string, marker: string): string {
    return 'if [ "${__MCP_EXEC_OLDPWD_PRESENT-}" = 1 ]; then ' +
      'OLDPWD=$__MCP_EXEC_OLDPWD_VALUE; export OLDPWD; fi\n' +
      'unset __MCP_EXEC_OLDPWD_PRESENT __MCP_EXEC_OLDPWD_VALUE\n' +
      `${command}\n` +
      '__mcp_exec_status=$?\n' +
      `printf '\\000%s\\000%s\\000' '${marker}' "$PWD" >&2\n` +
      'command -p env -0 >&2\n' +
      `printf '\\000%s\\000' '${marker}_END' >&2\n` +
      'exit "$__mcp_exec_status"';
  }

  private extractPosixShellState(
    stderr: string,
    marker: string
  ): { stderr: string; environment?: Record<string, string>; workingDirectory?: string } {
    const startMarker = `\0${marker}\0`;
    const endMarker = `\0${marker}_END\0`;
    const start = stderr.lastIndexOf(startMarker);
    if (start < 0) {
      return { stderr };
    }
    const end = stderr.indexOf(endMarker, start + startMarker.length);
    if (end < 0) {
      return { stderr };
    }

    const state = stderr.slice(start + startMarker.length, end).split('\0');
    const workingDirectory = state.shift();
    const environment: Record<string, string> = {};
    for (const entry of state) {
      const separator = entry.indexOf('=');
      if (separator > 0) {
        environment[entry.slice(0, separator)] = entry.slice(separator + 1);
      }
    }

    return {
      stderr: stderr.slice(0, start) + stderr.slice(end + endMarker.length),
      environment,
      workingDirectory,
    };
  }

  private wrapWindowsCommand(command: string, marker: string): string {
    return `${command}\r\n` +
      'set "__mcp_exec_status=%ERRORLEVEL%"\r\n' +
      `>&2 echo ${marker}\r\n` +
      '>&2 cd\r\n' +
      '>&2 set\r\n' +
      `>&2 echo ${marker}_END\r\n` +
      'exit /b %__mcp_exec_status%';
  }

  private extractWindowsShellState(
    stderr: string,
    marker: string
  ): { stderr: string; environment?: Record<string, string>; workingDirectory?: string } {
    const crlfMarker = `${marker}\r\n`;
    const lfMarker = `${marker}\n`;
    const crlfStart = stderr.lastIndexOf(crlfMarker);
    const lfStart = stderr.lastIndexOf(lfMarker);
    const start = Math.max(crlfStart, lfStart);
    if (start < 0) {
      return { stderr };
    }
    const payloadStart = start + (start === crlfStart ? crlfMarker.length : lfMarker.length);
    const end = stderr.indexOf(`${marker}_END`, payloadStart);
    if (end < 0) {
      return { stderr };
    }

    const lines = stderr.slice(payloadStart, end).split(/\r?\n/);
    const workingDirectory = lines.shift()?.trim();
    const environment: Record<string, string> = {};
    for (const line of lines) {
      const separator = line.indexOf('=');
      if (separator > 0) {
        const name = line.slice(0, separator);
        if (name.toLowerCase() !== '__mcp_exec_status') {
          environment[name] = line.slice(separator + 1);
        }
      }
    }

    const afterEnd = end + `${marker}_END`.length;
    const trailingNewline = stderr.slice(afterEnd).match(/^\r?\n/)?.[0].length || 0;
    return {
      stderr: stderr.slice(0, start) + stderr.slice(afterEnd + trailingNewline),
      environment,
      workingDirectory,
    };
  }

  // Session management API
  async listSessions() {
    return this.sessionManager.listSessions();
  }

  async killSession(sessionId: string): Promise<void> {
    await this.sessionManager.killSession(sessionId);
  }

  // Public method to start a new interactive session
  async startInteractiveSession(options: StartSessionOptions): Promise<string> {
    await assertCommandAllowed(
      this.securityManager,
      this.buildFullCommand(options),
      this.auditLogger,
      { source: 'start_interactive_session' }
    );
    return await this.sessionManager.startSession(options);
  }

  // Public method to send input to a session
  async sendInputToSession(options: SendInputOptions): Promise<void> {
    return await this.sessionManager.sendInput(options);
  }

  async readSessionOutput(sessionId: string): Promise<SessionOutput> {
    return await this.sessionManager.readOutput(sessionId);
  }

  async shutdown(): Promise<void> {
    await this.sessionManager.shutdown();
  }
}
