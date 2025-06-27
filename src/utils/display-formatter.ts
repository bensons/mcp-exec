/**
 * Display formatter for enhanced client output formatting
 * Optimized for Claude Desktop and other MCP clients
 */

import { CommandOutput } from '../types/index';

export interface DisplayConfig {
  showCommandHeader: boolean;
  showExecutionTime: boolean;
  showExitCode: boolean;
  formatCodeBlocks: boolean;
  includeMetadata: boolean;
  includeSuggestions: boolean;
  useMarkdown: boolean;
  colorizeOutput: boolean;
}

export class DisplayFormatter {
  private config: DisplayConfig;

  constructor(config: Partial<DisplayConfig> = {}) {
    this.config = {
      showCommandHeader: true,
      showExecutionTime: true,
      showExitCode: true,
      formatCodeBlocks: true,
      includeMetadata: true,
      includeSuggestions: true,
      useMarkdown: true,
      colorizeOutput: false, // Disabled by default for compatibility
      ...config,
    };
  }

  /**
   * Format command output for display in client applications
   */
  formatCommandOutput(
    command: string,
    output: CommandOutput,
    options: { showInput?: boolean; aiContext?: string } = {}
  ): string {
    const sections: string[] = [];

    // Command header section
    if (this.config.showCommandHeader) {
      sections.push(this.formatCommandHeader(command, output, options.aiContext));
    }

    // Input section (if requested)
    if (options.showInput) {
      sections.push(this.formatInputSection(command, options.aiContext));
    }

    // Output sections
    if (output.stdout || output.stderr) {
      sections.push(this.formatOutputSection(output));
    }

    // Summary section
    sections.push(this.formatSummarySection(output));

    // Metadata section (if enabled)
    if (this.config.includeMetadata && this.shouldShowMetadata(output)) {
      sections.push(this.formatMetadataSection(output));
    }

    // Suggestions section (if enabled and available)
    if (this.config.includeSuggestions && this.hasSuggestions(output)) {
      sections.push(this.formatSuggestionsSection(output));
    }

    return sections.join('\n\n');
  }

  private formatCommandHeader(command: string, output: CommandOutput, aiContext?: string): string {
    const lines: string[] = [];
    
    if (this.config.useMarkdown) {
      lines.push('## Command Execution');
    } else {
      lines.push('=== Command Execution ===');
    }

    // Command line
    const commandDisplay = this.config.formatCodeBlocks && this.config.useMarkdown
      ? `\`${command}\``
      : command;
    
    lines.push(`**Command:** ${commandDisplay}`);

    // AI context if provided
    if (aiContext) {
      lines.push(`**Context:** ${aiContext}`);
    }

    // Execution details
    const details: string[] = [];
    
    if (this.config.showExecutionTime) {
      details.push(`⏱️ ${output.metadata.executionTime}ms`);
    }
    
    if (this.config.showExitCode) {
      const exitIcon = output.exitCode === 0 ? '✅' : '❌';
      details.push(`${exitIcon} Exit code: ${output.exitCode}`);
    }

    if (output.metadata.commandType) {
      details.push(`📂 Type: ${output.metadata.commandType}`);
    }

    if (details.length > 0) {
      lines.push(`**Details:** ${details.join(' | ')}`);
    }

    return lines.join('\n');
  }

  private formatInputSection(command: string, aiContext?: string): string {
    const lines: string[] = [];
    
    if (this.config.useMarkdown) {
      lines.push('### Input');
      lines.push('```bash');
      lines.push(command);
      lines.push('```');
    } else {
      lines.push('--- Input ---');
      lines.push(command);
    }

    if (aiContext) {
      lines.push('');
      lines.push(`*AI Context: ${aiContext}*`);
    }

    return lines.join('\n');
  }

  private formatOutputSection(output: CommandOutput): string {
    const sections: string[] = [];

    // Standard output
    if (output.stdout && output.stdout.trim()) {
      sections.push(this.formatStreamOutput('Output', output.stdout, 'stdout'));
    }

    // Error output
    if (output.stderr && output.stderr.trim()) {
      sections.push(this.formatStreamOutput('Error Output', output.stderr, 'stderr'));
    }

    // Structured output
    if (output.structuredOutput) {
      sections.push(this.formatStructuredOutput(output.structuredOutput));
    }

    return sections.join('\n\n');
  }

  private formatStreamOutput(title: string, content: string, streamType: 'stdout' | 'stderr'): string {
    const lines: string[] = [];
    
    if (this.config.useMarkdown) {
      const icon = streamType === 'stderr' ? '⚠️' : '📄';
      lines.push(`### ${icon} ${title}`);
      
      if (this.config.formatCodeBlocks) {
        // Detect if content looks like code or structured data
        const language = this.detectLanguage(content);
        lines.push(`\`\`\`${language}`);
        lines.push(content.trim());
        lines.push('```');
      } else {
        lines.push(content.trim());
      }
    } else {
      lines.push(`--- ${title} ---`);
      lines.push(content.trim());
    }

    return lines.join('\n');
  }

