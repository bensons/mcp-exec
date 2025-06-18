/**
 * Output processor for AI-friendly command output formatting
 */

import { CommandOutput } from '../types/index';

export interface OutputConfig {
  formatStructured: boolean;
  stripAnsi: boolean;
  summarizeVerbose: boolean;
  enableAiOptimizations: boolean;
  maxOutputLength: number;
}

export class OutputProcessor {
  private config: OutputConfig;

  constructor(config: OutputConfig) {
    this.config = config;
  }

  async process(rawOutput: { stdout: string; stderr: string; exitCode: number }, command?: string): Promise<CommandOutput> {
    let { stdout, stderr, exitCode } = rawOutput;

    // Strip ANSI codes if configured
    if (this.config.stripAnsi) {
      stdout = this.stripAnsiCodes(stdout);
      stderr = this.stripAnsiCodes(stderr);
    }

    // Apply AI optimizations if enabled
    if (this.config.enableAiOptimizations) {
      stdout = this.optimizeForAI(stdout, command);
      stderr = this.optimizeForAI(stderr, command);
    }

    // Truncate output if too long
    if (this.config.maxOutputLength > 0) {
      stdout = this.truncateOutput(stdout, this.config.maxOutputLength);
      stderr = this.truncateOutput(stderr, this.config.maxOutputLength / 2);
    }

    // Detect and parse structured output
    const structuredOutput = this.config.formatStructured
      ? this.detectStructuredOutput(stdout)
      : undefined;

    // Generate metadata
    const metadata = this.generateMetadata(stdout, stderr, exitCode, command);

    // Generate AI-friendly summary
    const summary = this.generateSummary(stdout, stderr, exitCode, metadata);

    return {
      stdout,
      stderr,
      exitCode,
      structuredOutput,
      metadata,
      summary,
    };
  }

  private stripAnsiCodes(text: string): string {
    // Remove ANSI escape sequences
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  private optimizeForAI(text: string, command?: string): string {
    if (!text.trim()) return text;

    // Remove excessive whitespace
    let optimized = text.replace(/\n{3,}/g, '\n\n');

    // Remove progress indicators and spinner characters
    optimized = optimized.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '');
    optimized = optimized.replace(/\r[^\n]*\r/g, '');

    // Clean up common noise patterns
    optimized = optimized.replace(/^\s*[\.\-=]{3,}\s*$/gm, '');
    optimized = optimized.replace(/^\s*[#*]{3,}\s*$/gm, '');

    // Enhance readability for specific command types
    if (command) {
      optimized = this.enhanceCommandSpecificOutput(optimized, command);
    }

    return optimized.trim();
  }

  private enhanceCommandSpecificOutput(text: string, command: string): string {
    const cmd = command.toLowerCase().split(' ')[0];

    switch (cmd) {
      case 'ls':
      case 'dir':
        return this.enhanceDirectoryListing(text);
      case 'ps':
        return this.enhanceProcessListing(text);
      case 'git':
        return this.enhanceGitOutput(text);
      case 'npm':
      case 'yarn':
        return this.enhancePackageManagerOutput(text);
      default:
        return text;
    }
  }

  private enhanceDirectoryListing(text: string): string {
    // Add structure to directory listings
    const lines = text.split('\n');
    const enhanced = lines.map(line => {
      if (line.match(/^d/)) {
        return `📁 ${line}`;
      } else if (line.match(/^-.*x/)) {
        return `🔧 ${line}`;
      } else if (line.match(/^-/)) {
        return `📄 ${line}`;
      }
      return line;
    });
    return enhanced.join('\n');
  }

  private enhanceProcessListing(text: string): string {
    // Highlight important process information
    return text.replace(/(\d+)\s+(\S+)\s+(.+)/g, 'PID:$1 USER:$2 CMD:$3');
  }

  private enhanceGitOutput(text: string): string {
    // Enhance git output readability
    let enhanced = text;
    enhanced = enhanced.replace(/^(\s*modified:)/gm, '🔄 $1');
    enhanced = enhanced.replace(/^(\s*new file:)/gm, '✅ $1');
    enhanced = enhanced.replace(/^(\s*deleted:)/gm, '❌ $1');
    return enhanced;
  }

  private enhancePackageManagerOutput(text: string): string {
    // Clean up package manager noise
    let enhanced = text;
    enhanced = enhanced.replace(/^npm WARN.*$/gm, '');
    enhanced = enhanced.replace(/^added \d+ packages.*$/gm, '✅ Packages installed successfully');
    return enhanced.replace(/\n{2,}/g, '\n');
  }

  private truncateOutput(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;

    const truncated = text.substring(0, maxLength - 100);
    const lastNewline = truncated.lastIndexOf('\n');

    if (lastNewline > maxLength * 0.8) {
      return truncated.substring(0, lastNewline) +
        `\n\n... [Output truncated - ${text.length - lastNewline} more characters]`;
    }

    return truncated + `\n\n... [Output truncated - ${text.length - maxLength + 100} more characters]`;
  }

  private detectStructuredOutput(stdout: string): CommandOutput['structuredOutput'] {
    const trimmed = stdout.trim();
    
    if (!trimmed) {
      return undefined;
    }

    // Try to parse as JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const data = JSON.parse(trimmed);
        return {
          format: 'json',
          data,
          schema: this.inferJsonSchema(data),
        };
      } catch {
        // Not valid JSON
      }
    }

    // Try to detect YAML
    if (trimmed.includes(':\n') || trimmed.includes(': ')) {
      try {
        // Simple YAML detection - in production, use a proper YAML parser
        const lines = trimmed.split('\n');
        const yamlLike = lines.every(line => 
          line.trim() === '' || 
          line.includes(':') || 
          line.startsWith(' ') || 
          line.startsWith('-')
        );
        
        if (yamlLike) {
          return {
            format: 'yaml',
            data: trimmed,
          };
        }
      } catch {
        // Not valid YAML
      }
    }

    // Try to detect CSV
    if (trimmed.includes(',') && trimmed.split('\n').length > 1) {
      const lines = trimmed.split('\n').filter(line => line.trim());
      const firstLine = lines[0];
      const commaCount = (firstLine.match(/,/g) || []).length;
      
      if (commaCount > 0 && lines.every(line => 
        (line.match(/,/g) || []).length === commaCount
      )) {
        return {
          format: 'csv',
          data: this.parseCsv(trimmed),
        };
      }
    }

    // Try to detect table format
    if (this.isTableFormat(trimmed)) {
      return {
        format: 'table',
        data: this.parseTable(trimmed),
      };
    }

    return undefined;
  }

