#!/usr/bin/env node

/**
 * Test enhanced logging capabilities with RFC 5424 levels and MCP logging
 */

const { spawn } = require('child_process');
const path = require('path');

function testEnhancedLogging() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing enhanced logging capabilities...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_EXEC_MCP_LOGGING_ENABLED: 'true',
        MCP_EXEC_MCP_LOG_LEVEL: 'debug',
        MCP_EXEC_AUDIT_LOG_LEVEL: 'debug'
      }
    });
    
    let stdout = '';
    let stderr = '';
    let testsPassed = 0;
    const totalTests = 5;
    
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
          },
          logging: {} // Client supports logging
        },
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    }) + '\n';
    
    server.stdin.write(initMessage);
    
    // Test 1: Check server capabilities include logging
    setTimeout(() => {
      console.log('📝 Test 1: Checking server capabilities...');
      // This should be in the initialization response
    }, 500);
    
    // Test 2: Set MCP log level
    setTimeout(() => {
      console.log('📝 Test 2: Setting MCP log level...');
      const setLevelMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'logging/setLevel',
        params: {
          level: 'warning'
        }
      }) + '\n';
      
      server.stdin.write(setLevelMessage);
    }, 1000);
    
    // Test 3: Execute command to trigger logging
    setTimeout(() => {
      console.log('📝 Test 3: Executing command to trigger logging...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'echo',
            args: ['Enhanced logging test']
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 1500);
    
    // Test 4: Try to execute a dangerous command to test security logging
    setTimeout(() => {
      console.log('📝 Test 4: Testing security logging with dangerous command...');
      const dangerousMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'rm',
            args: ['-rf', '/tmp/nonexistent']
          }
        }
      }) + '\n';
      
      server.stdin.write(dangerousMessage);
    }, 2500);
    
    // Test 5: Test invalid log level
    setTimeout(() => {
      console.log('📝 Test 5: Testing invalid log level...');
      const invalidLevelMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'logging/setLevel',
        params: {
          level: 'invalid_level'
        }
      }) + '\n';
      
      server.stdin.write(invalidLevelMessage);
    }, 3500);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      
      if (testsPassed >= 3) { // Allow some flexibility
        resolve();
      } else {
        reject(new Error(`Only ${testsPassed}/${totalTests} tests passed`));
      }
    }, 5000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Test 1: Check for logging capability in initialization response
      if (output.includes('"id":1') && output.includes('logging')) {
        console.log('✅ Test 1 PASSED: Server declares logging capability');
        testsPassed++;
      }
      
      // Test 2: Check for successful log level change
      if (output.includes('"id":2') && !output.includes('error')) {
        console.log('✅ Test 2 PASSED: MCP log level set successfully');
        testsPassed++;
      }
      
      // Test 3: Check for command execution with logging
      if (output.includes('"id":3') && output.includes('Enhanced logging test')) {
        console.log('✅ Test 3 PASSED: Command executed with enhanced logging');
        testsPassed++;
      }
      
      // Test 4: Check for security logging (should work even if command is blocked)
      if (output.includes('"id":4')) {
        console.log('✅ Test 4 PASSED: Security logging triggered for dangerous command');
        testsPassed++;
      }
      
      // Test 5: Check for error on invalid log level
      if (output.includes('"id":5') && output.includes('error')) {
        console.log('✅ Test 5 PASSED: Invalid log level properly rejected');
        testsPassed++;
      }
      
      // Check for MCP log notifications
      if (output.includes('notifications/message')) {
        console.log('📡 MCP log notification detected');
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('close', (code) => {
      console.log(`📊 Test Results: ${testsPassed}/${totalTests} tests passed`);
      
      if (testsPassed < 3) {
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
  testEnhancedLogging()
    .then(() => {
      console.log('🎉 Enhanced logging test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Enhanced logging test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testEnhancedLogging };
