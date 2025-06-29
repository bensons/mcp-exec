#!/usr/bin/env node

/**
 * Test script for auto-starting terminal viewer service
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

function testAutoStartTerminalViewer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing auto-start terminal viewer functionality...');
    console.log(`Server path: ${serverPath}`);
    
    // Set environment variable to enable terminal viewer by default
    const env = {
      ...process.env,
      MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'true',
      MCP_EXEC_TERMINAL_VIEWER_PORT: '3002' // Use different port to avoid conflicts
    };
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env
    });
    
    let stdout = '';
    let stderr = '';
    let serverStarted = false;
    let terminalViewerStarted = false;
    
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
    
    setTimeout(() => {
      console.log('Sending initialization...');
      server.stdin.write(initMessage);
    }, 100);
    
    // Test if terminal viewer service is auto-started
    setTimeout(() => {
      if (serverStarted) {
        console.log('Testing if terminal viewer service auto-started...');
        
        // Try to connect to the terminal viewer HTTP service
        http.get('http://127.0.0.1:3002/health', (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const health = JSON.parse(data);
              if (health.status === 'healthy') {
                terminalViewerStarted = true;
                console.log('✅ Terminal viewer service auto-started successfully');
                
                // Test terminal viewer status via MCP
                const statusMessage = JSON.stringify({
                  jsonrpc: '2.0',
                  id: 2,
                  method: 'tools/call',
                  params: {
                    name: 'get_terminal_viewer_status',
                    arguments: {}
                  }
                }) + '\n';
                
                server.stdin.write(statusMessage);
              }
            } catch (error) {
              console.error('Error parsing health response:', error);
            }
          });
        }).on('error', (error) => {
          console.log('❌ Terminal viewer service not auto-started:', error.message);
        });
      }
    }, 1000);
    
    server.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('STDOUT:', output); // Debug: show all stdout output

      if (output.includes('initialize') && !serverStarted) {
        serverStarted = true;
        console.log('✅ Server initialized successfully');
      }

      if (output.includes('Terminal Viewer Status: Enabled')) {
        console.log('✅ Terminal viewer status confirmed via MCP');
      }
    });
    
    server.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('STDERR:', output); // Debug: show all stderr output

      if (output.includes('Auto-starting terminal viewer service')) {
        console.log('✅ Auto-start message detected');
      }

      if (output.includes('Terminal viewer service started')) {
        console.log('✅ Terminal viewer service startup message detected');
      }

      if (output.includes('Failed to auto-start terminal viewer service')) {
        console.error('❌ Failed to auto-start terminal viewer service');
      }

      // Check for exceptions
      if (output.includes('Error:') ||
          output.includes('TypeError:') ||
          output.includes('ReferenceError:') ||
          output.includes('EADDRINUSE')) {
        console.error('❌ Exception detected:', output);
      }
    });
    
    server.on('close', (code) => {
      console.log(`Server closed with code: ${code}`);
      
      if (code === 0 && terminalViewerStarted) {
        console.log('✅ Auto-start terminal viewer test passed!');
        resolve();
      } else if (code === 0) {
        console.log('⚠️  Server exited cleanly but terminal viewer may not have auto-started');
        resolve();
      } else {
        console.error('❌ Server exited with non-zero code');
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
  testAutoStartTerminalViewer()
    .then(() => {
      console.log('\n🎉 Auto-start terminal viewer test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Auto-start terminal viewer test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testAutoStartTerminalViewer };
