#!/usr/bin/env node

/**
 * Final test to verify exit status handling is working correctly
 */

const { spawn } = require('child_process');
const path = require('path');

function findAvailablePort(startPort = 3950) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const server = http.createServer();
    server.listen(startPort, (err) => {
      if (err) {
        // Port is in use, try next one
        server.close();
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        const port = server.address().port;
        server.close();
        resolve(port);
      }
    });
  });
}

function testExitStatusFinal() {
  return new Promise(async (resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const testPort = await findAvailablePort();
    
    console.log('🧪 Testing exit status handling...');
    console.log(`Server path: ${serverPath}`);
    console.log(`Test port: ${testPort}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let testCompleted = false;
    let sessionId = null;
    
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
    
    // Test 1: Enable terminal viewer
    setTimeout(() => {
      const enableViewerMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'toggle_terminal_viewer',
          arguments: {
            enabled: true,
            port: testPort
          }
        }
      }) + '\n';
      
      server.stdin.write(enableViewerMessage);
    }, 100);
    
    // Test 2: Create a bash session
    setTimeout(() => {
      console.log('Creating bash terminal session...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'bash',
            enableTerminalViewer: true
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 1000);
    
    // Test 3: Send exit command to bash
    setTimeout(() => {
      if (sessionId) {
        console.log('Sending exit command to bash session...');
        const sendInputMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'send_to_session',
            arguments: {
              sessionId: sessionId,
              input: 'exit'
            }
          }
        }) + '\n';
        
        server.stdin.write(sendInputMessage);
      }
    }, 3000);
    
    // Test 4: Check session status after exit
    setTimeout(() => {
      if (sessionId) {
        console.log('Checking session status after exit...');
        const statusMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'get_session_info',
            arguments: {
              sessionId: sessionId
            }
          }
        }) + '\n';
        
        server.stdin.write(statusMessage);
      }
    }, 5000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      
      // Extract session ID from terminal session creation
      if (stdout.includes('Terminal Session Started') && !sessionId) {
        try {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('Terminal Session Started')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = response.result.content[0].text;
                const sessionMatch = content.match(/Session ID.*`([^`]+)`/);
                if (sessionMatch) {
                  sessionId = sessionMatch[1];
                  console.log(`✅ Session ID extracted: ${sessionId}`);
                  break;
                }
              }
            }
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      }
      
      // Check final session status
      if (stdout.includes('"id":5') && stdout.includes('status')) {
        try {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":5')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = JSON.parse(response.result.content[0].text);
                console.log(`📊 Final session status: ${content.status}`);
                
                if (content.status === 'finished') {
                  console.log('✅ Exit status test PASSED - session finished correctly');
                  testCompleted = true;
                  server.kill();
                  resolve();
                  return;
                } else {
                  console.log(`❌ Exit status test FAILED - session status is '${content.status}', expected 'finished'`);
                  testCompleted = true;
                  server.kill();
                  reject(new Error(`Session status is '${content.status}', expected 'finished'`));
                  return;
                }
              }
            }
          }
        } catch (e) {
          console.error('Error parsing final status response:', e);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      const output = data.toString();
      
      // Look for PTY exit debug messages and print them immediately
      if (output.includes('PTY process exited')) {
        console.log('🔍 PTY EXIT:', output.trim());
      }
      
      if (output.includes('exitCode:') || output.includes('signal:') || output.includes('Setting status to')) {
        console.log('🔍 EXIT DETAILS:', output.trim());
      }
    });
    
    server.on('close', (code) => {
      if (!testCompleted) {
        console.error('❌ Exit status test failed or timed out');
        console.error('Exit code:', code);
        console.log('Final stderr (last 1000 chars):', stderr.slice(-1000));
        reject(new Error('Exit status test failed'));
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
        console.log('Final stderr (last 1000 chars):', stderr.slice(-1000));
        server.kill();
        reject(new Error('Test timed out'));
      }
    }, 10000);
  });
}

// Run the test
if (require.main === module) {
  testExitStatusFinal()
    .then(() => {
      console.log('🎉 Exit status test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Exit status test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testExitStatusFinal };
