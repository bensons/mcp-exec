#!/usr/bin/env node

/**
 * Test to verify terminal session creation is working
 */

const { spawn } = require('child_process');
const path = require('path');

function testSessionCreation() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing terminal session creation...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let testCompleted = false;
    
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
    
    // Test: Try to execute a command with terminal viewer
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
            args: ['Hello Terminal'],
            enableTerminalViewer: true
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 100);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('STDOUT CHUNK:', data.toString());
      
      // Look for the response to our execute_command
      if (stdout.includes('"id":2') && stdout.includes('result')) {
        try {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":2')) {
              const response = JSON.parse(line);
              console.log('📋 Execute command response:', JSON.stringify(response, null, 2));
              
              if (response.result) {
                console.log('✅ Got result from execute_command');
                testCompleted = true;
                server.kill();
                resolve();
                return;
              } else if (response.error) {
                console.log('❌ Got error from execute_command:', response.error);
                testCompleted = true;
                server.kill();
                reject(new Error(`Execute command failed: ${response.error.message}`));
                return;
              }
            }
          }
        } catch (e) {
          console.error('Error parsing response:', e);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('STDERR CHUNK:', data.toString());
    });
    
    server.on('close', (code) => {
      if (!testCompleted) {
        console.error('❌ Session creation test failed');
        console.error('Exit code:', code);
        console.log('Final stdout:', stdout);
        console.log('Final stderr:', stderr);
        reject(new Error('Session creation test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!testCompleted) {
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
  testSessionCreation()
    .then(() => {
      console.log('🎉 Session creation test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Session creation test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testSessionCreation };
