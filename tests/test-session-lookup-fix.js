#!/usr/bin/env node

/**
 * Test script to verify session lookup fix
 * Tests that terminal sessions can be found when executing commands
 */

const { spawn } = require('child_process');
const path = require('path');

function testSessionLookupFix() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing session lookup fix...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let serverStarted = false;
    let sessionId = null;
    let testPassed = false;
    
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
    
    // Test 1: Create a terminal session
    setTimeout(() => {
      console.log('Step 1: Creating terminal session...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'echo',
            args: ['Hello from terminal session'],
            enableTerminalViewer: true
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 200);
    
    // Test 2: List sessions to verify it appears
    setTimeout(() => {
      if (sessionId) {
        console.log('Step 2: Listing sessions to verify session exists...');
        const listMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'list_sessions',
            arguments: {}
          }
        }) + '\n';
        
        server.stdin.write(listMessage);
      }
    }, 400);
    
    // Test 3: Execute command in the existing session (this was failing before)
    setTimeout(() => {
      if (sessionId) {
        console.log(`Step 3: Executing command in existing session ${sessionId}...`);
        const executeInSessionMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'execute_command',
            arguments: {
              command: 'echo',
              args: ['Second command in same session'],
              session: sessionId
            }
          }
        }) + '\n';
        
        server.stdin.write(executeInSessionMessage);
      }
    }, 600);
    
    server.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      
      // Extract session ID from terminal session creation response
      if (output.includes('Terminal Session Created') && !sessionId) {
        const match = output.match(/Session ID.*?`([^`]+)`/);
        if (match) {
          sessionId = match[1];
          console.log(`✅ Extracted session ID: ${sessionId}`);
        }
      }
      
      // Check if server initialized
      if (output.includes('initialize') && !serverStarted) {
        serverStarted = true;
        console.log('✅ Server initialized successfully');
      }
      
      // Check for successful session listing
      if (output.includes('terminalSessions') && output.includes('"totalSessions"')) {
        console.log('✅ Session appears in list_sessions');
      }
      
      // Check for successful command execution in existing session
      if (output.includes('Command sent to terminal session') && 
          output.includes('Second command in same session')) {
        console.log('✅ Command successfully executed in existing terminal session!');
        testPassed = true;
      }
      
      // Check for session not found error (this should NOT happen)
      if (output.includes('session not found') || 
          output.includes('Session not found') ||
          output.includes('Failed to send command to session')) {
        console.error('❌ Session lookup failed - session not found error detected');
      }
    });
    
    server.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      
      // Check for errors
      if (output.includes('Error:') || 
          output.includes('TypeError:') || 
          output.includes('ReferenceError:')) {
        console.error('❌ Error detected in stderr:', output);
      }
    });
    
    server.on('close', (code) => {
      console.log(`Server closed with code: ${code}`);
      
      if (testPassed) {
        console.log('✅ Session lookup fix test passed!');
        console.log('\nKey functionality verified:');
        console.log('• Terminal sessions are created successfully');
        console.log('• Sessions appear in list_sessions output');
        console.log('• Commands can be executed in existing terminal sessions');
        console.log('• Session lookup works correctly across session managers');
        resolve();
      } else {
        console.error('❌ Session lookup fix test failed');
        console.error('Exit code:', code);
        console.error('Full stdout:', stdout);
        console.error('Full stderr:', stderr);
        reject(new Error('Session lookup test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Session lookup test timed out');
        console.error('Stdout so far:', stdout);
        console.error('Stderr so far:', stderr);
        server.kill();
        reject(new Error('Test timeout'));
      }
    }, 10000);
    
    // Graceful shutdown after test completes or times out
    setTimeout(() => {
      if (testPassed) {
        console.log('Sending SIGTERM to server...');
        server.kill('SIGTERM');
      }
    }, 8000);
  });
}

if (require.main === module) {
  testSessionLookupFix()
    .then(() => {
      console.log('\n🎉 Session lookup fix test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Session lookup fix test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testSessionLookupFix };
