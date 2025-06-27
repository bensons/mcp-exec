"use strict";
/**
 * Core shell command executor with cross-platform support
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellExecutor = void 0;
const child_process_1 = require("child_process");
const uuid_1 = require("uuid");
const output_processor_1 = require("../utils/output-processor");
const intent_tracker_1 = require("../utils/intent-tracker");
class ShellExecutor {
    securityManager;
    contextManager;
    auditLogger;
    outputProcessor;
    intentTracker;
    config;
    constructor(securityManager, contextManager, auditLogger, config) {
        this.securityManager = securityManager;
        this.contextManager = contextManager;
        this.auditLogger = auditLogger;
        this.config = config;
        this.outputProcessor = new output_processor_1.OutputProcessor(config.output);
        this.intentTracker = new intent_tracker_1.IntentTracker();
    }
    async executeCommand(options) {
        const commandId = (0, uuid_1.v4)();
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
            const result = await this.executeWithTimeout(options.command, options.args || [], {
                cwd: workingDirectory,
                env: environment,
                shell: options.shell !== undefined ? options.shell : true,
                timeout: options.timeout || this.config.security.timeout,
            });
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
                environment: environment,
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
                    environment: environment,
                    aiIntent: options.aiContext,
                },
                result: processedOutput,
                securityCheck,
                executionTime: Date.now() - startTime,
            });
            return processedOutput;
        }
        catch (error) {
            const errorOutput = {
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
    suggestNextCommands(command) {
        return this.intentTracker.suggestNextCommands(command);
    }
    getRecentIntents(limit) {
        return this.intentTracker.getRecentIntents(limit);
    }
    buildFullCommand(options) {
        if (options.args && options.args.length > 0) {
            return `${options.command} ${options.args.join(' ')}`;
        }
        return options.command;
    }
    async executeWithTimeout(command, args, options) {
        return new Promise((resolve, reject) => {
            const { timeout, ...spawnOptions } = options;
            // Determine execution method based on shell option
            let execCommand;
            let execArgs;
            if (spawnOptions.shell) {
                // When shell=true, let Node.js handle the shell execution
                execCommand = command;
                execArgs = args;
            }
            else {
                // When shell=false, manually construct shell command
                if (process.platform === 'win32') {
                    execCommand = 'cmd.exe';
                    execArgs = ['/c', command, ...args];
                }
                else {
                    execCommand = '/bin/sh';
                    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
                    execArgs = ['-c', fullCommand];
                }
            }
            const child = (0, child_process_1.spawn)(execCommand, execArgs, {
                ...spawnOptions,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            let timeoutId;
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
exports.ShellExecutor = ShellExecutor;
//# sourceMappingURL=executor.js.map