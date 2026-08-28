#!/usr/bin/env node

/**
 * Regression tests: session tools must honor the same command policy as execute_command.
 */

const { spawn } = require('child_process');
const path = require('path');

class McpClient {
  constructor() {
    this.server = null;
    this.messageId = 1;
    this.responses = new Map();
    this.buffer = '';
    this.serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
  }

  async start() {
    this.server = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    this.server.stdout.on('data', (data) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.id) {
            this.responses.set(response.id, response);
          }
        } catch {
          // Ignore non-JSON stdout
        }
      }
    });

    this.server.stderr.on('data', () => {
      // Session managers log debug lines to stderr
    });

    await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: 'session-policy-test', version: '1.0.0' },
    });
  }

  async call(method, params) {
    const id = this.messageId++;
    this.server.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }) + '\n');
    return this.waitFor(id);
  }

  async callTool(name, args) {
    const response = await this.call('tools/call', { name, arguments: args });
    const text = response.result?.content?.[0]?.text || '';
    return { response, text };
  }

  waitFor(id, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (this.responses.has(id)) {
          resolve(this.responses.get(id));
          return;
        }
        if (Date.now() - started > timeout) {
          reject(new Error(`Timeout waiting for MCP response ${id}`));
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  stop() {
    if (this.server) {
      this.server.kill();
      this.server = null;
    }
  }
}

function assertBlocked(text, label) {
  if (!text.includes('blocked by security policy')) {
    throw new Error(`${label}: expected security-policy block, got:\n${text}`);
  }
  console.log(`✅ ${label} rejected blocked command`);
}

function extractSessionId(text) {
  const match = text.match(/\*\*Session ID:\*\* `([^`]+)`/);
  if (!match) {
    throw new Error(`Could not extract session ID from:\n${text}`);
  }
  return match[1];
}

async function run() {
  const client = new McpClient();
  let failures = 0;

  try {
    console.log('🧪 Testing session command-policy enforcement...\n');
    await client.start();
    console.log('✅ MCP server initialized\n');

    const blockedCommand = 'rm -rf /';

    console.log('📝 execute_command with enableTerminalViewer rejects blocked commands');
    {
      const { text } = await client.callTool('execute_command', {
        command: blockedCommand,
        enableTerminalViewer: true,
        aiContext: 'Regression: terminal-viewer policy bypass',
      });
      assertBlocked(text, 'execute_command enableTerminalViewer');
    }

    console.log('📝 start_terminal_session rejects blocked commands');
    {
      const { text } = await client.callTool('start_terminal_session', {
        command: blockedCommand,
        aiContext: 'Regression: start_terminal_session policy bypass',
      });
      assertBlocked(text, 'start_terminal_session');
    }

    console.log('📝 start_interactive_session rejects blocked commands');
    {
      const { text } = await client.callTool('start_interactive_session', {
        command: blockedCommand,
        aiContext: 'Regression: start_interactive_session policy bypass',
      });
      assertBlocked(text, 'start_interactive_session');
    }

    console.log('📝 send_to_session rejects blocked commands on a live session');
    {
      const started = await client.callTool('start_interactive_session', {
        command: 'cat',
        aiContext: 'Benign session used to test send_to_session policy',
      });
      if (started.text.includes('blocked by security policy')) {
        throw new Error(`starting cat should be allowed, got:\n${started.text}`);
      }
      const sessionId = extractSessionId(started.text);
      const sent = await client.callTool('send_to_session', {
        sessionId,
        input: blockedCommand,
      });
      assertBlocked(sent.text, 'send_to_session');

      await client.callTool('kill_session', { sessionId }).catch(() => {});
    }

    console.log('📝 allowed execute_command still works');
    {
      const { text } = await client.callTool('execute_command', {
        command: 'echo',
        args: ['policy-ok'],
      });
      if (text.includes('blocked by security policy')) {
        throw new Error(`echo should be allowed, got:\n${text}`);
      }
      if (!text.includes('policy-ok') && !/success|Hello|echo/i.test(text)) {
        // Formatted output still includes the command/result for a simple echo
        if (!text.toLowerCase().includes('echo')) {
          throw new Error(`unexpected execute_command output:\n${text}`);
        }
      }
      console.log('✅ execute_command allows safe commands');
    }

    console.log('\n🎉 Session command-policy regression tests passed');
  } catch (error) {
    failures += 1;
    console.error('💥 Session command-policy tests failed:', error.message);
  } finally {
    client.stop();
  }

  if (failures > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
