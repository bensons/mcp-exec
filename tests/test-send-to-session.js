#!/usr/bin/env node

/**
 * Test to verify send_to_session is working
 */

const { spawn } = require('child_process');
const path = require('path');

function findAvailablePort(startPort = 4100) {
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

function testSendToSession() {
  return new Promise(async (resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const testPort = await findAvailablePort();
    
    console.log('🔍 Testing send_to_session...');
    console.log(`Test port: ${testPort}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
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
    
    // Step 3: Send a simple command (not exit)
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Step 2: Sending echo command...');
        const sendInputMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'send_to_session',
            arguments: {
              sessionId: sessionId,
              input: 'echo "Hello from terminal"'
            }
          }
        }) + '\n';
        
        server.stdin.write(sendInputMessage);
      } else {
        console.log('❌ No session ID found');
      }
    }, 3000);
    
    // Step 4: Read session output
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Step 3: Reading session output...');
        const readOutputMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'read_session_output',
            arguments: {
              sessionId: sessionId
            }
          }
        }) + '\n';
        
        server.stdin.write(readOutputMessage);
      }
    }, 5000);
    
    // Step 5: Send exit command
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Step 4: Sending exit command...');
        const sendExitMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'send_to_session',
            arguments: {
              sessionId: sessionId,
              input: 'exit'
            }
          }
        }) + '\n';
        
        server.stdin.write(sendExitMessage);
      }
    }, 7000);
    
    // Step 6: Check final status
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Step 5: Checking final status...');
        const statusMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
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
    }, 9000);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      resolve();
    }, 11000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Extract session ID
      if (output.includes('"id":3') && !sessionId) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":3')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = response.result.content[0].text;
                const sessionMatch = content.match(/Session ID.*`([^`]+)`/);
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
      
      // Check send_to_session responses
      if (output.includes('"id":4')) {
        console.log('📋 Echo command response received');
      }
      
      if (output.includes('"id":5')) {
        console.log('📋 Read output response received');
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":5')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                console.log('📋 Session output:', response.result.content[0].text.slice(0, 200) + '...');
              }
            }
          }
        } catch (e) {
          // Ignore
        }
      }
      
      if (output.includes('"id":6')) {
        console.log('📋 Exit command response received');
      }
      
      if (output.includes('"id":7')) {
        console.log('📋 Final status response received');
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":7')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = JSON.parse(response.result.content[0].text);
                console.log(`📊 FINAL STATUS: ${content.status}`);
              }
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      const output = data.toString();
      
      // Look for PTY exit events
      if (output.includes('PTY process exited')) {
        console.log('🚨 PTY EXIT EVENT:', output.trim());
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
  testSendToSession()
    .then(() => {
      console.log('🎉 Send to session test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Send to session test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testSendToSession };
