#!/usr/bin/env node

/**
 * Debug test to see what exit codes and signals we get
 */

const { spawn } = require('child_process');
const path = require('path');

function findAvailablePort(startPort = 3900) {
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

function testExitDebug() {
  return new Promise(async (resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const testPort = await findAvailablePort();
    
    console.log('🧪 Testing exit debug with enhanced logging...');
    console.log(`Server path: ${serverPath}`);
    console.log(`Test port: ${testPort}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let testCompleted = false;
    let viewerServiceStarted = false;
    let sessionCreated = false;
    
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
    
    // Test 2: Create a simple terminal session that will exit quickly
    setTimeout(() => {
      if (viewerServiceStarted) {
        console.log('Creating terminal session with a command that exits...');
        const executeMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'execute_command',
            arguments: {
              command: 'echo',
              args: ['test'],
              enableTerminalViewer: true
            }
          }
        }) + '\n';
        
        server.stdin.write(executeMessage);
      }
    }, 1000);
    
    // Test 3: Wait a bit then check what happened
    setTimeout(() => {
      if (sessionCreated) {
        console.log('✅ Test completed - check stderr for PTY exit debug info');
        testCompleted = true;
        server.kill();
        resolve();
      }
    }, 3000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      
      // Check if terminal viewer service started
      if (stdout.includes('Terminal viewer service enabled')) {
        viewerServiceStarted = true;
        console.log('✅ Terminal viewer service started successfully');
      }
      
      // Check if session was created
      if (stdout.includes('Terminal Session Started')) {
        sessionCreated = true;
        console.log('✅ Terminal session created');
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      const output = data.toString();
      
      // Check for service startup message
      if (output.includes(`Terminal viewer service started on http://127.0.0.1:${testPort}`)) {
        viewerServiceStarted = true;
        console.log('✅ Terminal viewer HTTP server is running');
      }
      
      // Look for PTY exit debug messages and print them immediately
      if (output.includes('PTY process exited')) {
        console.log('🔍 PTY EXIT DEBUG:', output.trim());
      }
      
      if (output.includes('exitCode:') || output.includes('signal:') || output.includes('Setting status to')) {
        console.log('🔍 EXIT DETAILS:', output.trim());
      }
    });
    
    server.on('close', (code) => {
      if (!testCompleted) {
        console.error('❌ Exit debug test failed or timed out');
        console.error('Exit code:', code);
        console.log('Final stderr (last 1000 chars):', stderr.slice(-1000));
        reject(new Error('Exit debug test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 8 seconds
    setTimeout(() => {
      if (!testCompleted) {
        console.error('❌ Test timed out');
        console.log('Final stderr (last 1000 chars):', stderr.slice(-1000));
        server.kill();
        reject(new Error('Test timed out'));
      }
    }, 8000);
  });
}

// Run the test
if (require.main === module) {
  testExitDebug()
    .then(() => {
      console.log('🎉 Exit debug test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Exit debug test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testExitDebug };