  private inferJsonSchema(data: any): object {
    if (Array.isArray(data)) {
      return {
        type: 'array',
        items: data.length > 0 ? this.inferJsonSchema(data[0]) : { type: 'unknown' },
      };
    }

    if (typeof data === 'object' && data !== null) {
      const properties: Record<string, any> = {};
      Object.keys(data).forEach(key => {
        properties[key] = this.inferJsonSchema(data[key]);
      });
      
      return {
        type: 'object',
        properties,
      };
    }

    return { type: typeof data };
  }

  private parseCsv(csvText: string): any[] {
    const lines = csvText.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim());
    
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row;
    });
  }

  private isTableFormat(text: string): boolean {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return false;

    // Look for table separators like |, +, or consistent spacing
    const hasTableSeparators = lines.some(line => 
      line.includes('|') || 
      line.includes('+') || 
      /^\s*-+\s*$/.test(line)
    );

    return hasTableSeparators;
  }

  private parseTable(text: string): any[] {
    const lines = text.split('\n').filter(line => line.trim());
    
    // Simple table parsing - look for | separators
    if (lines[0].includes('|')) {
      const headers = lines[0].split('|').map(h => h.trim()).filter(h => h);
      const dataLines = lines.slice(1).filter(line => 
        line.includes('|') && !line.match(/^\s*[|+-\s]*$/)
      );
      
      return dataLines.map(line => {
        const values = line.split('|').map(v => v.trim()).filter(v => v);
        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });
        return row;
      });
    }

    return [];
  }

  private generateMetadata(stdout: string, stderr: string, exitCode: number, command?: string): CommandOutput['metadata'] {
    const warnings: string[] = [];
    const suggestions: string[] = [];
    const affectedResources: string[] = [];

    // Analyze stderr for warnings and errors
    if (stderr) {
      const stderrLower = stderr.toLowerCase();

      // Common warning patterns
      if (stderrLower.includes('warning')) {
        warnings.push('Command produced warnings');
      }
      if (stderrLower.includes('deprecated')) {
        warnings.push('Command uses deprecated features');
        suggestions.push('Consider using updated alternatives');
      }

      // Permission issues
      if (stderrLower.includes('permission denied') || stderrLower.includes('access denied')) {
        suggestions.push('Check file permissions or run with appropriate privileges');
      }

      // File/command not found
      if (stderrLower.includes('not found') || stderrLower.includes('no such file')) {
        suggestions.push('Verify the command or file path exists');
      }

      // Network issues
      if (stderrLower.includes('connection refused') || stderrLower.includes('timeout')) {
        suggestions.push('Check network connectivity and firewall settings');
      }

      // Disk space issues
      if (stderrLower.includes('no space left') || stderrLower.includes('disk full')) {
        suggestions.push('Free up disk space before retrying');
      }
    }

    // Enhanced resource detection
    this.detectAffectedResources(stdout, stderr, affectedResources);

    // Determine command type with better classification
    const commandType = this.classifyCommandType(stdout, stderr, command);

    // Add command-specific suggestions
    if (command) {
      suggestions.push(...this.generateCommandSpecificSuggestions(command, exitCode, stderr));
    }

    return {
      executionTime: 0, // Will be set by the executor
      commandType,
      affectedResources: [...new Set(affectedResources)], // Remove duplicates
      warnings,
      suggestions,
    };
  }

  private detectAffectedResources(stdout: string, stderr: string, affectedResources: string[]): void {
    const combinedOutput = stdout + '\n' + stderr;

    // File paths
    const pathPattern = /(?:^|\s)([\/\\]?[\w\-\.\/\\]+\.[a-zA-Z0-9]+)(?:\s|$)/g;
    let match;
    while ((match = pathPattern.exec(combinedOutput)) !== null) {
      affectedResources.push(match[1]);
    }

    // URLs
    const urlPattern = /https?:\/\/[^\s]+/g;
    while ((match = urlPattern.exec(combinedOutput)) !== null) {
      affectedResources.push(match[0]);
    }

    // Package names
    const packagePattern = /(?:installing|updating|removing)\s+([a-zA-Z0-9\-_]+)/gi;
    while ((match = packagePattern.exec(combinedOutput)) !== null) {
      affectedResources.push(`package:${match[1]}`);
    }
  }

  private classifyCommandType(stdout: string, stderr: string, command?: string): string {
    if (command) {
      const cmd = command.toLowerCase().split(' ')[0];

      // Direct command classification
      const commandTypes: Record<string, string> = {
        'ls': 'file-operation',
        'dir': 'file-operation',
        'cp': 'file-operation',
        'mv': 'file-operation',
        'rm': 'file-operation',
        'mkdir': 'file-operation',
        'touch': 'file-operation',
        'ps': 'process-management',
        'kill': 'process-management',
        'top': 'process-management',
        'htop': 'process-management',
        'git': 'version-control',
        'npm': 'package-management',
        'yarn': 'package-management',
        'pip': 'package-management',
        'curl': 'network-operation',
        'wget': 'network-operation',
        'ssh': 'network-operation',
        'ping': 'network-operation',
        'docker': 'container-management',
        'kubectl': 'container-management',
      };

      if (commandTypes[cmd]) {
        return commandTypes[cmd];
      }
    }

    // Fallback to content-based classification
    const combinedOutput = (stdout + '\n' + stderr).toLowerCase();

    if (combinedOutput.includes('file') || combinedOutput.includes('directory')) {
      return 'file-operation';
    } else if (combinedOutput.includes('process') || combinedOutput.includes('pid')) {
      return 'process-management';
    } else if (combinedOutput.includes('network') || combinedOutput.includes('connection')) {
      return 'network-operation';
    } else if (combinedOutput.includes('package') || combinedOutput.includes('install')) {
      return 'package-management';
    } else if (combinedOutput.includes('commit') || combinedOutput.includes('branch')) {
      return 'version-control';
    }

    return 'general';
  }

  private generateCommandSpecificSuggestions(command: string, exitCode: number, stderr: string): string[] {
    const suggestions: string[] = [];
    const cmd = command.toLowerCase().split(' ')[0];

    if (exitCode !== 0) {
      switch (cmd) {
        case 'git':
          if (stderr.includes('not a git repository')) {
            suggestions.push('Initialize a git repository with "git init" first');
          } else if (stderr.includes('nothing to commit')) {
            suggestions.push('Add files to staging area with "git add" before committing');
          }
          break;

        case 'npm':
        case 'yarn':
          if (stderr.includes('ENOENT')) {
            suggestions.push('Run "npm install" to install dependencies first');
          } else if (stderr.includes('permission')) {
            suggestions.push('Try using sudo or check npm permissions');
          }
          break;

        case 'docker':
          if (stderr.includes('permission denied')) {
            suggestions.push('Add user to docker group or use sudo');
          } else if (stderr.includes('not found')) {
            suggestions.push('Ensure Docker is installed and running');
          }
          break;
      }
    }

    return suggestions;
  }

  private generateSummary(
    stdout: string, 
    stderr: string, 
    exitCode: number, 
    metadata: CommandOutput['metadata']
  ): CommandOutput['summary'] {
    const success = exitCode === 0;
    const hasOutput = stdout.trim().length > 0;
    const hasErrors = stderr.trim().length > 0;

    let mainResult: string;
    if (!success) {
      mainResult = `Command failed with exit code ${exitCode}`;
      if (hasErrors) {
        const firstErrorLine = stderr.split('\n')[0].trim();
        mainResult += `: ${firstErrorLine}`;
      }
    } else if (hasOutput) {
      if (this.config.summarizeVerbose && stdout.length > 500) {
        const lines = stdout.split('\n').filter(line => line.trim());
        if (lines.length > 10) {
          mainResult = `Command completed successfully. Output contains ${lines.length} lines.`;
        } else {
          mainResult = `Command completed successfully: ${lines[0]}`;
        }
      } else {
        const firstLine = stdout.split('\n')[0].trim();
        mainResult = firstLine || 'Command completed successfully';
      }
    } else {
      mainResult = 'Command completed successfully with no output';
    }

    const sideEffects: string[] = [];
    if (metadata.affectedResources.length > 0) {
      sideEffects.push(`Modified ${metadata.affectedResources.length} resource(s)`);
    }
    if (metadata.warnings.length > 0) {
      sideEffects.push(`Generated ${metadata.warnings.length} warning(s)`);
    }

    const nextSteps: string[] = [];
    if (!success) {
      nextSteps.push('Review error message and correct the command');
    }
    if (metadata.suggestions.length > 0) {
      nextSteps.push(...metadata.suggestions);
    }

    return {
      success,
      mainResult,
      sideEffects,
      nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
    };
  }
}
