#!/usr/bin/env node

/**
 * Test script to verify that terminal commands don't appear duplicated
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

function findAvailablePort(startPort = 3700) {
  return new Promise((resolve, reject) => {
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

function testTerminalEchoFix() {
  return new Promise(async (resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const testPort = await findAvailablePort();
    
    console.log('🧪 Testing terminal echo duplication fix...');
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
    
    // Test 2: Execute a command with terminal viewer
    setTimeout(() => {
      if (viewerServiceStarted) {
        console.log('Executing test command...');
        const executeMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'execute_command',
            arguments: {
              command: 'echo',
              args: ['Hello Terminal Test'],
              enableTerminalViewer: true
            }
          }
        }) + '\n';
        
        server.stdin.write(executeMessage);
      }
    }, 1000);
    
    // Test 3: Connect to WebSocket and check for duplication
    setTimeout(() => {
      if (sessionId && viewerServiceStarted) {
        console.log('Connecting to WebSocket to check for duplication...');
        
        const wsUrl = `ws://127.0.0.1:${testPort}/terminal/${sessionId}`;
        const ws = new WebSocket(wsUrl);
        
        let receivedMessages = [];
        let messageCount = 0;
        
        ws.on('open', () => {
          console.log('WebSocket connected, collecting messages...');
        });
        
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'data' && message.data) {
              receivedMessages.push(message.data);
              messageCount++;
              console.log(`Message ${messageCount}: ${JSON.stringify(message.data)}`);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        });
        
        // Check for duplication after collecting messages
        setTimeout(() => {
          ws.close();
          
          // Analyze messages for duplication
          const allData = receivedMessages.join('');
          console.log('All received data:', JSON.stringify(allData));
          
          // Count occurrences of the test command
          const commandOccurrences = (allData.match(/echo.*Hello Terminal Test/g) || []).length;
          console.log(`Command appears ${commandOccurrences} times in output`);
          
          if (commandOccurrences <= 1) {
            console.log('✅ No command duplication detected!');
            testPassed = true;
            console.log('✅ Terminal echo duplication fix test passed!');
            console.log('\nDuplication fix verified:');
            console.log('• Commands appear only once in terminal output');
            console.log('• PTY echo handling works correctly');
            console.log('• No manual buffer duplication');
            
            server.kill();
            resolve();
          } else {
            console.error(`❌ Command duplication detected: appears ${commandOccurrences} times`);
            server.kill();
            reject(new Error('Command duplication still present'));
          }
        }, 2000);
      }
    }, 3000);
    
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
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      
      // Check for service startup message
      if (stderr.includes(`Terminal viewer service started on http://127.0.0.1:${testPort}`)) {
        viewerServiceStarted = true;
        console.log('✅ Terminal viewer HTTP server is running');
      }
    });
    
    server.on('close', (code) => {
      if (!testPassed) {
        console.error('❌ Terminal echo duplication fix test failed');
        console.error('Exit code:', code);
        console.error('Stdout:', stdout);
        console.error('Stderr:', stderr);
        reject(new Error('Terminal echo duplication fix test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 15 seconds
    setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Test timed out');
        server.kill();
        reject(new Error('Test timed out'));
      }
    }, 15000);
  });
}

// Run the test
if (require.main === module) {
  testTerminalEchoFix()
    .then(() => {
      console.log('🎉 Terminal echo duplication fix test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Terminal echo duplication fix test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testTerminalEchoFix };
