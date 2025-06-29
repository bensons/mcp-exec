#!/usr/bin/env node

/**
 * Test that session functionality works correctly with dedicated session tools
 */

const { spawn } = require('child_process');
const path = require('path');

function testSessionSeparation() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing session separation...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let sessionId = null;
    let testsPassed = 0;
    const totalTests = 3;
    
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
    
    // Test 1: Start interactive session
    setTimeout(() => {
      console.log('📝 Test 1: Starting interactive session...');
      const startSessionMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'start_interactive_session',
          arguments: {
            command: 'bash'
          }
        }
      }) + '\n';
      
      server.stdin.write(startSessionMessage);
    }, 500);
    
    // Test 2: Send command to session
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Test 2: Sending command to session...');
        const sendToSessionMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'send_to_session',
            arguments: {
              sessionId: sessionId,
              input: 'echo "Session test"'
            }
          }
        }) + '\n';
        
        server.stdin.write(sendToSessionMessage);
      } else {
        console.log('❌ No session ID found for Test 2');
      }
    }, 2000);
    
    // Test 3: Read session output
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Test 3: Reading session output...');
        const readOutputMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'read_session_output',
            arguments: {
              sessionId: sessionId
            }
          }
        }) + '\n';
        
        server.stdin.write(readOutputMessage);
      } else {
        console.log('❌ No session ID found for Test 3');
      }
    }, 3500);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      if (sessionId) {
        const killSessionMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'kill_session',
            arguments: {
              sessionId: sessionId
            }
          }
        }) + '\n';
        
        server.stdin.write(killSessionMessage);
      }
      
      setTimeout(() => {
        server.kill();
        
        if (testsPassed === totalTests) {
          resolve();
        } else {
          reject(new Error(`Only ${testsPassed}/${totalTests} tests passed`));
        }
      }, 500);
    }, 5000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Test 1: Extract session ID from start_interactive_session response
      if (output.includes('"id":2') && !sessionId) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":2')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = response.result.content[0].text;
                const sessionMatch = content.match(/session.*?([a-f0-9-]{36})/i);
                if (sessionMatch) {
                  sessionId = sessionMatch[1];
                  console.log(`✅ Test 1 PASSED: Interactive session started with ID: ${sessionId}`);
                  testsPassed++;
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.error('Error extracting session ID:', e);
        }
      }
      
      // Test 2: Check send_to_session response
      if (output.includes('"id":3')) {
        console.log('✅ Test 2 PASSED: Command sent to session successfully');
        testsPassed++;
      }
      
      // Test 3: Check read_session_output response
      if (output.includes('"id":4') && output.includes('Session test')) {
        console.log('✅ Test 3 PASSED: Session output read successfully');
        testsPassed++;
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
  testSessionSeparation()
    .then(() => {
      console.log('🎉 Session separation test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Session separation test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testSessionSeparation };
