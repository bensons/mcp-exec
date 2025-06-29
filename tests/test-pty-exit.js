#!/usr/bin/env node

/**
 * Test script to verify PTY exit handling
 */

const { spawn } = require('child_process');
const path = require('path');

function testPtyExit() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing PTY exit handling...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let messageId = 1;
    let sessionId = null;
    
    // Send MCP initialization message
    const initMessage = JSON.stringify({
      jsonrpc: '2.0',
      id: messageId++,
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
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      
      // Check if we received a valid MCP response
      try {
        const lines = stdout.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id === 1 && response.result) {
            console.log('✅ Server initialized, starting terminal session...');
            
            // Start a terminal session
            const startSessionMessage = JSON.stringify({
              jsonrpc: '2.0',
              id: messageId++,
              method: 'tools/call',
              params: {
                name: 'execute_command',
                arguments: {
                  command: 'bash',
                  session: 'new',
                  enableTerminalViewer: true
                }
              }
            }) + '\n';
            
            server.stdin.write(startSessionMessage);
          } else if (response.id === 2 && response.result) {
            // Extract session ID from response
            try {
              const content = JSON.parse(response.result.content[0].text);
              sessionId = content.sessionId;
              console.log(`✅ Terminal session started: ${sessionId}`);
              
              // Send exit command
              setTimeout(() => {
                console.log('📤 Sending exit command...');
                const exitMessage = JSON.stringify({
                  jsonrpc: '2.0',
                  id: messageId++,
                  method: 'tools/call',
                  params: {
                    name: 'execute_command',
                    arguments: {
                      command: 'exit',
                      session: sessionId
                    }
                  }
                }) + '\n';
                
                server.stdin.write(exitMessage);
              }, 1000);
            } catch (e) {
              console.error('Failed to parse session response:', e);
            }
          } else if (response.id === 3 && response.result) {
            console.log('✅ Exit command sent, checking session status...');
            
            // Wait a bit then check session status
            setTimeout(() => {
              const readMessage = JSON.stringify({
                jsonrpc: '2.0',
                id: messageId++,
                method: 'tools/call',
                params: {
                  name: 'read_session_output',
                  arguments: {
                    sessionId: sessionId
                  }
                }
              }) + '\n';
              
              server.stdin.write(readMessage);
            }, 2000);
          } else if (response.id === 4 && response.result) {
            // Check final session status
            try {
              const content = JSON.parse(response.result.content[0].text);
              console.log('📊 Final session status:', content.status);
              console.log('📊 Buffer lines:', content.bufferLines);
              console.log('📊 Recent output:', content.recentOutput);
              
              if (content.status === 'finished') {
                console.log('✅ PTY exit handling test PASSED');
                server.kill();
                resolve(true);
              } else {
                console.log('❌ PTY exit handling test FAILED - session still running');
                server.kill();
                resolve(false);
              }
            } catch (e) {
              console.error('Failed to parse final status:', e);
              server.kill();
              resolve(false);
            }
          }
        }
      } catch (e) {
        // Ignore JSON parse errors, continue collecting data
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('close', (code) => {
      if (code !== 0) {
        console.error('Server stderr:', stderr);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
    
    server.on('error', (error) => {
      reject(error);
    });
    
    // Send initial message
    server.stdin.write(initMessage);
    
    // Timeout after 30 seconds
    setTimeout(() => {
      server.kill();
      reject(new Error('Test timed out'));
    }, 30000);
  });
}

// Run the test
testPtyExit()
  .then((success) => {
    if (success) {
      console.log('🎉 PTY exit handling test completed successfully!');
      process.exit(0);
    } else {
      console.log('💥 PTY exit handling test failed');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('💥 PTY exit handling test failed:', error.message);
    process.exit(1);
  });
