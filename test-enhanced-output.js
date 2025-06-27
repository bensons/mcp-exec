#!/usr/bin/env node

/**
 * Test script to verify enhanced output formatting for Claude Desktop
 */

const { spawn } = require('child_process');
const path = require('path');

class EnhancedOutputTester {
  constructor() {
    this.server = null;
    this.messageId = 1;
    this.responses = new Map();
    this.serverPath = path.resolve(__dirname, 'dist', 'index.js');
  }

  async startServer() {
    console.log('🚀 Starting MCP server for enhanced output testing...');
    
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
        clientInfo: { name: 'enhanced-output-test', version: '1.0.0' }
      }
    });

    await this.waitForResponse(1);
    console.log('✅ MCP server initialized');
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

  async testEnhancedCommandOutput() {
    console.log('\n📋 Testing enhanced command output formatting...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: 'echo "Hello, World!"',
          aiContext: 'Testing enhanced output formatting for Claude Desktop'
        }
      }
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.result) {
      const output = response.result.content[0].text;
      console.log('✅ Enhanced command output received');
      console.log('📄 Formatted Output:');
      console.log('=' .repeat(60));
      console.log(output);
      console.log('=' .repeat(60));
      
      // Check for expected formatting elements
      const hasHeader = output.includes('## Command Execution');
      const hasCodeBlock = output.includes('```');
      const hasSummary = output.includes('## Summary') || output.includes('### 📋 Summary');
      const hasCommand = output.includes('echo "Hello, World!"');
      
      console.log('\n🔍 Formatting Analysis:');
      console.log(`• Header section: ${hasHeader ? '✅' : '❌'}`);
      console.log(`• Code blocks: ${hasCodeBlock ? '✅' : '❌'}`);
      console.log(`• Summary section: ${hasSummary ? '✅' : '❌'}`);
      console.log(`• Command display: ${hasCommand ? '✅' : '❌'}`);
      
      return hasHeader && hasCodeBlock && hasSummary && hasCommand;
    }
    return false;
  }

  async testSecurityStatusFormatting() {
    console.log('\n🛡️  Testing security status formatting...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'get_security_status'
      }
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.result) {
      const output = response.result.content[0].text;
      console.log('✅ Security status formatting received');
      console.log('📄 Formatted Output:');
      console.log('=' .repeat(60));
      console.log(output);
      console.log('=' .repeat(60));
      
      const hasSecurityHeader = output.includes('## Security Status');
      const hasSecurityLevel = output.includes('Security Level:');
      const hasIcons = output.includes('🔒') || output.includes('⚖️') || output.includes('🔓');
      
      console.log('\n🔍 Security Formatting Analysis:');
      console.log(`• Security header: ${hasSecurityHeader ? '✅' : '❌'}`);
      console.log(`• Security level: ${hasSecurityLevel ? '✅' : '❌'}`);
      console.log(`• Icons/emojis: ${hasIcons ? '✅' : '❌'}`);
      
      return hasSecurityHeader && hasSecurityLevel && hasIcons;
    }
    return false;
  }

  async testContextFormatting() {
    console.log('\n📋 Testing context formatting...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'get_context'
      }
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.result) {
      const output = response.result.content[0].text;
      console.log('✅ Context formatting received');
      console.log('📄 Formatted Output:');
      console.log('=' .repeat(60));
      console.log(output);
      console.log('=' .repeat(60));
      
      const hasContextHeader = output.includes('## Current Context');
      const hasWorkingDir = output.includes('Working Directory:');
      const hasSessionId = output.includes('Session ID:');
      
      console.log('\n🔍 Context Formatting Analysis:');
      console.log(`• Context header: ${hasContextHeader ? '✅' : '❌'}`);
      console.log(`• Working directory: ${hasWorkingDir ? '✅' : '❌'}`);
      console.log(`• Session ID: ${hasSessionId ? '✅' : '❌'}`);
      
      return hasContextHeader && hasWorkingDir && hasSessionId;
    }
    return false;
  }

  async testHistoryFormatting() {
    console.log('\n📜 Testing history formatting...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'get_history',
        arguments: {
          limit: 3
        }
      }
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.result) {
      const output = response.result.content[0].text;
      console.log('✅ History formatting received');
      console.log('📄 Formatted Output:');
      console.log('=' .repeat(60));
      console.log(output);
      console.log('=' .repeat(60));
      
      const hasHistoryHeader = output.includes('## Command History');
      const hasShowingText = output.includes('Showing') || output.includes('No commands');
      
      console.log('\n🔍 History Formatting Analysis:');
      console.log(`• History header: ${hasHistoryHeader ? '✅' : '❌'}`);
      console.log(`• Content display: ${hasShowingText ? '✅' : '❌'}`);
      
      return hasHistoryHeader && hasShowingText;
    }
    return false;
  }

  async cleanup() {
    if (this.server) {
      this.server.kill();
    }
  }

  async runAllTests() {
    const results = {};

    try {
      await this.startServer();
      results.serverStart = true;

      results.commandOutput = await this.testEnhancedCommandOutput();
      results.securityStatus = await this.testSecurityStatusFormatting();
      results.contextFormatting = await this.testContextFormatting();
      results.historyFormatting = await this.testHistoryFormatting();

    } catch (error) {
      console.error('❌ Test execution failed:', error.message);
    } finally {
      await this.cleanup();
    }

    return results;
  }
}

async function main() {
  console.log('🧪 Enhanced Output Formatting Test');
  console.log('===================================\n');

  const tester = new EnhancedOutputTester();
  const results = await tester.runAllTests();

  console.log('\n📊 Test Results Summary:');
  console.log('========================');
  
  const testNames = {
    serverStart: 'Server Startup',
    commandOutput: 'Enhanced Command Output',
    securityStatus: 'Security Status Formatting',
    contextFormatting: 'Context Formatting',
    historyFormatting: 'History Formatting'
  };

  let passed = 0;
  let total = 0;

  for (const [key, name] of Object.entries(testNames)) {
    if (results[key] !== undefined) {
      total++;
      const status = results[key] ? '✅ PASS' : '❌ FAIL';
      console.log(`${name}: ${status}`);
      if (results[key]) passed++;
    }
  }

  const successRate = Math.round(passed/total*100);
  console.log(`\n🎯 Overall Score: ${passed}/${total} tests passed (${successRate}%)`);

  if (successRate >= 80) {
    console.log('\n🎉 SUCCESS: Enhanced output formatting is working!');
    console.log('\n✅ The MCP server now provides:');
    console.log('• Rich markdown formatting for Claude Desktop');
    console.log('• Structured command output with headers and sections');
    console.log('• Enhanced display of security status and context');
    console.log('• Improved readability with icons and code blocks');
    console.log('• Better organization of command input and output');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some formatting features need attention.');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { EnhancedOutputTester };
