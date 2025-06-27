#!/usr/bin/env node

/**
 * Demonstration script showing enhanced output formatting for Claude Desktop
 */

const { spawn } = require('child_process');
const path = require('path');

class EnhancedOutputDemo {
  constructor() {
    this.server = null;
    this.messageId = 1;
    this.responses = new Map();
    this.serverPath = path.resolve(__dirname, '..', 'index.js');
  }

  async startServer() {
    console.log('🚀 Starting MCP server for enhanced output demonstration...\n');
    
    this.server = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.server.stdout.on('data', (data) => {
      this.handleServerResponse(data.toString());
    });

    this.server.stderr.on('data', () => {});

    await this.sendMessage({
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'enhanced-output-demo', version: '1.0.0' }
      }
    });

    await this.waitForResponse(1);
  }

  handleServerResponse(output) {
    const lines = output.split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const response = JSON.parse(line);
        if (response.id) {
          this.responses.set(response.id, response);
        }
      } catch (e) {}
    }
  }

  async sendMessage(message) {
    this.server.stdin.write(JSON.stringify(message) + '\n');
  }

  async waitForResponse(id, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const checkResponse = () => {
        if (this.responses.has(id)) {
          resolve(this.responses.get(id));
        } else {
          setTimeout(checkResponse, 100);
        }
      };
      setTimeout(() => reject(new Error(`Timeout waiting for response ${id}`)), timeout);
      checkResponse();
    });
  }

  async executeCommand(command, context) {
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: command,
          aiContext: context
        }
      }
    });

    const response = await this.waitForResponse(messageId);
    return response.result ? response.result.content[0].text : null;
  }

  async getTool(toolName, args = {}) {
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    });

    const response = await this.waitForResponse(messageId);
    return response.result ? response.result.content[0].text : null;
  }

  printSection(title, content) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🎯 ${title}`);
    console.log(`${'='.repeat(80)}`);
    console.log(content);
  }

  async cleanup() {
    if (this.server) {
      this.server.kill();
    }
  }

  async runDemo() {
    console.log('🎨 Enhanced Output Formatting Demonstration');
    console.log('===========================================');
    console.log('This demo shows how the MCP server now formats output for Claude Desktop\n');

    try {
      await this.startServer();

      // Demo 1: Simple command with enhanced formatting
      console.log('📋 Demo 1: Simple Command Execution');
      const simpleOutput = await this.executeCommand(
        'echo "Welcome to enhanced MCP output!"',
        'Demonstrating basic command execution with enhanced formatting'
      );
      this.printSection('Simple Command Output', simpleOutput);

      // Demo 2: Command with structured output
      console.log('\n📊 Demo 2: Command with Structured Output');
      const structuredOutput = await this.executeCommand(
        'ls -la',
        'Listing directory contents with detailed formatting'
      );
      this.printSection('Directory Listing Output', structuredOutput);

      // Demo 3: Security status display
      console.log('\n🛡️  Demo 3: Security Status Display');
      const securityOutput = await this.getTool('get_security_status');
      this.printSection('Security Status', securityOutput);

      // Demo 4: Context information
      console.log('\n📋 Demo 4: Context Information Display');
      const contextOutput = await this.getTool('get_context');
      this.printSection('Current Context', contextOutput);

      // Demo 5: Command history
      console.log('\n📜 Demo 5: Command History Display');
      const historyOutput = await this.getTool('get_history', { limit: 5 });
      this.printSection('Command History', historyOutput);

      // Demo 6: Error handling
      console.log('\n❌ Demo 6: Error Handling and Display');
      const errorOutput = await this.executeCommand(
        'nonexistent-command',
        'Demonstrating error handling and formatting'
      );
      this.printSection('Error Output', errorOutput);

      console.log('\n🎉 Demonstration Complete!');
      console.log('\nKey Features Demonstrated:');
      console.log('✅ Rich markdown formatting with headers and sections');
      console.log('✅ Code blocks for commands and output');
      console.log('✅ Icons and emojis for visual clarity');
      console.log('✅ Structured display of metadata and context');
      console.log('✅ Enhanced error messages and suggestions');
      console.log('✅ Organized command input and output sections');
      console.log('✅ AI context integration and display');
      console.log('✅ Security information with visual indicators');
      console.log('✅ Command history with timestamps and results');

      console.log('\n📱 Claude Desktop Integration:');
      console.log('• All output is formatted as markdown for optimal display');
      console.log('• Commands, input, and output are clearly separated');
      console.log('• Visual indicators help users quickly understand results');
      console.log('• Structured information is easy to scan and understand');
      console.log('• Error messages include helpful suggestions');

    } catch (error) {
      console.error('❌ Demo failed:', error.message);
    } finally {
      await this.cleanup();
    }
  }
}

async function main() {
  const demo = new EnhancedOutputDemo();
  await demo.runDemo();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  });
}

module.exports = { EnhancedOutputDemo };
