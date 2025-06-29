#!/usr/bin/env node

/**
 * Test script to verify static files are served with correct MIME types
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

function findAvailablePort(startPort = 3600) {
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

function testStaticFiles() {
  return new Promise(async (resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const testPort = await findAvailablePort();
    
    console.log('🧪 Testing static file serving with correct MIME types...');
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
    
    // Test 2: Check static files after service starts
    setTimeout(() => {
      if (viewerServiceStarted) {
        console.log('Testing static file MIME types...');
        
        // Test CSS file
        const cssRequest = http.get(`http://127.0.0.1:${testPort}/static/styles.css`, (res) => {
          console.log(`CSS file status: ${res.statusCode}`);
          console.log(`CSS file content-type: ${res.headers['content-type']}`);
          
          if (res.statusCode === 200 && res.headers['content-type'] && 
              res.headers['content-type'].includes('text/css')) {
            console.log('✅ CSS file served with correct MIME type');
            
            // Test JS file
            const jsRequest = http.get(`http://127.0.0.1:${testPort}/static/terminal.js`, (res) => {
              console.log(`JS file status: ${res.statusCode}`);
              console.log(`JS file content-type: ${res.headers['content-type']}`);
              
              if (res.statusCode === 200 && res.headers['content-type'] && 
                  (res.headers['content-type'].includes('application/javascript') ||
                   res.headers['content-type'].includes('text/javascript'))) {
                console.log('✅ JS file served with correct MIME type');
                testPassed = true;
                console.log('✅ Static file MIME type test passed!');
                console.log('\nStatic file features verified:');
                console.log('• CSS files served with text/css MIME type');
                console.log('• JS files served with correct JavaScript MIME type');
                console.log('• Static files are accessible via HTTP');
                
                server.kill();
                resolve();
              } else {
                console.error('❌ JS file not served with correct MIME type');
                server.kill();
                reject(new Error('JS file MIME type incorrect'));
              }
            }).on('error', (error) => {
              console.error('❌ Error requesting JS file:', error);
              server.kill();
              reject(error);
            });
          } else {
            console.error('❌ CSS file not served with correct MIME type');
            console.error(`Expected: text/css, Got: ${res.headers['content-type']}`);
            server.kill();
            reject(new Error('CSS file MIME type incorrect'));
          }
        }).on('error', (error) => {
          console.error('❌ Error requesting CSS file:', error);
          server.kill();
          reject(error);
        });
      }
    }, 2000);
    
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
        console.error('❌ Static file MIME type test failed');
        console.error('Exit code:', code);
        console.error('Stdout:', stdout);
        console.error('Stderr:', stderr);
        reject(new Error('Static file MIME type test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!testPassed) {
        console.error('❌ Test timed out');
        server.kill();
        reject(new Error('Test timed out'));
      }
    }, 10000);
  });
}

// Run the test
if (require.main === module) {
  testStaticFiles()
    .then(() => {
      console.log('🎉 Static file MIME type test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Static file MIME type test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testStaticFiles };
