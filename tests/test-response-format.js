#!/usr/bin/env node

/**
 * Test to see the exact response format
 */

const { spawn } = require('child_process');
const path = require('path');

function testResponseFormat() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🔍 Testing response format...');
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    
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
    
    // Create a session and see the exact response
    setTimeout(() => {
      console.log('📝 Creating session...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            enableTerminalViewer: true
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 500);
    
    setTimeout(() => {
      server.kill();
      resolve();
    }, 3000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      if (output.includes('"id":2')) {
        console.log('📋 EXACT RESPONSE:');
        console.log('=' * 50);
        console.log(output);
        console.log('=' * 50);
        
        // Try to parse and pretty print
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":2')) {
              const response = JSON.parse(line);
              console.log('📋 PARSED RESPONSE:');
              console.log(JSON.stringify(response, null, 2));
            }
          }
        } catch (e) {
          console.log('❌ Could not parse response:', e.message);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      // Ignore stderr for this test
    });
    
    server.on('error', (error) => {
      console.error('❌ Error:', error);
      reject(error);
    });
  });
}

// Run the test
if (require.main === module) {
  testResponseFormat()
    .then(() => {
      console.log('🎉 Response format test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Response format test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testResponseFormat };
