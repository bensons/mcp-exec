#!/usr/bin/env node

/**
 * Final test for exit behavior with proper session ID extraction
 */

const { spawn } = require('child_process');
const path = require('path');

function findAvailablePort(startPort = 4200) {
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

function testExitFinal() {
  return new Promise(async (resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const testPort = await findAvailablePort();
    
    console.log('🔍 Final exit behavior test...');
    console.log(`Test port: ${testPort}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let sessionId = null;
    let exitLogged = false;
    let testResult = null;
    
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
    
    // Step 1: Enable terminal viewer
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
    
    // Step 2: Create terminal session
    setTimeout(() => {
      console.log('📝 Step 1: Creating terminal session...');
      const startTerminalMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'start_terminal_session',
          arguments: {}
        }
      }) + '\n';
      
      server.stdin.write(startTerminalMessage);
    }, 1000);
    
    // Step 3: Send exit command
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Step 2: Sending exit command...');
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
      } else {
        console.log('❌ No session ID found, cannot send exit command');
        testResult = 'FAILED - No session ID';
      }
    }, 3000);
    
    // Step 4: Check status after exit
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Step 3: Checking session status after exit...');
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
    }, 6000);
    
    // Step 5: Cleanup
    setTimeout(() => {
      console.log('📝 Step 4: Test complete, cleaning up...');
      
      if (testResult === null) {
        if (exitLogged) {
          testResult = 'SUCCESS - PTY exit logged';
        } else {
          testResult = 'PARTIAL - No PTY exit logged yet';
        }
      }
      
      console.log(`🎯 TEST RESULT: ${testResult}`);
      server.kill();
      
      if (testResult.startsWith('SUCCESS')) {
        resolve();
      } else {
        reject(new Error(testResult));
      }
    }, 8000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Extract session ID using the correct pattern
      if (output.includes('"id":3') && !sessionId) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":3')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = response.result.content[0].text;
                // Use the URL pattern which is most reliable
                const sessionMatch = content.match(/terminal\/([a-f0-9-]+)\/view/);
                if (sessionMatch) {
                  sessionId = sessionMatch[1];
                  console.log(`✅ Session ID: ${sessionId}`);
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.error('Error extracting session ID:', e);
        }
      }
      
      // Check final status
      if (output.includes('"id":5') && sessionId) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":5')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = JSON.parse(response.result.content[0].text);
                console.log(`📊 FINAL STATUS: ${content.status}`);
                
                if (content.status === 'finished') {
                  console.log('✅ SUCCESS: Session status is finished!');
                  testResult = 'SUCCESS - Session finished correctly';
                } else {
                  console.log(`❌ FAILURE: Session status is '${content.status}', expected 'finished'`);
                  testResult = `FAILED - Status is ${content.status}`;
                }
              }
            }
          }
        } catch (e) {
          console.error('Error parsing final status:', e);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      const output = data.toString();
      
      // Look for PTY exit events
      if (output.includes('PTY process exited')) {
        console.log('🚨 PTY EXIT EVENT:', output.trim());
        exitLogged = true;
      }
      
      if (output.includes('exitCode:') || output.includes('signal:')) {
        console.log('🚨 EXIT DETAILS:', output.trim());
      }
      
      if (output.includes('Setting status to')) {
        console.log('🚨 STATUS CHANGE:', output.trim());
      }
    });
    
    server.on('close', (code) => {
      console.log(`Server closed with code: ${code}`);
    });
    
    server.on('error', (error) => {
      console.error('❌ Error:', error);
      reject(error);
    });
  });
}

// Run the test
if (require.main === module) {
  testExitFinal()
    .then(() => {
      console.log('🎉 Final exit test PASSED!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Final exit test FAILED:', error.message);
      process.exit(1);
    });
}

module.exports = { testExitFinal };
