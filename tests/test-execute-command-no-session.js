#!/usr/bin/env node

/**
 * Test that execute_command works correctly without session support
 */

const { spawn } = require('child_process');
const path = require('path');

function testExecuteCommandNoSession() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing execute_command without session support...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let testsPassed = 0;
    const totalTests = 2;
    
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
    
    // Test 1: Simple command execution
    setTimeout(() => {
      console.log('📝 Test 1: Simple command execution...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'echo',
            args: ['Hello, World!']
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 500);
    
    // Test 2: Command with working directory
    setTimeout(() => {
      console.log('📝 Test 2: Command with working directory...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'pwd',
            cwd: '/tmp'
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 1500);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      
      if (testsPassed === totalTests) {
        resolve();
      } else {
        reject(new Error(`Only ${testsPassed}/${totalTests} tests passed`));
      }
    }, 3000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Test 1: Check simple command execution
      if (output.includes('"id":2') && output.includes('Hello, World!')) {
        console.log('✅ Test 1 PASSED: Simple command execution works');
        testsPassed++;
      }
      
      // Test 2: Check working directory command
      if (output.includes('"id":3') && output.includes('/tmp')) {
        console.log('✅ Test 2 PASSED: Working directory parameter works');
        testsPassed++;
      }
      
      // Check for any session-related errors
      if (output.includes('session') && output.includes('error')) {
        console.log('❌ Session-related error detected in output');
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('close', (code) => {
      console.log(`📊 Test Results: ${testsPassed}/${totalTests} tests passed`);
      
      if (testsPassed < totalTests) {
        console.log('❌ Some tests failed');
        console.log('Exit code:', code);
        if (stderr) {
          console.log('Stderr:', stderr.substring(0, 500));
        }
      }
    });
    
    server.on('error', (error) => {
      console.log('❌ Error starting server:', error);
      reject(error);
    });
  });
}

// Run the test
if (require.main === module) {
  testExecuteCommandNoSession()
    .then(() => {
      console.log('🎉 execute_command (no session) test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 execute_command (no session) test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testExecuteCommandNoSession };
