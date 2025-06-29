#!/usr/bin/env node

/**
 * Simple test to send exit command and see what happens
 */

const { spawn } = require('child_process');
const path = require('path');

function testExitDebugSimple() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🔍 Simple exit debug test...');
    
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
    
    // Step 1: Create terminal session
    setTimeout(() => {
      console.log('📝 Creating terminal session...');
      const startTerminalMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'start_terminal_session',
          arguments: {}
        }
      }) + '\n';
      
      server.stdin.write(startTerminalMessage);
    }, 500);
    
    // Step 2: Send exit command
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Sending exit command...');
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
    
    // Step 3: Wait for exit event
    setTimeout(() => {
      console.log('📝 Waiting for PTY exit event...');
    }, 4000);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      console.log('📋 FULL STDERR:');
      console.log(stderr);
      server.kill();
      resolve();
    }, 6000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Extract session ID
      if (output.includes('"id":2') && !sessionId) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":2')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = response.result.content[0].text;
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
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      const output = data.toString();
      
      // Look specifically for PTY exit events
      if (output.includes('PTY process exited')) {
        console.log('🚨 PTY EXIT EVENT DETECTED:', output.trim());
      }
      
      if (output.includes('exitCode:') || output.includes('signal:')) {
        console.log('🚨 EXIT DETAILS:', output.trim());
      }
      
      if (output.includes('Setting status to')) {
        console.log('🚨 STATUS CHANGE:', output.trim());
      }
      
      // Also log sendInput calls
      if (output.includes('sendInput called')) {
        console.log('🔍 SEND INPUT:', output.trim());
      }
      
      if (output.includes('Input sent to PTY')) {
        console.log('🔍 PTY INPUT:', output.trim());
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
  testExitDebugSimple()
    .then(() => {
      console.log('🎉 Simple exit debug test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Simple exit debug test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testExitDebugSimple };
