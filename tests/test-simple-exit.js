#!/usr/bin/env node

/**
 * Simple test to check exit behavior with a command that exits normally
 */

const { spawn } = require('child_process');
const path = require('path');

function findAvailablePort(startPort = 3850) {
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

function testSimpleExit() {
  return new Promise(async (resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const testPort = await findAvailablePort();
    
    console.log('🧪 Testing simple exit behavior...');
    console.log(`Server path: ${serverPath}`);
    console.log(`Test port: ${testPort}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let testPassed = false;
    let viewerServiceStarted = false;
    
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
    
    // Test 2: Run a command that exits normally (echo command)
    setTimeout(() => {
      if (viewerServiceStarted) {
        console.log('Running echo command with terminal viewer...');
        const executeMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'execute_command',
            arguments: {
              command: 'echo',
              args: ['Hello and goodbye'],
              enableTerminalViewer: true
            }
          }
        }) + '\n';
        
        server.stdin.write(executeMessage);
      }
    }, 1000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('STDOUT:', data.toString());
      
      // Check if terminal viewer service started
      if (stdout.includes('Terminal viewer service enabled')) {
        viewerServiceStarted = true;
        console.log('✅ Terminal viewer service started successfully');
      }
      
      // Look for session status in the response
      if (stdout.includes('sessionId') && stdout.includes('status')) {
        try {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('sessionId')) {
              const response = JSON.parse(line);
              if (response.result && response.result.sessionId) {
                console.log(`📊 Session ID: ${response.result.sessionId}`);
                if (response.result.status) {
                  console.log(`📊 Session status: ${response.result.status}`);
                  
                  if (response.result.status === 'finished') {
                    console.log('✅ Simple exit test PASSED - session finished correctly');
                    testPassed = true;
                    server.kill();
                    resolve();
                    return;
                  } else if (response.result.status === 'error') {
                    console.log('❌ Simple exit test FAILED - session status is error');
                    server.kill();
                    reject(new Error('Session status is error'));
                    return;
                  }
                }
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
      console.log('STDERR:', data.toString());
      
      // Check for service startup message
      if (stderr.includes(`Terminal viewer service started on http://127.0.0.1:${testPort}`)) {
        viewerServiceStarted = true;
        console.log('✅ Terminal viewer HTTP server is running');
      }
      
      // Look for PTY exit debug messages
      if (stderr.includes('PTY process exited')) {
        console.log('🔍 PTY exit detected:', data.toString().trim());
      }
    });
    
    server.on('close', (code) => {
      if (!testPassed) {
        console.error('❌ Simple exit test failed');
        console.error('Exit code:', code);
        reject(new Error('Simple exit test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 8 seconds
    setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Test timed out');
        server.kill();
        reject(new Error('Test timed out'));
      }
    }, 8000);
  });
}

// Run the test
if (require.main === module) {
  testSimpleExit()
    .then(() => {
      console.log('🎉 Simple exit test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Simple exit test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testSimpleExit };
