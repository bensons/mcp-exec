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

async function waitFor(check, label, timeout = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

async function readTerminalOutput(client, sessionId) {
  const { text } = await client.callTool('read_session_output', { sessionId });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`read_session_output did not return JSON:\n${text}`);
  }
}

async function run() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-issue28-'));
  const port = await getFreePort();
  const client = new McpClient({
    MCP_EXEC_SECURITY_LEVEL: 'strict',
    MCP_EXEC_LOG_DIR: logDir,
    MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED: 'false',
    MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'true',
    MCP_EXEC_TERMINAL_VIEWER_PORT: String(port),
  });

  console.log('🧪 Testing that config updates keep running sessions alive (issue #28)...');
  console.log(`   log dir: ${logDir}`);
  console.log(`   terminal viewer port: ${port}\n`);

  try {
    await client.start();
    console.log('✅ MCP server initialized\n');

    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.ok;
    }, 'terminal viewer startup');

    // Replacing security/context/audit services must also rebind the live
    // ShellExecutor. Start permissive, then later reset to the original strict
    // config and verify the same executor observes both policies.
    await client.callTool('update_configuration', {
      section: 'security',
      settings: { level: 'permissive' },
    });
    const permissiveResult = await client.callTool('execute_command', {
      command: 'sudo',
      args: ['--version'],
    });
    if (/blocked by security policy/i.test(permissiveResult.text)) {
      throw new Error(`Live executor did not adopt permissive security config:\n${permissiveResult.text}`);
    }
    console.log('✅ live executor adopted replacement security manager');

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

    // 5. A full reset recreates the security/context/audit services. The
    // executor must retain its session manager but rebind those dependencies.
    const resetResult = await client.callTool('reset_configuration', { section: 'all' });
    if (!resetResult.text.includes('Configuration reset completed')) {
      throw new Error(`Full reset failed:\n${resetResult.text}`);
    }
    await assertStillListed(client, ids, 'after full reset');
    const strictResult = await client.callTool('execute_command', {
      command: 'sudo',
      args: ['--version'],
    });
    if (!/blocked by security policy/i.test(strictResult.text)) {
      throw new Error(`Live executor kept stale permissive security after reset:\n${strictResult.text}`);
    }
    console.log('✅ full reset rebound executor to strict security manager');

    // 6. Restarting the viewer must re-register retained PTYs. Lowering the
    // buffer limit must update and truncate the already-running session.
    for (let i = 0; i < 4; i++) {
      await client.callTool('send_to_session', {
        sessionId: terminalId,
        input: `echo before-viewer-restart-${i}`,
      });
    }
    await waitFor(async () => {
      const output = await readTerminalOutput(client, terminalId);
      return output.bufferLines >= 4 && output;
    }, 'terminal output before viewer restart');

    await client.callTool('update_terminal_viewer', { bufferSize: 2 });
    const truncated = await readTerminalOutput(client, terminalId);
    if (truncated.bufferLines > 2) {
      throw new Error(`Retained PTY buffer was not truncated to 2 lines: ${truncated.bufferLines}`);
    }
    if (!truncated.terminalViewerUrl) {
      throw new Error('Retained PTY lost its viewer URL after viewer restart');
    }

    // Increase the limit again so the echoed command, command output, and
    // prompt all remain available while verifying output after another restart.
    await client.callTool('update_terminal_viewer', { bufferSize: 20 });
    const statusResponse = await fetch(
      `http://127.0.0.1:${port}/api/sessions/${terminalId}/status`
    );
    if (!statusResponse.ok) {
      throw new Error(`Restarted viewer returned HTTP ${statusResponse.status} for retained PTY`);
    }

    const afterRestartMarker = 'after-viewer-restart-marker';
    await client.callTool('send_to_session', {
      sessionId: terminalId,
      input: `echo ${afterRestartMarker}`,
    });
    await waitFor(async () => {
      const output = await readTerminalOutput(client, terminalId);
      if (!output.recentOutput.includes(afterRestartMarker)) {
        throw new Error(JSON.stringify(output));
      }
      return output;
    }, 'terminal output after viewer restart');
    const afterRestart = await readTerminalOutput(client, terminalId);
    if (afterRestart.bufferLines > 20) {
      throw new Error(`Updated PTY buffer limit was not enforced: ${afterRestart.bufferLines}`);
    }
    const markerOccurrences = afterRestart.recentOutput.split(afterRestartMarker).length - 1;
    if (markerOccurrences > 2) {
      throw new Error(`Viewer restart left duplicate PTY listeners (${markerOccurrences} marker copies)`);
    }
    console.log('✅ retained PTY re-registered and live buffer limit applied');

    // 7. Both sessions must still be killable.
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
