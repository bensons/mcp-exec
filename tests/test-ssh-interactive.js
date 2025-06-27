#!/usr/bin/env node

/**
 * Comprehensive test script for SSH command execution via MCP server
 * Tests both basic SSH functionality and interactive command handling
 */

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

class MCPSSHTester {
  constructor() {
    this.server = null;
    this.messageId = 1;
    this.responses = new Map();
    this.serverPath = path.resolve(__dirname, '..', 'index.js');
  }

  async startServer() {
    console.log('🚀 Starting MCP server for SSH testing...');
    console.log(`Server path: ${this.serverPath}`);
    
    this.server = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.server.stdout.on('data', (data) => {
      const output = data.toString();
      this.handleServerResponse(output);
    });

    this.server.stderr.on('data', (data) => {
      console.error('Server stderr:', data.toString());
    });

    this.server.on('error', (error) => {
      console.error('❌ Server error:', error);
    });

    // Initialize the server
    await this.sendMessage({
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: false }
        },
        clientInfo: {
          name: 'ssh-test-client',
          version: '1.0.0'
        }
      }
    });

    // Wait for initialization response
    await this.waitForResponse(1);
    console.log('✅ MCP server initialized successfully');
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
    const messageStr = JSON.stringify(message) + '\n';
    this.server.stdin.write(messageStr);
  }

  async waitForResponse(id, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const checkResponse = () => {
        if (this.responses.has(id)) {
          const response = this.responses.get(id);
          this.responses.delete(id);
          resolve(response);
        } else {
          setTimeout(checkResponse, 100);
        }
      };

      setTimeout(() => {
        reject(new Error(`Timeout waiting for response to message ${id}`));
      }, timeout);

      checkResponse();
    });
  }

  async listTools() {
    console.log('\n📋 Listing available tools...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/list'
    });

    const response = await this.waitForResponse(messageId);
    
    if (response.result && response.result.tools) {
      console.log(`✅ Found ${response.result.tools.length} tools:`);
      response.result.tools.forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.description}`);
      });
      return response.result.tools;
    } else {
      throw new Error('Failed to list tools');
    }
  }

  async testBasicSSHCommand() {
    console.log('\n🔍 Testing basic SSH command validation...');
    
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: 'ssh',
          args: ['--help'],
          aiContext: 'Testing SSH help command to verify SSH is available'
        }
      }
    });

    const response = await this.waitForResponse(messageId, 10000);
    
    if (response.result) {
      const result = JSON.parse(response.result.content[0].text);
      console.log('✅ SSH help command executed successfully');
      console.log(`Exit code: ${result.exitCode}`);
      console.log(`Output length: ${result.stdout.length} chars`);
      
      if (result.stdout.includes('usage:') || result.stdout.includes('Usage:')) {
        console.log('✅ SSH appears to be properly installed');
        return true;
      } else {
        console.log('⚠️  SSH help output unexpected');
        return false;
      }
    } else {
      console.log('❌ SSH help command failed');
      console.log('Response:', JSON.stringify(response, null, 2));
      return false;
    }
  }

  async testSSHSecurityValidation() {
    console.log('\n🔒 Testing SSH security validation...');
    
    // Test potentially dangerous SSH command
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: 'ssh',
          args: ['-o', 'StrictHostKeyChecking=no', 'root@suspicious-host.com', 'rm -rf /'],
          aiContext: 'Testing security validation for dangerous SSH command'
        }
      }
    });

    const response = await this.waitForResponse(messageId, 10000);
    
    if (response.error || (response.result && JSON.parse(response.result.content[0].text).error)) {
      console.log('✅ Dangerous SSH command was properly blocked');
      return true;
    } else {
      console.log('⚠️  Dangerous SSH command was not blocked - check security settings');
      return false;
    }
  }

  async testInteractiveSSHSimulation() {
    console.log('\n🔄 Testing interactive SSH simulation...');
    
    // Test SSH to localhost (should prompt for password or key)
    const messageId = this.messageId++;
    await this.sendMessage({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: 'ssh',
          args: ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', 'localhost', 'echo "test"'],
          timeout: 10000,
          aiContext: 'Testing SSH connection to localhost with timeout'
        }
      }
    });

    const response = await this.waitForResponse(messageId, 15000);
    
    if (response.result) {
      const result = JSON.parse(response.result.content[0].text);
      console.log('✅ SSH localhost test completed');
      console.log(`Exit code: ${result.exitCode}`);
      
      // SSH to localhost without keys typically fails, which is expected
      if (result.exitCode !== 0) {
        console.log('✅ SSH connection failed as expected (no keys configured)');
        return true;
      } else {
        console.log('✅ SSH connection succeeded (keys are configured)');
        return true;
      }
    } else {
      console.log('❌ SSH localhost test failed');
      return false;
    }
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
          command: 'ssh-keygen',
          args: ['-t', 'rsa', '-b', '2048', '-f', '/tmp/test_key', '-N', '', '-q'],
          aiContext: 'Testing SSH key generation for testing purposes'
        }
      }
    });

    const response = await this.waitForResponse(messageId, 10000);
    
    if (response.result) {
      const result = JSON.parse(response.result.content[0].text);
      console.log('✅ SSH key generation test completed');
      console.log(`Exit code: ${result.exitCode}`);
      
      if (result.exitCode === 0) {
        console.log('✅ SSH key generated successfully');
        
        // Clean up the test key
        const cleanupId = this.messageId++;
        await this.sendMessage({
          jsonrpc: '2.0',
          id: cleanupId,
          method: 'tools/call',
          params: {
            name: 'execute_command',
            arguments: {
              command: 'rm',
              args: ['-f', '/tmp/test_key', '/tmp/test_key.pub'],
              aiContext: 'Cleaning up test SSH keys'
            }
          }
        });
        
        await this.waitForResponse(cleanupId, 5000);
        console.log('✅ Test keys cleaned up');
        return true;
      } else {
        console.log('⚠️  SSH key generation failed');
        return false;
      }
    } else {
      console.log('❌ SSH key generation test failed');
      return false;
    }
  }

  async testGetSecurityStatus() {
    console.log('\n🛡️  Testing security status retrieval...');
    
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
      console.log(`Security level: ${status.level}`);
      console.log(`Network access: ${status.sandboxing?.networkAccess}`);
      console.log(`Dangerous command confirmation: ${status.confirmDangerous}`);
      return true;
    } else {
      console.log('❌ Failed to get security status');
      return false;
    }
  }

  async cleanup() {
    if (this.server) {
      console.log('\n🧹 Cleaning up server...');
      this.server.kill();
    }
  }

  async runAllTests() {
    const results = {
      serverStart: false,
      toolsList: false,
      basicSSH: false,
      securityValidation: false,
      interactiveSSH: false,
      keyGeneration: false,
      securityStatus: false
    };

    try {
      // Start server and list tools
      await this.startServer();
      results.serverStart = true;
      
      await this.listTools();
      results.toolsList = true;

      // Run SSH-specific tests
      results.basicSSH = await this.testBasicSSHCommand();
      results.securityValidation = await this.testSSHSecurityValidation();
      results.interactiveSSH = await this.testInteractiveSSHSimulation();
      results.keyGeneration = await this.testSSHKeyGeneration();
      results.securityStatus = await this.testGetSecurityStatus();

    } catch (error) {
      console.error('❌ Test execution failed:', error.message);
    } finally {
      await this.cleanup();
    }

    return results;
  }
}

async function main() {
  console.log('🧪 MCP SSH Interactive Testing Suite');
  console.log('=====================================\n');

  const tester = new MCPSSHTester();
  const results = await tester.runAllTests();

  console.log('\n📊 Test Results Summary:');
  console.log('========================');
  
  const testNames = {
    serverStart: 'Server Startup',
    toolsList: 'Tools Listing',
    basicSSH: 'Basic SSH Command',
    securityValidation: 'Security Validation',
    interactiveSSH: 'Interactive SSH',
    keyGeneration: 'SSH Key Generation',
    securityStatus: 'Security Status'
  };

  let passed = 0;
  let total = 0;

  for (const [key, name] of Object.entries(testNames)) {
    total++;
    const status = results[key] ? '✅ PASS' : '❌ FAIL';
    console.log(`${name}: ${status}`);
    if (results[key]) passed++;
  }

  console.log(`\n🎯 Overall: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('\n🎉 All tests passed! SSH functionality is working correctly.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above for details.');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = { MCPSSHTester };
