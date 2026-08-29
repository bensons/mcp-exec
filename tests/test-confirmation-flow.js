#!/usr/bin/env node

/**
 * Regression tests for the interactive confirmation flow (issue #35).
 *
 * With confirmDangerous enabled, a dangerous command must be parked as a
 * pending confirmation, be listed by get_pending_confirmations, execute for
 * real on confirm_command, and fail when the same id is confirmed twice.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Matches a dangerous pattern (/shutdown/) but is completely harmless.
const DANGEROUS_COMMAND = 'echo';
const DANGEROUS_ARGS = ['shutdown-confirmation-marker'];

class McpClient {
  constructor(logDir) {
    this.server = null;
    this.messageId = 1;
    this.responses = new Map();
    this.buffer = '';
    this.logDir = logDir;
    this.serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
  }

  async start() {
    this.server = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.logDir, // keep .mcp-exec-session.json out of the repo
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MCP_EXEC_CONFIRM_DANGEROUS: 'true',
        MCP_EXEC_SECURITY_LEVEL: 'permissive',
        MCP_EXEC_LOG_DIR: this.logDir,
        MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED: 'false',
        MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'false',
      },
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
      // Server logs debug lines to stderr
    });

    await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: 'confirmation-flow-test', version: '1.0.0' },
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

function extractConfirmationId(text) {
  const match = text.match(/\*\*Confirmation ID:\*\* `([^`]+)`/);
  assert.ok(match, `Could not extract confirmation ID from:\n${text}`);
  return match[1];
}

async function run() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-confirm-'));
  const client = new McpClient(logDir);

  try {
    console.log('🧪 Testing interactive confirmation flow...\n');
    await client.start();
    console.log('✅ MCP server initialized\n');

    console.log('📝 dangerous command returns a confirmation id instead of running');
    const requested = await client.callTool('execute_command', {
      command: DANGEROUS_COMMAND,
      args: DANGEROUS_ARGS,
      aiContext: 'Issue #35: confirmation flow',
    });
    assert.ok(
      requested.text.includes('Command requires confirmation'),
      `expected a confirmation request, got:\n${requested.text}`
    );
    assert.ok(
      !requested.text.includes('blocked by security policy'),
      `command should be parked, not blocked:\n${requested.text}`
    );
    const confirmationId = extractConfirmationId(requested.text);
    console.log(`✅ confirmation id issued: ${confirmationId}`);

    console.log('📝 get_pending_confirmations lists the pending command');
    const pending = await client.callTool('get_pending_confirmations', {});
    const pendingJson = JSON.parse(pending.text);
    assert.strictEqual(pendingJson.count, 1, `expected 1 pending confirmation:\n${pending.text}`);
    const entry = pendingJson.pendingConfirmations[0];
    assert.strictEqual(entry.id, confirmationId);
    assert.strictEqual(entry.command, `${DANGEROUS_COMMAND} ${DANGEROUS_ARGS.join(' ')}`);
    assert.ok(entry.riskLevel, 'pending entry should carry a risk level');
    console.log('✅ pending confirmation listed');

    console.log('📝 confirm_command executes it and returns real output');
    const confirmed = await client.callTool('confirm_command', { confirmationId });
    assert.ok(
      confirmed.text.includes('Confirmed:'),
      `expected a confirmed execution, got:\n${confirmed.text}`
    );
    assert.ok(
      confirmed.text.includes(DANGEROUS_ARGS[0]),
      `expected real command output in:\n${confirmed.text}`
    );
    assert.ok(
      !confirmed.text.includes('blocked by security policy'),
      `confirmed command should not be blocked:\n${confirmed.text}`
    );
    console.log('✅ confirmed command executed');

    console.log('📝 re-confirming the same id fails');
    const replay = await client.callTool('confirm_command', { confirmationId });
    const replayJson = JSON.parse(replay.text);
    assert.strictEqual(replayJson.success, false);
    assert.match(replayJson.message, /not found or expired/);
    console.log('✅ confirmation ids are single-use');

    console.log('📝 pending list is empty again');
    const afterwards = await client.callTool('get_pending_confirmations', {});
    assert.strictEqual(JSON.parse(afterwards.text).count, 0);
    console.log('✅ pending list drained');

    console.log('📝 safe commands still run without confirmation');
    const safe = await client.callTool('execute_command', {
      command: 'echo',
      args: ['confirmation-flow-ok'],
    });
    assert.ok(
      !safe.text.includes('Command requires confirmation'),
      `safe command should not need confirmation:\n${safe.text}`
    );
    assert.ok(
      safe.text.includes('confirmation-flow-ok'),
      `expected safe command output in:\n${safe.text}`
    );
    console.log('✅ safe commands unaffected');

    console.log('\n🎉 Confirmation flow tests passed');
  } finally {
    client.stop();
    fs.rmSync(logDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error('💥 Confirmation flow tests failed:', error.message);
    process.exit(1);
  });
}

module.exports = { run };
