#!/usr/bin/env node

/**
 * Regression test for issue #28.
 *
 * Configuration tools used to construct a brand new TerminalSessionManager /
 * ShellExecutor and drop the old one, which orphaned every running PTY / child
 * process: list_sessions stopped showing it and kill_session said "not found".
 *
 * This test starts a terminal session and an interactive session, changes
 * configuration through update_session_limits, update_output_formatting and
 * update_configuration, and asserts that both sessions are still listed and
 * still killable afterwards.
 */

const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

class McpClient {
  constructor(env) {
    this.env = env;
    this.server = null;
    this.messageId = 1;
    this.responses = new Map();
    this.buffer = '';
    this.serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
  }

  async start() {
    this.server = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.env.MCP_EXEC_LOG_DIR,
      env: { ...process.env, NODE_ENV: 'test', ...this.env },
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
      clientInfo: { name: 'config-update-session-test', version: '1.0.0' },
    });
  }

  async call(method, params) {
    const id = this.messageId++;
    this.server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return this.waitFor(id);
  }

  async callTool(name, args) {
    const response = await this.call('tools/call', { name, arguments: args });
    const text = response.result?.content?.[0]?.text || '';
    return { response, text };
  }

  waitFor(id, timeout = 15000) {
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

function extractSessionId(text) {
  const match = text.match(/\*\*Session ID:\*\* `([^`]+)`/);
  if (!match) {
    throw new Error(`Could not extract session ID from:\n${text}`);
  }
  return match[1];
}

async function listSessionIds(client) {
  const { text } = await client.callTool('list_sessions', {});
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`list_sessions did not return JSON:\n${text}`);
  }
  return parsed.sessions.map((s) => s.sessionId);
}

async function assertStillListed(client, ids, label) {
  const listed = await listSessionIds(client);
  for (const [name, id] of Object.entries(ids)) {
    if (!listed.includes(id)) {
      throw new Error(`${label}: ${name} session ${id} disappeared from list_sessions (listed: ${listed.join(', ') || 'none'})`);
    }
  }
  console.log(`✅ ${label}: both sessions still listed`);
}

async function run() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-issue28-'));
  const port = await getFreePort();
  const client = new McpClient({
    MCP_EXEC_SECURITY_LEVEL: 'permissive',
    MCP_EXEC_LOG_DIR: logDir,
    MCP_EXEC_TERMINAL_VIEWER_PORT: String(port),
  });

  console.log('🧪 Testing that config updates keep running sessions alive (issue #28)...');
  console.log(`   log dir: ${logDir}`);
  console.log(`   terminal viewer port: ${port}\n`);

  try {
    await client.start();
    console.log('✅ MCP server initialized\n');

    // 1. Start one PTY-backed terminal session and one interactive session.
    const terminalId = extractSessionId(
      (await client.callTool('start_terminal_session', { command: 'bash', cwd: logDir })).text
    );
    console.log(`📝 Started terminal session ${terminalId}`);

    const interactiveId = extractSessionId(
      (await client.callTool('start_interactive_session', { command: 'bash', cwd: logDir })).text
    );
    console.log(`📝 Started interactive session ${interactiveId}\n`);

    const ids = { terminal: terminalId, interactive: interactiveId };
    await assertStillListed(client, ids, 'baseline');

    // 2. update_session_limits used to recreate TerminalSessionManager.
    await client.callTool('update_session_limits', { maxInteractiveSessions: 1 });
    await assertStillListed(client, ids, 'after update_session_limits');

    // The live manager must actually see the new limit (not just this.config).
    const { text: limitText } = await client.callTool('start_interactive_session', {
      command: 'bash',
      cwd: logDir,
    });
    if (!limitText.includes('Maximum number of interactive sessions')) {
      throw new Error(`Expected the new maxInteractiveSessions=1 limit to be enforced, got:\n${limitText}`);
    }
    console.log('✅ new session limit applied to the live session manager');

    await client.callTool('update_session_limits', { maxInteractiveSessions: 10 });

    // 3. update_output_formatting used to recreate ShellExecutor (and with it
    //    the InteractiveSessionManager holding every interactive session).
    await client.callTool('update_output_formatting', { stripAnsi: false });
    await assertStillListed(client, ids, 'after update_output_formatting');

    // 4. update_configuration reaches the same code path via reinitializeComponents.
    await client.callTool('update_configuration', {
      section: 'sessions',
      settings: { sessionTimeout: 900000 },
    });
    await assertStillListed(client, ids, 'after update_configuration');

    // 5. Both sessions must still be killable.
    for (const [name, id] of Object.entries(ids)) {
      const { text } = await client.callTool('kill_session', { sessionId: id });
      if (/not found/i.test(text)) {
        throw new Error(`kill_session could not reach the ${name} session ${id}:\n${text}`);
      }
      console.log(`✅ killed ${name} session ${id}`);
    }

    const remaining = await listSessionIds(client);
    const leftovers = Object.values(ids).filter((id) => remaining.includes(id));
    if (leftovers.length > 0) {
      throw new Error(`Sessions still listed after kill_session: ${leftovers.join(', ')}`);
    }
    console.log('✅ both sessions gone after kill_session');

    console.log('\n🎉 Config updates preserve running sessions');
  } finally {
    client.stop();
    try {
      fs.rmSync(logDir, { recursive: true, force: true });
    } catch {
      // The server may still be flushing audit logs; leaving a temp dir behind
      // must not fail the test.
    }
  }
}

run().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
