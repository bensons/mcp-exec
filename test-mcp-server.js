#!/usr/bin/env node

/**
 * Test script to verify MCP server functionality
 */

const { spawn } = require('child_process');
const path = require('path');

function testMCPServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, 'dist', 'index.js');
    
    console.log('🧪 Testing MCP server functionality...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
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
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      
      // Check if we received a valid MCP response
      try {
        const lines = stdout.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          if (response.id === 1 && response.result) {
            console.log('✅ MCP server responded correctly to initialization');
            console.log('Server capabilities:', JSON.stringify(response.result.capabilities, null, 2));
            testPassed = true;
            server.kill();
            resolve(true);
            return;
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
      if (!testPassed) {
        console.log('❌ MCP server test failed');
        console.log('Exit code:', code);
        console.log('Stdout:', stdout);
        console.log('Stderr:', stderr);
        reject(new Error('MCP server test failed'));
      }
    });
    
    server.on('error', (error) => {
      console.log('❌ Failed to start MCP server:', error.message);
      reject(error);
    });
    
    // Send the initialization message
    setTimeout(() => {
      server.stdin.write(initMessage);
    }, 100);
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (!testPassed) {
        server.kill();
        reject(new Error('MCP server test timed out'));
      }
    }, 5000);
  });
}

async function main() {
  try {
    await testMCPServer();
    console.log('🎉 MCP server test completed successfully!');
    console.log('\n✅ Your mcp-exec server is ready for use with Claude Desktop');
    process.exit(0);
  } catch (error) {
    console.error('❌ MCP server test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { testMCPServer };
