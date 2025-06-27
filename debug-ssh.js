#!/usr/bin/env node

/**
 * Debug script to test SSH command execution issues
 */

const { spawn } = require('child_process');
const path = require('path');

class SSHDebugger {
  constructor() {
    this.serverPath = path.join(__dirname, 'dist', 'index.js');
    this.messageId = 1;
    this.server = null;
    this.responses = new Map();
  }

  async startServer() {
    console.log('🚀 Starting MCP server for SSH debugging...');
    
    this.server = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.server.stdout.on('data', (data) => {
      this.handleServerResponse(data.toString());
    });

    this.server.stderr.on('data', (data) => {
      console.log('STDERR:', data.toString().trim());
    });

    // Initialize the server
    await this.sendMessage({
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'ssh-debug', version: '1.0.0' }
      }
    });

    await this.waitForResponse(1);
    console.log('✅ MCP server initialized successfully');
  }

  handleServerResponse(data) {
    const lines = data.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const response = JSON.parse(line);
        if (response.id) {
          this.responses.set(response.id, response);
        }
      } catch (error) {
        // Ignore non-JSON lines
      }
    }
  }

  async sendMessage(message) {
    const messageStr = JSON.stringify(message) + '\n';
    this.server.stdin.write(messageStr);
  }

  async waitForResponse(id, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const checkResponse = () => {
        if (this.responses.has(id)) {
          resolve(this.responses.get(id));
        } else {
          setTimeout(checkResponse, 100);
        }
      };
      
      setTimeout(() => reject(new Error('Timeout waiting for response')), timeout);
      checkResponse();
    });
  }

  async testCommand(command, description) {
    console.log(`\n🧪 Testing: ${description}`);
    console.log(`   Command: ${command}`);
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: command,
          timeout: 10000,
          aiContext: description
        }
      }
    });

    try {
      const response = await this.waitForResponse(messageId, 15000);
      
      if (response.error) {
        console.log(`   ❌ Error: ${response.error.message}`);
        return false;
      }
      
      if (response.result && response.result.content) {
        const result = JSON.parse(response.result.content[0].text);
        console.log(`   ✅ Success: Exit code ${result.exitCode}`);
        console.log(`   📤 Stdout: ${result.stdout.slice(0, 200)}${result.stdout.length > 200 ? '...' : ''}`);
        if (result.stderr) {
          console.log(`   📥 Stderr: ${result.stderr.slice(0, 200)}${result.stderr.length > 200 ? '...' : ''}`);
        }
        return true;
      }
    } catch (error) {
      console.log(`   ❌ Timeout or error: ${error.message}`);
      return false;
    }
  }

  async runTests() {
    try {
      await this.startServer();

      // Test 1: Basic command that works
      await this.testCommand('ps -aef | head -5', 'Basic ps command (should work)');

      // Test 2: SSH version check
      await this.testCommand('ssh -V', 'SSH version check');

      // Test 3: SSH help
      await this.testCommand('ssh --help', 'SSH help command');

      // Test 4: Your exact SSH command
      await this.testCommand('ssh admin@10.254.130.152', 'Your exact SSH command');

      // Test 5: SSH with -l flag
      await this.testCommand('ssh -l admin 10.254.130.152', 'SSH with -l flag');

      // Test 6: SSH with timeout and batch mode
      await this.testCommand('ssh -o ConnectTimeout=5 -o BatchMode=yes admin@10.254.130.152 echo test', 'SSH with timeout and batch mode');

      // Test 7: Check security status
      const messageId = this.messageId++;
      await this.sendMessage({
        jsonrpc: '2.0',
        id: messageId,
        method: 'tools/call',
        params: {
          name: 'get_security_status',
          arguments: {}
        }
      });

      const securityResponse = await this.waitForResponse(messageId);
      if (securityResponse.result) {
        console.log('\n🔒 Security Status:');
        console.log(securityResponse.result.content[0].text);
      }

    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      if (this.server) {
        this.server.kill();
      }
    }
  }
}

if (require.main === module) {
  const sshDebugger = new SSHDebugger();
  sshDebugger.runTests().catch(error => {
    console.error('❌ Debug session failed:', error);
    process.exit(1);
  });
}
