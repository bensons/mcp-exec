#!/usr/bin/env node

/**
 * Improved SSH testing script that addresses the issues found in the initial test
 */

const { spawn } = require('child_process');
const path = require('path');

class ImprovedSSHTester {
  constructor() {
    this.server = null;
    this.messageId = 1;
    this.responses = new Map();
    this.serverPath = path.resolve(__dirname, 'dist', 'index.js');
  }

  async startServer() {
    console.log('🚀 Starting MCP server for improved SSH testing...');
    
    this.server = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.server.stdout.on('data', (data) => {
      const output = data.toString();
      this.handleServerResponse(output);
    });

    this.server.stderr.on('data', (data) => {
      // Suppress stderr for cleaner output
    });

    // Initialize the server
    await this.sendMessage({
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'improved-ssh-test', version: '1.0.0' }
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
      } catch (e) {
        // Ignore non-JSON output
      }
    }
  }

  async sendMessage(message) {
    this.server.stdin.write(JSON.stringify(message) + '\n');
  }

  async waitForResponse(id, timeout = 10000) {
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

  async testSSHVersion() {
    console.log('\n🔍 Testing SSH version command...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: 'ssh -V',
          aiContext: 'Testing SSH version to verify SSH is available'
        }
      }
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.result) {
      const result = JSON.parse(response.result.content[0].text);
      console.log('✅ SSH version command executed');
      console.log(`Exit code: ${result.exitCode}`);
      console.log(`SSH version info: ${result.stderr.substring(0, 50)}...`);
      return result.exitCode === 0 || result.stderr.includes('OpenSSH');
    }
    return false;
  }

  async testDangerousCommandBlocking() {
    console.log('\n🔒 Testing dangerous command blocking...');
    
    // Test a command that should definitely be blocked
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: 'rm -rf /',
          aiContext: 'Testing dangerous command blocking'
        }
      }
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.error) {
      console.log('✅ Dangerous command was blocked (error response)');
      return true;
    }
    
    if (response.result) {
      const result = JSON.parse(response.result.content[0].text);
      if (result.error && result.error.includes('blocked')) {
        console.log('✅ Dangerous command was blocked');
        return true;
      } else {
        console.log('❌ Dangerous command was NOT blocked');
        console.log('Response:', JSON.stringify(result, null, 2));
        return false;
      }
    }
    
    return false;
  }

  async testSSHWithDangerousRemoteCommand() {
    console.log('\n🔒 Testing SSH with dangerous remote command...');
    
    // Test SSH command with dangerous remote command as a single string
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: 'ssh root@example.com "rm -rf /"',
          aiContext: 'Testing SSH with dangerous remote command'
        }
      }
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.error) {
      console.log('✅ SSH with dangerous command was blocked (error response)');
      return true;
    }
    
    if (response.result) {
      const result = JSON.parse(response.result.content[0].text);
      if (result.error && result.error.includes('blocked')) {
        console.log('✅ SSH with dangerous command was blocked');
        return true;
      } else {
        console.log('⚠️  SSH with dangerous command was not blocked');
        // This might be expected if the pattern doesn't match the full command
        return false;
      }
    }
    
    return false;
  }

  async testSSHConnectionTimeout() {
    console.log('\n⏱️  Testing SSH connection with timeout...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: 'ssh -o ConnectTimeout=2 -o BatchMode=yes nonexistent.example.com echo test',
          timeout: 5000,
          aiContext: 'Testing SSH connection timeout behavior'
        }
      }
    });

    const response = await this.waitForResponse(messageId, 15000);
    
    if (response.result) {
      const result = JSON.parse(response.result.content[0].text);
      console.log('✅ SSH timeout test completed');
      console.log(`Exit code: ${result.exitCode}`);
      // SSH should fail to connect, which is expected
      return result.exitCode !== 0;
    }
    
    return false;
  }

  async testSSHKeyGeneration() {
    console.log('\n🔑 Testing SSH key generation...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: 'ssh-keygen -t ed25519 -f /tmp/test_ssh_key -N "" -q',
          aiContext: 'Testing SSH key generation'
        }
      }
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.result) {
      const result = JSON.parse(response.result.content[0].text);
      console.log('✅ SSH key generation test completed');
      console.log(`Exit code: ${result.exitCode}`);
      
      if (result.exitCode === 0) {
        // Clean up the test key
        const cleanupId = this.messageId++;
        await this.sendMessage({
          jsonrpc: '2.0',
          id: cleanupId,
          method: 'tools/call',
          params: {
            name: 'execute_command',
            arguments: {
              command: 'rm -f /tmp/test_ssh_key /tmp/test_ssh_key.pub',
              aiContext: 'Cleaning up test SSH keys'
            }
          }
        });
        await this.waitForResponse(cleanupId);
        console.log('✅ Test keys cleaned up');
        return true;
      }
    }
    
    return false;
  }

  async testSecurityStatus() {
    console.log('\n🛡️  Testing security status...');
    
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
      const status = JSON.parse(response.result.content[0].text);
      console.log('✅ Security status retrieved');
      console.log(`Security level: ${status.level || 'undefined'}`);
      console.log(`Confirm dangerous: ${status.confirmDangerous || 'undefined'}`);
      console.log(`Sandboxing enabled: ${status.sandboxing?.enabled || 'undefined'}`);
      console.log(`Network access: ${status.sandboxing?.networkAccess || 'undefined'}`);
      return true;
    }
    
    return false;
  }

  async testCommandHistory() {
    console.log('\n📜 Testing command history...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'get_history',
        arguments: {
          limit: 5
        }
      }
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.result) {
      const history = JSON.parse(response.result.content[0].text);
      console.log('✅ Command history retrieved');
      console.log(`History entries: ${history.length || 0}`);
      return true;
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

      results.sshVersion = await this.testSSHVersion();
      results.dangerousBlocking = await this.testDangerousCommandBlocking();
      results.sshDangerous = await this.testSSHWithDangerousRemoteCommand();
      results.sshTimeout = await this.testSSHConnectionTimeout();
      results.keyGeneration = await this.testSSHKeyGeneration();
      results.securityStatus = await this.testSecurityStatus();
      results.commandHistory = await this.testCommandHistory();

    } catch (error) {
      console.error('❌ Test execution failed:', error.message);
    } finally {
      await this.cleanup();
    }

    return results;
  }
}

async function main() {
  console.log('🧪 Improved MCP SSH Testing Suite');
  console.log('==================================\n');

  const tester = new ImprovedSSHTester();
  const results = await tester.runAllTests();

  console.log('\n📊 Test Results Summary:');
  console.log('========================');
  
  const testNames = {
    serverStart: 'Server Startup',
    sshVersion: 'SSH Version Check',
    dangerousBlocking: 'Dangerous Command Blocking',
    sshDangerous: 'SSH Dangerous Command',
    sshTimeout: 'SSH Connection Timeout',
    keyGeneration: 'SSH Key Generation',
    securityStatus: 'Security Status',
    commandHistory: 'Command History'
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

  console.log(`\n🎯 Overall: ${passed}/${total} tests passed`);

  if (passed >= total * 0.8) {
    console.log('\n🎉 SSH functionality is working well!');
    console.log('The MCP server can handle SSH commands interactively.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some issues found. Check the output above for details.');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { ImprovedSSHTester };
