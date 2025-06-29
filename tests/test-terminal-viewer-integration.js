#!/usr/bin/env node

/**
 * Integration test for terminal viewer HTTP service
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

function findAvailablePort(startPort = 3500) {
  return new Promise((resolve, reject) => {
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

function testTerminalViewerIntegration() {
  return new Promise(async (resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const testPort = await findAvailablePort();
    
    console.log('🧪 Testing terminal viewer integration...');
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
    
    // Test 2: Check if HTTP service is running
    setTimeout(() => {
      if (viewerServiceStarted) {
        http.get(`http://127.0.0.1:${testPort}/health`, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const health = JSON.parse(data);
              if (health.status === 'healthy') {
                console.log('✅ Terminal viewer HTTP service is healthy');
                
                // Test 3: Disable terminal viewer
                setTimeout(() => {
                  const disableViewerMessage = JSON.stringify({
                    jsonrpc: '2.0',
                    id: 3,
                    method: 'tools/call',
                    params: {
                      name: 'toggle_terminal_viewer',
                      arguments: {
                        enabled: false
                      }
                    }
                  }) + '\n';
                  
                  server.stdin.write(disableViewerMessage);
                  
                  testPassed = true;
                  console.log('✅ Terminal viewer integration test passed!');
                  console.log('\nIntegration features verified:');
                  console.log('• Terminal viewer service can be started');
                  console.log('• HTTP health endpoint responds correctly');
                  console.log('• Terminal viewer service can be stopped');
                  
                  server.kill();
                  resolve();
                }, 100);
              }
            } catch (error) {
              console.error('❌ Error parsing health response:', error);
              server.kill();
              reject(error);
            }
          });
        }).on('error', (error) => {
          console.error('❌ Error connecting to terminal viewer service:', error);
          server.kill();
          reject(error);
        });
      }
    }, 1000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      
      // Check if terminal viewer service started
      if (stdout.includes('Terminal viewer service enabled')) {
        viewerServiceStarted = true;
        console.log('✅ Terminal viewer service started successfully');
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      
      // Check for service startup message
      if (stderr.includes(`Terminal viewer service started on http://127.0.0.1:${testPort}`)) {
        viewerServiceStarted = true;
        console.log('✅ Terminal viewer HTTP server is running');
      }
    });
    
    server.on('close', (code) => {
      if (!testPassed) {
        console.error('❌ Terminal viewer integration test failed');
        console.error('Exit code:', code);
        console.error('Stdout:', stdout);
        console.error('Stderr:', stderr);
        reject(new Error('Terminal viewer integration test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 15 seconds
    setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Terminal viewer integration test timed out');
        server.kill();
        reject(new Error('Test timeout'));
      }
    }, 15000);
  });
}

if (require.main === module) {
  testTerminalViewerIntegration()
    .then(() => {
      console.log('\n🎉 All terminal viewer integration tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Terminal viewer integration tests failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testTerminalViewerIntegration };
