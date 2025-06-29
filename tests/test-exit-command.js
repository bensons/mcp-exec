#!/usr/bin/env node

/**
 * Test script to verify exit command behavior in terminal viewer
 */

const { spawn } = require('child_process');
const path = require('path');

function findAvailablePort(startPort = 3800) {
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

function testExitCommand() {
  return new Promise(async (resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const testPort = await findAvailablePort();
    
    console.log('🧪 Testing exit command behavior...');
    console.log(`Server path: ${serverPath}`);
    console.log(`Test port: ${testPort}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let testPassed = false;
    let viewerServiceStarted = false;
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
    
    // Test 2: Start a shell session
    setTimeout(() => {
      if (viewerServiceStarted) {
        console.log('Starting shell session...');
        const executeMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'execute_command',
            arguments: {
              command: 'bash',
              args: [],
              enableTerminalViewer: true
            }
          }
        }) + '\n';
        
        server.stdin.write(executeMessage);
      }
    }, 1000);
    
    // Test 3: Send exit command to the shell
    setTimeout(() => {
      if (sessionId) {
        console.log('Sending exit command...');
        const sendInputMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'send_input',
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
      
      // Check if terminal viewer service started
      if (stdout.includes('Terminal viewer service enabled')) {
        viewerServiceStarted = true;
        console.log('✅ Terminal viewer service started successfully');
      }
      
      // Extract session ID from response
      if (stdout.includes('sessionId') && !sessionId) {
        try {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{')) {
              const response = JSON.parse(line);
              if (response.result && response.result.sessionId) {
                sessionId = response.result.sessionId;
                console.log(`✅ Session ID extracted: ${sessionId}`);
                break;
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
                  console.log('✅ Exit command test PASSED - session finished correctly');
                  testPassed = true;
                } else {
                  console.log(`❌ Exit command test FAILED - session status is '${content.status}', expected 'finished'`);
                }
                
                server.kill();
                if (testPassed) {
                  resolve();
                } else {
                  reject(new Error(`Session status is '${content.status}', expected 'finished'`));
                }
                return;
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
      
      // Check for service startup message
      if (stderr.includes(`Terminal viewer service started on http://127.0.0.1:${testPort}`)) {
        viewerServiceStarted = true;
        console.log('✅ Terminal viewer HTTP server is running');
      }
      
      // Look for PTY exit debug messages
      if (stderr.includes('PTY process exited')) {
        console.log('🔍 PTY exit detected in stderr:', data.toString().trim());
      }
    });
    
    server.on('close', (code) => {
      if (!testPassed) {
        console.error('❌ Exit command test failed');
        console.error('Exit code:', code);
        console.error('Stdout:', stdout);
        console.error('Stderr:', stderr);
        reject(new Error('Exit command test failed'));
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
  testExitCommand()
    .then(() => {
      console.log('🎉 Exit command test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Exit command test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testExitCommand };
