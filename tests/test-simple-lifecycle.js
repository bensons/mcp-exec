#!/usr/bin/env node

/**
 * Simple test to verify basic lifecycle functionality
 */

const { spawn } = require('child_process');
const path = require('path');

async function testBasicLifecycle() {
  console.log('🧪 Testing Basic MCP Server Lifecycle\n');

  const serverPath = path.join(__dirname, '..', 'index.js');
  
  console.log('📡 Test: Basic startup and SIGTERM shutdown');
  
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCP_EXEC_INACTIVITY_TIMEOUT: '10000', // 10 seconds
      MCP_EXEC_ENABLE_HEARTBEAT: 'true'
    }
  });

  let stdout = '';
  let stderr = '';

  server.stdout.on('data', (data) => {
    stdout += data.toString();
    console.log('STDOUT:', data.toString().trim());
  });

  server.stderr.on('data', (data) => {
    stderr += data.toString();
    console.log('STDERR:', data.toString().trim());
  });

  // Send initialization message
  setTimeout(() => {
    console.log('📤 Sending initialization message...');
    const initMessage = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'simple-test', version: '1.0.0' }
      }
    }) + '\n';
    
    server.stdin.write(initMessage);
  }, 500);

  // Send a tool call to test activity tracking
  setTimeout(() => {
    console.log('📤 Sending tool call...');
    const toolCall = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_security_status',
        arguments: {}
      }
    }) + '\n';
    
    server.stdin.write(toolCall);
  }, 2000);

  // Send SIGTERM after 5 seconds
  setTimeout(() => {
    console.log('📤 Sending SIGTERM...');
    server.kill('SIGTERM');
  }, 5000);

  server.on('close', (code, signal) => {
    console.log(`\n🏁 Server exited with code: ${code}, signal: ${signal}`);
    console.log('✅ Test completed successfully!');
    process.exit(0);
  });

  server.on('error', (error) => {
    console.error('❌ Server error:', error);
    process.exit(1);
  });

  // Timeout after 15 seconds
  setTimeout(() => {
    console.log('⏰ Test timeout, killing server...');
    server.kill('SIGKILL');
    process.exit(1);
  }, 15000);
}

if (require.main === module) {
  testBasicLifecycle().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}
