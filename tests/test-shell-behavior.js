#!/usr/bin/env node

/**
 * Test to understand shell behavior - nested vs direct shell
 */

const { spawn } = require('child_process');
const path = require('path');

function testShellBehavior() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🔍 Testing shell behavior...');
    console.log(`Server path: ${serverPath}`);
    
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
    
    // Test 1: Create a session with NO initial command (just the default shell)
    setTimeout(() => {
      console.log('📝 Creating session with NO initial command...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            enableTerminalViewer: true
            // No command specified - should just start the default shell
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 500);
    
    // Test 2: Send exit command to the shell
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Sending exit command to default shell...');
        const sendInputMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
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
        console.log('❌ No session ID found');
      }
    }, 2000);
    
    // Test 3: Check status
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Checking session status...');
        const statusMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
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
    }, 4000);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      resolve();
    }, 6000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Extract session ID
      if (output.includes('Session ID:') && !sessionId) {
        const match = output.match(/Session ID.*`([^`]+)`/);
        if (match) {
          sessionId = match[1];
          console.log(`✅ Session ID: ${sessionId}`);
        }
      }
      
      // Check responses
      if (output.includes('"id":2')) {
        console.log('📋 Session creation response received');
      }
      
      if (output.includes('"id":3')) {
        console.log('📋 Send input response received');
      }
      
      if (output.includes('"id":4') && sessionId) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":4')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = JSON.parse(response.result.content[0].text);
                console.log(`📊 FINAL STATUS: ${content.status}`);
                console.log(`📊 Command: ${content.command}`);
              }
            }
          }
        } catch (e) {
          // Ignore parse errors
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
      
      // Also log debug info about session creation
      if (output.includes('Creating terminal session')) {
        console.log('🔍 SESSION CREATION:', output.trim());
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
  testShellBehavior()
    .then(() => {
      console.log('🎉 Shell behavior test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Shell behavior test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testShellBehavior };
