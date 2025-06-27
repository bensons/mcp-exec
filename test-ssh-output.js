#!/usr/bin/env node

/**
 * Test to see exactly what the MCP server returns for SSH commands
 */

const { spawn } = require('child_process');
const path = require('path');

async function testSSHOutput() {
  console.log('🧪 Testing SSH output via MCP server...\n');

  const serverPath = path.join(__dirname, 'dist', 'index.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let responses = [];
  server.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const response = JSON.parse(line);
        responses.push(response);
      } catch (e) {
        // Ignore non-JSON lines
      }
    }
  });

  server.stderr.on('data', (data) => {
    console.log('STDERR:', data.toString().trim());
  });

  // Initialize server
  console.log('🚀 Initializing MCP server...');
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ssh-output-test', version: '1.0.0' }
    }
  }) + '\n');

  // Wait for initialization
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test different SSH scenarios
  const tests = [
    {
      name: 'SSH version check',
      command: 'ssh -V'
    },
    {
      name: 'SSH with BatchMode (your command)',
      command: 'ssh -o ConnectTimeout=5 -o BatchMode=yes admin@10.254.130.152 echo test'
    },
    {
      name: 'SSH without BatchMode (interactive)',
      command: 'ssh -o ConnectTimeout=5 admin@10.254.130.152 echo test'
    },
    {
      name: 'SSH with -l flag',
      command: 'ssh -l admin -o ConnectTimeout=5 -o BatchMode=yes 10.254.130.152 echo test'
    }
  ];

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const messageId = i + 2;
    
    console.log(`\n📡 Test ${i + 1}: ${test.name}`);
    console.log(`   Command: ${test.command}`);
    
    server.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          command: test.command,
          timeout: 10000
        }
      }
    }) + '\n');

    // Wait for response
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
      const response = responses.find(r => r.id === messageId);
      if (response) {
        const duration = Date.now() - startTime;
        console.log(`   ⏱️  Response time: ${duration}ms`);
        
        if (response.error) {
          console.log(`   ❌ Error: ${response.error.message}`);
        } else if (response.result && response.result.content) {
          console.log('   ✅ Success: Got formatted output');
          const output = response.result.content[0].text;
          
          // Try to extract the actual command result from the formatted output
          console.log('   📄 Formatted output:');
          console.log('   ' + output.split('\n').slice(0, 10).join('\n   '));
          if (output.split('\n').length > 10) {
            console.log('   ... (truncated)');
          }
        }
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!responses.find(r => r.id === messageId)) {
      console.log('   ⏰ Timeout - no response received');
    }
  }

  server.kill();
  console.log('\n✅ Test completed');
}

if (require.main === module) {
  testSSHOutput().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}
