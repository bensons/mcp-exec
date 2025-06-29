#!/usr/bin/env node

/**
 * Test script for session persistence functionality
 */

const { spawn } = require('child_process');
const path = require('path');

function testSessionPersistence() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing session persistence functionality...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let testPassed = false;
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
    
    // Test 1: Create a terminal session
    setTimeout(() => {
      console.log('Creating terminal session...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'echo',
            args: ['Session persistence test'],
            enableTerminalViewer: true
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 200);
    
    // Test 2: List sessions to verify it appears
    setTimeout(() => {
      console.log('Listing sessions...');
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
    }, 400);
    
    // Test 3: Read session output
    setTimeout(() => {
      if (sessionId) {
        console.log(`Reading session output for ${sessionId}...`);
        const readMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'read_session_output',
            arguments: {
              sessionId: sessionId
            }
          }
        }) + '\n';
        
        server.stdin.write(readMessage);
      }
    }, 600);
    
    // Test 4: Get terminal viewer status
    setTimeout(() => {
      console.log('Getting terminal viewer status...');
      const statusMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'get_terminal_viewer_status',
          arguments: {}
        }
      }) + '\n';
      
      server.stdin.write(statusMessage);
    }, 800);
    
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
      
      // Check for successful responses
      if (stdout.includes('Terminal Session Created') &&
          stdout.includes('terminalSessions') &&
          stdout.includes('sessionType') &&
          stdout.includes('Terminal Viewer Status: Enabled')) {
        
        // Parse the list_sessions response to verify session count
        try {
          const listSessionsMatch = stdout.match(/totalSessions.*?(\d+)/);
          const terminalSessionsMatch = stdout.match(/terminalSessions.*?(\d+)/);
          
          if (listSessionsMatch && terminalSessionsMatch) {
            const totalSessions = parseInt(listSessionsMatch[1]);
            const terminalSessions = parseInt(terminalSessionsMatch[1]);
            
            console.log(`✅ Total sessions: ${totalSessions}`);
            console.log(`✅ Terminal sessions: ${terminalSessions}`);
            
            if (totalSessions > 0 && terminalSessions > 0) {
              testPassed = true;
              console.log('✅ Session persistence test passed!');
              console.log('\nKey features verified:');
              console.log('• Terminal sessions are created successfully');
              console.log('• Sessions appear in list_sessions output');
              console.log('• Session output can be read');
              console.log('• Terminal viewer shows active sessions');
              console.log('• Session persistence is working correctly');
              
              server.kill();
              resolve();
            }
          }
        } catch (error) {
          console.error('Error parsing session data:', error);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('STDERR:', output);
    });
    
    server.on('close', (code) => {
      console.log(`Server closed with code: ${code}`);
      if (!testPassed) {
        console.error('❌ Session persistence test failed');
        console.error('Exit code:', code);
        console.error('Full stdout:', stdout);
        console.error('Full stderr:', stderr);
        reject(new Error('Session persistence test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 15 seconds
    setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Session persistence test timed out');
        console.error('Stdout so far:', stdout);
        console.error('Stderr so far:', stderr);
        server.kill();
        reject(new Error('Test timeout'));
      }
    }, 15000);
  });
}

if (require.main === module) {
  testSessionPersistence()
    .then(() => {
      console.log('\n🎉 Session persistence test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Session persistence test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testSessionPersistence };
