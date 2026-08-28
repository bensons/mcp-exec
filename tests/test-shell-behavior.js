#!/usr/bin/env node

/**
 * Test to understand shell behavior - nested vs direct shell
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Everything the server writes (audit log, .mcp-exec-session.json) stays in a
// throwaway directory so concurrent runs never collide.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-shell-'));
const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');

function testShellBehavior() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🔍 Testing shell behavior...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: TMP_DIR,
      env: { ...process.env, MCP_EXEC_LOG_DIR: TMP_DIR },
    });
    
    let stdout = '';
    let stderr = '';
    let sessionId = null;
    
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
    
    // Test 1: Create a session with NO initial command (just the default shell)
    setTimeout(() => {
      console.log('📝 Creating session with NO initial command...');
      const executeMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'execute_command',
          arguments: {
            enableTerminalViewer: true
            // No command specified - should just start the default shell
          }
        }
      }) + '\n';
      
      server.stdin.write(executeMessage);
    }, 500);
    
    // Test 2: Send exit command to the shell
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Sending exit command to default shell...');
        const sendInputMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'send_to_session',
            arguments: {
              sessionId: sessionId,
              input: 'exit'
            }
          }
        }) + '\n';
        
        server.stdin.write(sendInputMessage);
      } else {
        console.log('❌ No session ID found');
      }
    }, 2000);
    
    // Test 3: Check status
    setTimeout(() => {
      if (sessionId) {
        console.log('📝 Checking session status...');
        const statusMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'get_session_info',
            arguments: {
              sessionId: sessionId
            }
          }
        }) + '\n';
        
        server.stdin.write(statusMessage);
      }
    }, 4000);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      resolve();
    }, 6000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Extract session ID
      if (output.includes('Session ID:') && !sessionId) {
        const match = output.match(/Session ID.*`([^`]+)`/);
        if (match) {
          sessionId = match[1];
          console.log(`✅ Session ID: ${sessionId}`);
        }
      }
      
      // Check responses
      if (output.includes('"id":2')) {
        console.log('📋 Session creation response received');
      }
      
      if (output.includes('"id":3')) {
        console.log('📋 Send input response received');
      }
      
      if (output.includes('"id":4') && sessionId) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":4')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                const content = JSON.parse(response.result.content[0].text);
                console.log(`📊 FINAL STATUS: ${content.status}`);
                console.log(`📊 Command: ${content.command}`);
              }
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
      const output = data.toString();
      
      // Look for PTY exit events
      if (output.includes('PTY process exited')) {
        console.log('🚨 PTY EXIT EVENT:', output.trim());
      }
      
      if (output.includes('exitCode:') || output.includes('signal:')) {
        console.log('🚨 EXIT DETAILS:', output.trim());
      }
      
      if (output.includes('Setting status to')) {
        console.log('🚨 STATUS CHANGE:', output.trim());
      }
      
      // Also log debug info about session creation
      if (output.includes('Creating terminal session')) {
        console.log('🔍 SESSION CREATION:', output.trim());
      }
    });
    
    server.on('close', (code) => {
      console.log(`Server closed with code: ${code}`);
    });
    
    server.on('error', (error) => {
      console.error('❌ Error:', error);
      reject(error);
    });
  });
}

/**
 * Minimal JSON-RPC-over-stdio client for the built server.
 */
function startServer() {
  const server = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: TMP_DIR,
    env: { ...process.env, MCP_EXEC_LOG_DIR: TMP_DIR },
  });

  let nextId = 1;
  let buffer = '';
  const pending = new Map();

  server.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (e) {
        continue;
      }
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for response to ${method}`));
    }, 20000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  const callTool = async (name, args) => {
    const response = await request('tools/call', { name, arguments: args });
    if (response.error) {
      return response.error.message || JSON.stringify(response.error);
    }
    return response.result.content.map((part) => part.text).join('\n');
  };

  return { server, request, callTool, close: () => server.kill() };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Regression tests for issue #39: the `shell` option must actually be honoured.
 */
async function testShellOption() {
  console.log('\n🔍 Testing the `shell` option (issue #39)...');
  const client = startServer();
  const failures = [];
  const check = (name, condition, detail) => {
    if (condition) {
      console.log(`✅ ${name}`);
    } else {
      console.log(`❌ ${name}\n   ${detail}`);
      failures.push(name);
    }
  };

  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'shell-option-test', version: '1.0.0' },
    });

    // 1. A named shell must be used, not coerced to the platform default.
    if (fs.existsSync('/bin/zsh')) {
      const start = await client.callTool('start_interactive_session', {
        command: 'echo $0',
        shell: '/bin/zsh',
      });
      const match = start.match(/Session ID:\*\* `([^`]+)`/);
      check('start_interactive_session accepted shell:"/bin/zsh"', !!match, start.slice(0, 300));
      if (match) {
        await sleep(1500);
        const output = await client.callTool('read_session_output', { sessionId: match[1] });
        check(
          'session started with shell:"/bin/zsh" reports zsh',
          /zsh/.test(output),
          output.slice(0, 300)
        );
      }
    } else {
      console.log('⏭️  /bin/zsh not present - skipping named-shell assertion');
    }

    // 2. shell:false must spawn the command directly, keeping args intact.
    // The brackets keep this distinct from the echoed input line in the formatted
    // output: through a shell the args split into "[a]" and "[b]".
    const direct = await client.callTool('execute_command', {
      command: 'printf',
      args: ['[%s]\n', 'a b'],
      shell: false,
    });
    check(
      'shell:false passes an argument containing spaces as one argument',
      /\[a b\]/.test(direct) && !/\[a\]/.test(direct),
      direct.slice(0, 400)
    );

    // 3. A shell string is validated before it reaches spawn.
    const rejected = await client.callTool('execute_command', {
      command: 'echo hi',
      shell: 'rm -rf /',
    });
    check(
      'a shell string carrying arguments is rejected',
      /Invalid shell/.test(rejected),
      rejected.slice(0, 400)
    );
  } finally {
    client.close();
  }

  if (failures.length > 0) {
    throw new Error(`shell option tests failed: ${failures.join(', ')}`);
  }
}

// Run the tests
if (require.main === module) {
  testShellBehavior()
    .then(() => {
      console.log('🎉 Shell behavior test completed!');
      return testShellOption();
    })
    .then(() => {
      console.log('🎉 Shell option tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Shell behavior test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testShellBehavior, testShellOption };
