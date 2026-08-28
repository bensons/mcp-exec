#!/usr/bin/env node

/**
 * Simple test to verify environment variables work
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { startServer } = require('./test-environment-variables');

/**
 * Issue #38 smoke test: a per-command `env` override, an `export` that is only
 * echoed, and a `cd` buried in a compound command.
 */
async function testContextEnvSimple() {
  console.log('🧪 Simple context env/cwd test...');
  const client = startServer({ MCP_EXEC_SECURITY_LEVEL: 'permissive' });
  try {
    await client.initialize();

    await client.call('execute_command', { command: 'echo hi', env: { MCP_SIMPLE_CI: '1' } });
    await client.call('execute_command', { command: "echo 'export MCP_SIMPLE_FOO=bar'" });
    await client.call('execute_command', { command: 'cd /tmp && ls' });

    const context = await client.call('get_context', {});
    const problems = [];
    if (context.includes('MCP_SIMPLE_CI')) problems.push('per-command env override persisted');
    if (context.includes('MCP_SIMPLE_FOO')) problems.push('echoed export mutated the context');
    if (!/\*\*Working Directory:\*\* `(\/private)?\/tmp`/.test(context)) {
      problems.push(`working directory not tracked: ${context.split('\n').find((l) => l.includes('Working Directory'))}`);
    }
    if (problems.length > 0) {
      throw new Error(problems.join('; '));
    }
    console.log('✅ Per-command env stays scoped, echoed export ignored, cd tracked');
  } finally {
    client.stop();
  }
}

function testEnvSimple() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Simple environment variable test...');
    
    // Set a few key environment variables
    const testEnv = {
      ...process.env,
      // Keep the server's writes out of the repo and the user's home directory
      MCP_EXEC_LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-test-')),
      MCP_EXEC_SESSION_PERSISTENCE: 'false',
      MCP_EXEC_SECURITY_LEVEL: 'strict',
      MCP_EXEC_CONFIRM_DANGEROUS: 'true',
      MCP_EXEC_TIMEOUT: '600000'
    };
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: testEnv
    });
    
    let stdout = '';
    let stderr = '';
    
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
    
    // Test get_security_status
    setTimeout(() => {
      console.log('📝 Getting security status...');
      const getSecurityMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_security_status',
          arguments: {}
        }
      }) + '\n';
      
      server.stdin.write(getSecurityMessage);
    }, 500);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Full stdout:');
      console.log(stdout);
      console.log('📝 Full stderr:');
      console.log(stderr);
      server.kill();
      resolve();
    }, 2000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('error', (error) => {
      console.log('❌ Error starting server:', error);
      reject(error);
    });
  });
}

// Run the test
if (require.main === module) {
  testEnvSimple()
    .then(testContextEnvSimple)
    .then(() => {
      console.log('🎉 Simple env test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Simple env test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testEnvSimple, testContextEnvSimple };
