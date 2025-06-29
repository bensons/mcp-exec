#!/usr/bin/env node

/**
 * Test script to verify enhanced debug logging
 */

const { spawn } = require('child_process');
const path = require('path');

function testDebugLogging() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing enhanced debug logging...');
    console.log(`Server path: ${serverPath}`);
    
    // Set debug logging level
    const env = {
      ...process.env,
      MCP_EXEC_AUDIT_LOG_LEVEL: 'debug',
      MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'true',
      MCP_EXEC_TERMINAL_VIEWER_PORT: '3003'
    };
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env
    });
    
    let stdout = '';
    let stderr = '';
    let debugMessages = [];
    
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
    
    // Test 1: Create a terminal session (should generate lots of debug logs)
    setTimeout(() => {
      console.log('Creating terminal session to test debug logging...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            command: 'echo',
            args: ['Debug logging test'],
            enableTerminalViewer: true
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 200);
    
    // Test 2: List sessions
    setTimeout(() => {
      console.log('Listing sessions to test debug logging...');
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
    
    server.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      
      // Look for debug messages in stdout
      if (output.includes('[DEBUG]')) {
        const lines = output.split('\n').filter(line => line.includes('[DEBUG]'));
        debugMessages.push(...lines);
        console.log('📝 Debug messages found in stdout:', lines.length);
      }
    });
    
    server.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      
      // Look for debug messages in stderr
      if (output.includes('[DEBUG]')) {
        const lines = output.split('\n').filter(line => line.includes('[DEBUG]'));
        debugMessages.push(...lines);
        console.log('📝 Debug messages found in stderr:', lines.length);
      }
    });
    
    server.on('close', (code) => {
      console.log(`Server closed with code: ${code}`);
      
      // Analyze debug messages
      console.log(`\n📊 Debug Logging Analysis:`);
      console.log(`Total debug messages: ${debugMessages.length}`);
      
      const categories = {
        initialization: debugMessages.filter(msg => msg.includes('initialized') || msg.includes('components')).length,
        terminalSession: debugMessages.filter(msg => msg.includes('TerminalSessionManager')).length,
        terminalViewer: debugMessages.filter(msg => msg.includes('TerminalViewerService')).length,
        shellExecutor: debugMessages.filter(msg => msg.includes('ShellExecutor')).length,
        sessionLookup: debugMessages.filter(msg => msg.includes('session') && msg.includes('lookup')).length,
        commandExecution: debugMessages.filter(msg => msg.includes('Execute command')).length,
      };
      
      console.log(`\n📋 Debug Message Categories:`);
      Object.entries(categories).forEach(([category, count]) => {
        console.log(`  ${category}: ${count} messages`);
      });
      
      // Show sample debug messages
      if (debugMessages.length > 0) {
        console.log(`\n📄 Sample Debug Messages:`);
        debugMessages.slice(0, 5).forEach((msg, i) => {
          console.log(`  ${i + 1}. ${msg.trim()}`);
        });
        
        if (debugMessages.length > 5) {
          console.log(`  ... and ${debugMessages.length - 5} more`);
        }
      }
      
      // Check if we have sufficient debug coverage
      const hasInitDebug = categories.initialization > 0;
      const hasTerminalDebug = categories.terminalSession > 0 || categories.terminalViewer > 0;
      const hasExecutionDebug = categories.commandExecution > 0;
      
      if (hasInitDebug && hasTerminalDebug && hasExecutionDebug && debugMessages.length >= 10) {
        console.log('\n✅ Enhanced debug logging test passed!');
        console.log('Key areas covered:');
        console.log('• Server initialization debug messages');
        console.log('• Terminal session/viewer debug messages');
        console.log('• Command execution debug messages');
        console.log(`• Total debug messages: ${debugMessages.length}`);
        resolve();
      } else {
        console.error('\n❌ Enhanced debug logging test failed');
        console.error(`Debug message count: ${debugMessages.length} (expected >= 10)`);
        console.error(`Has init debug: ${hasInitDebug}`);
        console.error(`Has terminal debug: ${hasTerminalDebug}`);
        console.error(`Has execution debug: ${hasExecutionDebug}`);
        reject(new Error('Insufficient debug logging coverage'));
      }
    });
    
    server.on('error', (error) => {
      console.error('❌ Error starting server:', error);
      reject(error);
    });
    
    // Graceful shutdown after 5 seconds
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
  testDebugLogging()
    .then(() => {
      console.log('\n🎉 Enhanced debug logging test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Enhanced debug logging test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testDebugLogging };