  private formatStructuredOutput(structured: CommandOutput['structuredOutput']): string {
    if (!structured) return '';

    const lines: string[] = [];
    
    if (this.config.useMarkdown) {
      lines.push(`### 📊 Structured Data (${structured.format.toUpperCase()})`);
      
      if (structured.format === 'json') {
        lines.push('```json');
        lines.push(JSON.stringify(structured.data, null, 2));
        lines.push('```');
      } else if (structured.format === 'table') {
        lines.push(this.formatTableData(structured.data));
      } else {
        lines.push('```');
        lines.push(JSON.stringify(structured.data, null, 2));
        lines.push('```');
      }
    } else {
      lines.push(`--- Structured Data (${structured.format}) ---`);
      lines.push(JSON.stringify(structured.data, null, 2));
    }

    return lines.join('\n');
  }

  private formatSummarySection(output: CommandOutput): string {
    const lines: string[] = [];
    
    if (this.config.useMarkdown) {
      lines.push('### 📋 Summary');
    } else {
      lines.push('--- Summary ---');
    }

    const icon = output.summary.success ? '✅' : '❌';
    lines.push(`${icon} **Result:** ${output.summary.mainResult}`);

    if (output.summary.sideEffects && output.summary.sideEffects.length > 0) {
      lines.push(`🔄 **Side Effects:** ${output.summary.sideEffects.join(', ')}`);
    }

    return lines.join('\n');
  }

  private formatMetadataSection(output: CommandOutput): string {
    const lines: string[] = [];
    
    if (this.config.useMarkdown) {
      lines.push('### 🔍 Details');
    } else {
      lines.push('--- Details ---');
    }

    const metadata = output.metadata;

    if (metadata.affectedResources.length > 0) {
      lines.push(`📁 **Affected Resources:** ${metadata.affectedResources.join(', ')}`);
    }

    if (metadata.warnings.length > 0) {
      lines.push(`⚠️ **Warnings:** ${metadata.warnings.join(', ')}`);
    }

    if (metadata.commandIntent) {
      const intent = metadata.commandIntent;
      lines.push(`🎯 **Intent:** ${intent.purpose} (${intent.category}, ${Math.round(intent.confidence * 100)}% confidence)`);
    }

    return lines.join('\n');
  }

  private formatSuggestionsSection(output: CommandOutput): string {
    const lines: string[] = [];
    
    if (this.config.useMarkdown) {
      lines.push('### 💡 Suggestions');
    } else {
      lines.push('--- Suggestions ---');
    }

    // Next steps
    if (output.summary.nextSteps && output.summary.nextSteps.length > 0) {
      lines.push('**Next Steps:**');
      output.summary.nextSteps.forEach(step => {
        lines.push(`• ${step}`);
      });
    }

    // General suggestions
    if (output.metadata.suggestions.length > 0) {
      if (output.summary.nextSteps && output.summary.nextSteps.length > 0) {
        lines.push('');
      }
      lines.push('**Additional Suggestions:**');
      output.metadata.suggestions.forEach(suggestion => {
        lines.push(`• ${suggestion}`);
      });
    }

    // Related commands from intent
    if (output.metadata.commandIntent?.relatedCommands.length) {
      lines.push('');
      lines.push('**Related Commands:**');
      output.metadata.commandIntent.relatedCommands.forEach(cmd => {
        lines.push(`• \`${cmd}\``);
      });
    }

    return lines.join('\n');
  }

  private formatTableData(data: any): string {
    if (!Array.isArray(data) || data.length === 0) {
      return 'No table data available';
    }

    // Simple markdown table formatting
    const headers = Object.keys(data[0]);
    const lines: string[] = [];
    
    // Header row
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    
    // Data rows
    data.forEach(row => {
      const values = headers.map(header => String(row[header] || ''));
      lines.push(`| ${values.join(' | ')} |`);
    });

    return lines.join('\n');
  }

  private detectLanguage(content: string): string {
    const trimmed = content.trim();
    
    // JSON detection
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {}
    }

    // XML/HTML detection
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
      return 'xml';
    }

    // YAML detection
    if (trimmed.includes(':\n') || trimmed.includes(': ')) {
      return 'yaml';
    }

    // Shell script detection
    if (trimmed.includes('#!/') || trimmed.includes('export ') || trimmed.includes('echo ')) {
      return 'bash';
    }

    return 'text';
  }

  private shouldShowMetadata(output: CommandOutput): boolean {
    const metadata = output.metadata;
    return metadata.affectedResources.length > 0 ||
           metadata.warnings.length > 0 ||
           !!metadata.commandIntent;
  }

  private hasSuggestions(output: CommandOutput): boolean {
    return (output.summary.nextSteps && output.summary.nextSteps.length > 0) ||
           output.metadata.suggestions.length > 0 ||
           (output.metadata.commandIntent?.relatedCommands.length || 0) > 0;
  }

  /**
   * Format a simple status message
   */
  formatStatusMessage(title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): string {
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    if (this.config.useMarkdown) {
      return `### ${icons[type]} ${title}\n\n${message}`;
    } else {
      return `${icons[type]} ${title}: ${message}`;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<DisplayConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}
