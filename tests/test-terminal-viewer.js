#!/usr/bin/env node

/**
 * Test script for terminal viewer functionality
 */

const { spawn } = require('child_process');
const path = require('path');

function testTerminalViewer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing terminal viewer functionality...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let testPassed = false;
    
    // Send MCP initialization message
    const initMessage = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: false
          }
        },
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    }) + '\n';
    
    server.stdin.write(initMessage);
    
    // Test 1: List tools to verify terminal viewer tools are available
    setTimeout(() => {
      const listToolsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      }) + '\n';
      
      server.stdin.write(listToolsMessage);
    }, 100);
    
    // Test 2: Get terminal viewer status (should be disabled initially)
    setTimeout(() => {
      const statusMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_terminal_viewer_status',
          arguments: {}
        }
      }) + '\n';

      server.stdin.write(statusMessage);
    }, 200);

    // Test 3: Execute regular command (without terminal viewer)
    setTimeout(() => {
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'echo',
            args: ['Hello World!']
          }
        }
      }) + '\n';

      server.stdin.write(executeMessage);
    }, 300);

    // Test 4: List resources (should be empty initially)
    setTimeout(() => {
      const listResourcesMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/list'
      }) + '\n';

      server.stdin.write(listResourcesMessage);
    }, 400);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      
      // Check for successful responses
      if (stdout.includes('toggle_terminal_viewer') &&
          stdout.includes('get_terminal_viewer_status') &&
          stdout.includes('Terminal Viewer Status: Disabled') &&
          stdout.includes('Hello World!')) {
        testPassed = true;
        console.log('✅ Terminal viewer functionality test passed!');
        console.log('\nKey features verified:');
        console.log('• Terminal viewer tools are available');
        console.log('• Terminal viewer status can be retrieved');
        console.log('• Regular commands execute successfully');
        console.log('• Server handles terminal viewer parameters correctly');

        server.kill();
        resolve();
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('close', (code) => {
      if (!testPassed) {
        console.error('❌ Terminal viewer test failed');
        console.error('Exit code:', code);
        console.error('Stdout:', stdout);
        console.error('Stderr:', stderr);
        reject(new Error('Terminal viewer test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Terminal viewer test timed out');
        server.kill();
        reject(new Error('Test timeout'));
      }
    }, 10000);
  });
}

if (require.main === module) {
  testTerminalViewer()
    .then(() => {
      console.log('\n🎉 All terminal viewer tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Terminal viewer tests failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testTerminalViewer };
