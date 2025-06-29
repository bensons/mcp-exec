#!/usr/bin/env node

/**
 * Test script to identify uncaught exceptions in the MCP server
 */

const { spawn } = require('child_process');
const path = require('path');

function testUncaughtExceptions() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing for uncaught exceptions...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let serverStarted = false;
    let exceptionCaught = false;
    
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
    
    // Test 1: Basic initialization
    setTimeout(() => {
      console.log('Sending initialization...');
      server.stdin.write(initMessage);
    }, 100);
    
    // Test 2: Try to trigger terminal viewer functionality
    setTimeout(() => {
      if (serverStarted && !exceptionCaught) {
        console.log('Testing terminal viewer functionality...');
        const executeMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'execute_command',
            arguments: {
              command: 'echo',
              args: ['Testing for exceptions'],
              enableTerminalViewer: true
            }
          }
        }) + '\n';
        
        server.stdin.write(executeMessage);
      }
    }, 500);
    
    // Test 3: Try to enable terminal viewer service
    setTimeout(() => {
      if (serverStarted && !exceptionCaught) {
        console.log('Testing terminal viewer service...');
        const toggleMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'toggle_terminal_viewer',
            arguments: {
              enabled: true,
              port: 3001
            }
          }
        }) + '\n';
        
        server.stdin.write(toggleMessage);
      }
    }, 1000);
    
    server.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      
      if (output.includes('initialize') && !serverStarted) {
        serverStarted = true;
        console.log('✅ Server initialized successfully');
      }
      
      if (output.includes('Terminal Session Created') || 
          output.includes('Terminal viewer service enabled')) {
        console.log('✅ Terminal viewer functionality working');
      }
    });
    
    server.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('STDERR:', output);
      
      // Check for common exception patterns
      if (output.includes('Error:') || 
          output.includes('TypeError:') || 
          output.includes('ReferenceError:') ||
          output.includes('Cannot find module') ||
          output.includes('EADDRINUSE') ||
          output.includes('EACCES')) {
        exceptionCaught = true;
        console.error('❌ Exception detected in stderr:', output);
      }
    });
    
    server.on('close', (code) => {
      console.log(`Server closed with code: ${code}`);
      
      if (code === 0) {
        console.log('✅ Server exited cleanly - no uncaught exceptions detected');
        resolve();
      } else {
        console.error('❌ Server exited with non-zero code, possible exception');
        console.error('Exit code:', code);
        console.error('Stdout:', stdout);
        console.error('Stderr:', stderr);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Gracefully shutdown after 5 seconds
    setTimeout(() => {
      console.log('Sending SIGTERM to server...');
      server.kill('SIGTERM');
    }, 5000);
    
    // Force kill after 8 seconds if still running
    setTimeout(() => {
      if (!server.killed) {
        console.log('Force killing server...');
        server.kill('SIGKILL');
        reject(new Error('Server did not respond to SIGTERM'));
      }
    }, 8000);
  });
}

if (require.main === module) {
  testUncaughtExceptions()
    .then(() => {
      console.log('\n🎉 No uncaught exceptions detected!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Uncaught exception test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testUncaughtExceptions };
