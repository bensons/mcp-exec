#!/usr/bin/env node

/**
 * Regression tests: session tools must honor the same command policy as execute_command.
 */

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

class McpClient {
  constructor(extraEnv = {}) {
    this.server = null;
    this.messageId = 1;
    this.responses = new Map();
    this.buffer = '';
    this.stderr = '';
    this.serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    this.extraEnv = extraEnv;
  }

  async start() {
    this.server = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.extraEnv, NODE_ENV: 'test' },
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

    this.server.stderr.on('data', (data) => {
      // Preserve diagnostics without mixing them into JSON-RPC stdout.
      this.stderr += data.toString();
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
          reject(new Error(`Timeout waiting for MCP response ${id}\n${this.stderr.slice(-2000)}`));
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
  let directoryClient;
  let fixtureRoot;
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
        command: process.platform === 'win32' ? 'cmd.exe' : 'sh',
        cwd: process.cwd(),
        aiContext: 'Benign session used to test send_to_session policy',
      });
      if (started.text.includes('blocked by security policy')) {
        throw new Error(`starting shell should be allowed, got:\n${started.text}`);
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

    console.log('📝 regular sessions retain and update their own validated cwd');
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-session-policy-'));
    const initialCwd = path.join(fixtureRoot, 'x');
    const nextCwd = path.join(fixtureRoot, 'y', 'sub');
    const homeOutsideAllowlist = path.join(fixtureRoot, 'home');
    fs.mkdirSync(initialCwd, { recursive: true });
    fs.mkdirSync(nextCwd, { recursive: true });
    fs.mkdirSync(homeOutsideAllowlist, { recursive: true });
    fs.writeFileSync(path.join(initialCwd, 'inside.txt'), 'inside');

    directoryClient = new McpClient({
      MCP_EXEC_ALLOWED_DIRECTORIES: `${initialCwd},${nextCwd}`,
      HOME: homeOutsideAllowlist,
    });
    await directoryClient.start();

    const started = await directoryClient.callTool('start_interactive_session', {
      command: process.platform === 'win32' ? 'cmd.exe' : 'sh',
      cwd: initialCwd,
      aiContext: 'Allowed-directory session cwd regression',
    });
    if (started.text.includes('blocked by security policy')) {
      throw new Error(`starting allowlisted shell should succeed, got:\n${started.text}`);
    }
    const sessionId = extractSessionId(started.text);

    // Move global context away from the session. The session-scoped command is
    // valid only relative to its own cwd and must not hit the old outer guard.
    const contextChange = await directoryClient.callTool('execute_command', {
      command: 'cd',
      args: [nextCwd],
      cwd: initialCwd,
    });
    if (contextChange.text.includes('blocked by security policy')) {
      throw new Error(`allowlisted context change should succeed, got:\n${contextChange.text}`);
    }

    const terminalStarted = await directoryClient.callTool('start_terminal_session', {
      command: 'pwd',
      aiContext: 'Context cwd must be passed through to the PTY',
    });
    if (terminalStarted.text.includes('blocked by security policy')) {
      throw new Error(`terminal session in persisted context cwd should succeed, got:\n${terminalStarted.text}`);
    }
    const terminalSessionId = extractSessionId(terminalStarted.text);
    const listed = await directoryClient.callTool('list_sessions', {});
    const listedPayload = JSON.parse(listed.text);
    const terminalInfo = listedPayload.sessions.find(session => session.sessionId === terminalSessionId);
    if (!terminalInfo) {
      throw new Error(`terminal session ${terminalSessionId} was absent from list_sessions`);
    }
    assert.strictEqual(
      fs.realpathSync(terminalInfo.cwd),
      fs.realpathSync(nextCwd),
      'terminal session should start in the validated persisted context cwd'
    );
    await directoryClient.callTool('kill_session', { sessionId: terminalSessionId }).catch(() => {});

    const sessionScoped = await directoryClient.callTool('send_to_session', {
      sessionId,
      input: 'cat ../x/inside.txt',
    });
    if (sessionScoped.text.includes('blocked by security policy')) {
      throw new Error(`regular session should validate against its own cwd, got:\n${sessionScoped.text}`);
    }

    const moved = await directoryClient.callTool('send_to_session', {
      sessionId,
      input: `cd ${nextCwd}`,
    });
    if (moved.text.includes('blocked by security policy')) {
      throw new Error(`allowlisted session cd should succeed, got:\n${moved.text}`);
    }

    // This operand was valid against the startup cwd, but escapes from the
    // shell's new cwd. A stale-cwd guard would incorrectly allow it.
    const staleCwdBypass = await directoryClient.callTool('send_to_session', {
      sessionId,
      input: 'cat ../x/inside.txt',
    });
    assertBlocked(staleCwdBypass.text, 'send_to_session after cd');

    const bareCd = await directoryClient.callTool('send_to_session', {
      sessionId,
      input: 'cd',
    });
    assertBlocked(bareCd.text, 'bare cd to outside HOME');
    await directoryClient.callTool('kill_session', { sessionId }).catch(() => {});
    console.log('✅ regular session cwd is scoped and updated');

    console.log('\n🎉 Session command-policy regression tests passed');
  } catch {
    failures += 1;
    console.error('💥 Session command-policy tests failed');
  } finally {
    client.stop();
    directoryClient?.stop();
    if (fixtureRoot) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }

  if (failures > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
