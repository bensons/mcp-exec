/**
 * Output processor for AI-friendly command output formatting
 */

import { CommandOutput } from '../types/index';

export interface OutputConfig {
  formatStructured: boolean;
  stripAnsi: boolean;
  summarizeVerbose: boolean;
}

export class OutputProcessor {
  private config: OutputConfig;

  constructor(config: OutputConfig) {
    this.config = config;
  }

  async process(rawOutput: { stdout: string; stderr: string; exitCode: number }): Promise<CommandOutput> {
    let { stdout, stderr, exitCode } = rawOutput;

    // Strip ANSI codes if configured
    if (this.config.stripAnsi) {
      stdout = this.stripAnsiCodes(stdout);
      stderr = this.stripAnsiCodes(stderr);
    }

    // Detect and parse structured output
    const structuredOutput = this.config.formatStructured 
      ? this.detectStructuredOutput(stdout)
      : undefined;

    // Generate metadata
    const metadata = this.generateMetadata(stdout, stderr, exitCode);

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

  private generateMetadata(stdout: string, stderr: string, exitCode: number): CommandOutput['metadata'] {
    const warnings: string[] = [];
    const suggestions: string[] = [];
    const affectedResources: string[] = [];

    // Analyze stderr for warnings
    if (stderr) {
      const stderrLower = stderr.toLowerCase();
      if (stderrLower.includes('warning')) {
        warnings.push('Command produced warnings');
      }
      if (stderrLower.includes('deprecated')) {
        warnings.push('Command uses deprecated features');
        suggestions.push('Consider using updated alternatives');
      }
      if (stderrLower.includes('permission denied')) {
        suggestions.push('Check file permissions or run with appropriate privileges');
      }
      if (stderrLower.includes('not found')) {
        suggestions.push('Verify the command or file path exists');
      }
    }

    // Detect affected resources from output
    const pathPattern = /(?:^|\s)([\/\\]?[\w\-\.\/\\]+\.[a-zA-Z0-9]+)(?:\s|$)/g;
    let match;
    while ((match = pathPattern.exec(stdout)) !== null) {
      affectedResources.push(match[1]);
    }

    // Determine command type
    let commandType = 'general';
    const stdoutLower = stdout.toLowerCase();
    
    if (stdoutLower.includes('file') || stdoutLower.includes('directory')) {
      commandType = 'file-operation';
    } else if (stdoutLower.includes('process') || stdoutLower.includes('pid')) {
      commandType = 'process-management';
    } else if (stdoutLower.includes('network') || stdoutLower.includes('connection')) {
      commandType = 'network-operation';
    } else if (stdoutLower.includes('package') || stdoutLower.includes('install')) {
      commandType = 'package-management';
    }

    return {
      executionTime: 0, // Will be set by the executor
      commandType,
      affectedResources: [...new Set(affectedResources)], // Remove duplicates
      warnings,
      suggestions,
    };
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
