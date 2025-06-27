#!/usr/bin/env node

/**
 * Simple SSH test to understand the exact issue
 */

const { spawn } = require('child_process');

async function testSSHDirectly() {
  console.log('🧪 Testing SSH commands directly (without MCP server)...\n');

  // Test 1: SSH version (should work quickly)
  console.log('📡 Test 1: SSH version check');
  await testCommand('ssh', ['-V']);

  // Test 2: SSH to your target with timeout
  console.log('\n📡 Test 2: SSH to target with timeout');
  await testCommand('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', 'admin@10.254.130.152', 'echo', 'test']);

  // Test 3: SSH with -l flag
  console.log('\n📡 Test 3: SSH with -l flag');
  await testCommand('ssh', ['-l', 'admin', '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', '10.254.130.152', 'echo', 'test']);

  // Test 4: Basic ps command for comparison
  console.log('\n📡 Test 4: Basic ps command (should work)');
  await testCommand('ps', ['-aef']);
}

function testCommand(command, args) {
  return new Promise((resolve) => {
    console.log(`   Command: ${command} ${args.join(' ')}`);
    
    const startTime = Date.now();
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      console.log(`   ✅ Completed in ${duration}ms with exit code: ${code}`);
      
      if (stdout) {
        console.log(`   📤 Stdout: ${stdout.slice(0, 200)}${stdout.length > 200 ? '...' : ''}`);
      }
      if (stderr) {
        console.log(`   📥 Stderr: ${stderr.slice(0, 200)}${stderr.length > 200 ? '...' : ''}`);
      }
      
      resolve({ code, stdout, stderr, duration });
    });

    child.on('error', (error) => {
      console.log(`   ❌ Error: ${error.message}`);
      resolve({ error: error.message });
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!child.killed) {
        console.log(`   ⏰ Timeout after 10s, killing process...`);
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 2000);
      }
    }, 10000);
  });
}

async function testSSHViaMCP() {
  console.log('\n\n🧪 Testing SSH via MCP server...\n');

  const serverPath = require('path').join(__dirname, 'dist', 'index.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let serverOutput = '';
  server.stdout.on('data', (data) => {
    serverOutput += data.toString();
  });

  server.stderr.on('data', (data) => {
    console.log('MCP STDERR:', data.toString().trim());
  });

  // Initialize server
  const initMessage = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ssh-test', version: '1.0.0' }
    }
  }) + '\n';

  server.stdin.write(initMessage);

  // Wait for initialization
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test SSH command
  console.log('📡 Testing SSH via MCP...');
  const sshMessage = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'execute_command',
      arguments: {
        command: 'ssh -o ConnectTimeout=5 -o BatchMode=yes admin@10.254.130.152 echo test',
        timeout: 10000
      }
    }
  }) + '\n';

  const startTime = Date.now();
  server.stdin.write(sshMessage);

  // Wait for response or timeout
  await new Promise(resolve => {
    const checkResponse = () => {
      if (serverOutput.includes('"id":2') || Date.now() - startTime > 15000) {
        resolve();
      } else {
        setTimeout(checkResponse, 500);
      }
    };
    checkResponse();
  });

  const duration = Date.now() - startTime;
  console.log(`   ⏱️  MCP response time: ${duration}ms`);
  
  if (serverOutput.includes('"id":2')) {
    console.log('   ✅ Got response from MCP server');
    // Extract the response
    const lines = serverOutput.split('\n');
    const responseLine = lines.find(line => line.includes('"id":2'));
    if (responseLine) {
      try {
        const response = JSON.parse(responseLine);
        if (response.error) {
          console.log(`   ❌ MCP Error: ${response.error.message}`);
        } else if (response.result) {
          console.log('   ✅ MCP Success: Got result');
          console.log(`   📄 Response length: ${JSON.stringify(response.result).length} chars`);
        }
      } catch (e) {
        console.log('   ⚠️  Could not parse MCP response');
      }
    }
  } else {
    console.log('   ⏰ MCP server timeout - no response received');
  }

  server.kill();
}

if (require.main === module) {
  (async () => {
    try {
      await testSSHDirectly();
      await testSSHViaMCP();
    } catch (error) {
      console.error('❌ Test failed:', error);
      process.exit(1);
    }
  })();
}
