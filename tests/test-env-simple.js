#!/usr/bin/env node

/**
 * Simple test to verify environment variables work
 */

const { spawn } = require('child_process');
const path = require('path');

function testEnvSimple() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Simple environment variable test...');
    
    // Set a few key environment variables
    const testEnv = {
      ...process.env,
      MCP_EXEC_SECURITY_LEVEL: 'strict',
      MCP_EXEC_CONFIRM_DANGEROUS: 'true',
      MCP_EXEC_TIMEOUT: '600000'
    };
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: testEnv
    });
    
    let stdout = '';
    let stderr = '';
    
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
    
    // Test get_security_status
    setTimeout(() => {
      console.log('📝 Getting security status...');
      const getSecurityMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_security_status',
          arguments: {}
        }
      }) + '\n';
      
      server.stdin.write(getSecurityMessage);
    }, 500);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Full stdout:');
      console.log(stdout);
      console.log('📝 Full stderr:');
      console.log(stderr);
      server.kill();
      resolve();
    }, 2000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('error', (error) => {
      console.log('❌ Error starting server:', error);
      reject(error);
    });
  });
}

// Run the test
if (require.main === module) {
  testEnvSimple()
    .then(() => {
      console.log('🎉 Simple env test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Simple env test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testEnvSimple };
