#!/usr/bin/env node

/**
 * Debug test for terminal viewer functionality
 */

const { spawn } = require('child_process');
const path = require('path');

function testTerminalViewerDebug() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing terminal viewer with debug output...');
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
    
    // Test 1: Try to execute command with terminal viewer enabled
    setTimeout(() => {
      console.log('Sending execute_command with enableTerminalViewer...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'echo',
            args: ['Hello Terminal Viewer Debug!'],
            enableTerminalViewer: true
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 200);
    
    // Test 2: Try regular command execution
    setTimeout(() => {
      console.log('Sending regular execute_command...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'echo',
            args: ['Hello Regular!']
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 400);
    
    server.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('STDOUT:', output);
      
      // Check for successful responses
      if (stdout.includes('"Hello Regular!"') || 
          stdout.includes('Terminal viewer failed, executed normally') ||
          stdout.includes('Terminal Session Created')) {
        testPassed = true;
        console.log('✅ Terminal viewer debug test passed!');
        
        server.kill();
        resolve();
      }
    });
    
    server.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('STDERR:', output);
    });
    
    server.on('close', (code) => {
      console.log(`Server closed with code: ${code}`);
      if (!testPassed) {
        console.error('❌ Terminal viewer debug test failed');
        console.error('Exit code:', code);
        console.error('Full stdout:', stdout);
        console.error('Full stderr:', stderr);
        reject(new Error('Terminal viewer debug test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Terminal viewer debug test timed out');
        console.error('Stdout so far:', stdout);
        console.error('Stderr so far:', stderr);
        server.kill();
        reject(new Error('Test timeout'));
      }
    }, 10000);
  });
}

if (require.main === module) {
  testTerminalViewerDebug()
    .then(() => {
      console.log('\n🎉 Terminal viewer debug test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Terminal viewer debug test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testTerminalViewerDebug };
