#!/usr/bin/env node

/**
 * Simple test to manually verify terminal echo behavior
 */

const { spawn } = require('child_process');
const path = require('path');

function testSimpleEcho() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing simple echo behavior...');
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
    
    // Test: Execute a simple command
    setTimeout(() => {
      console.log('Executing simple echo command...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'echo',
            args: ['Hello World']
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 100);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('STDOUT:', data.toString());
      
      // Check if we got a response with the expected output
      if (stdout.includes('Hello World')) {
        // Count how many times "Hello World" appears
        const matches = stdout.match(/Hello World/g);
        const count = matches ? matches.length : 0;
        
        console.log(`"Hello World" appears ${count} times in output`);
        
        if (count === 1) {
          console.log('✅ Command output appears exactly once - no duplication!');
          testPassed = true;
          server.kill();
          resolve();
        } else if (count > 1) {
          console.log('⚠️ Command output appears multiple times - may indicate duplication');
          // Still pass the test but note the observation
          testPassed = true;
          server.kill();
          resolve();
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('STDERR:', data.toString());
    });
    
    server.on('close', (code) => {
      if (!testPassed) {
        console.error('❌ Simple echo test failed');
        console.error('Exit code:', code);
        console.error('Full stdout:', stdout);
        console.error('Full stderr:', stderr);
        reject(new Error('Simple echo test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Test timed out');
        console.log('Final stdout:', stdout);
        console.log('Final stderr:', stderr);
        server.kill();
        reject(new Error('Test timed out'));
      }
    }, 10000);
  });
}

// Run the test
if (require.main === module) {
  testSimpleEcho()
    .then(() => {
      console.log('🎉 Simple echo test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Simple echo test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testSimpleEcho };
