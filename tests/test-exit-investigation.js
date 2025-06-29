#!/usr/bin/env node

/**
 * Investigation test to see exactly what exit codes/signals we get
 */

const { spawn } = require('child_process');
const path = require('path');

function testExitInvestigation() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🔍 Investigating exit behavior...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let sessionId = null;
    let exitLogged = false;
    
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
    
    // Step 1: Create a bash session
    setTimeout(() => {
      console.log('📝 Step 1: Creating bash session...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
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
    }, 500);
    
    // Step 2: Send exit command
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Step 2: Sending exit command...');
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
        console.log('❌ No session ID found, cannot send exit command');
      }
    }, 2000);
    
    // Step 3: Wait for exit and check status
    setTimeout(() => {
      if (sessionId && exitLogged) {
        console.log('📝 Step 3: Checking final session status...');
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
    
    // Step 4: Cleanup
    setTimeout(() => {
      console.log('📝 Step 4: Test complete, cleaning up...');
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
      
      // Check final status
      if (output.includes('"id":4') && sessionId) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":4')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = JSON.parse(response.result.content[0].text);
                console.log(`📊 FINAL STATUS: ${content.status}`);
                console.log(`📊 Buffer lines: ${content.bufferLines}`);
                console.log(`📊 Recent output: ${JSON.stringify(content.recentOutput)}`);
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
      
      // Print all debug output
      if (output.includes('[DEBUG]')) {
        console.log('🔍 DEBUG:', output.trim());
      }
      
      // Specifically look for PTY exit events
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
  testExitInvestigation()
    .then(() => {
      console.log('🎉 Investigation completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Investigation failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testExitInvestigation };
