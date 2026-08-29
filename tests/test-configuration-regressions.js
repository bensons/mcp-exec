#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function endpointResponds(port) {
  return new Promise((resolve) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: '/api/sessions',
      timeout: 500,
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function waitForEndpoint(port, expected, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await endpointResponds(port) === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}: endpoint ${port} did not become ${expected ? 'available' : 'unavailable'}`);
}

class McpTestClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.stdoutBuffer = '';

    child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk) => this.handleStdout(chunk.toString()));
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    let newline;
    while ((newline = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;

      try {
        const message = JSON.parse(line);
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          pending.resolve(message);
        }
      } catch (_) {
        // Ignore non-protocol output.
      }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}\n${this.stderr}`));
      }, 20000);

      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async callTool(name, args = {}) {
    const response = await this.request('tools/call', { name, arguments: args });
    assert.ok(!response.error, `${name} returned an RPC error: ${JSON.stringify(response.error)}`);
    const text = response.result.content.map((item) => item.text).join('\n');
    return { result: response.result, text };
  }

  async stop() {
    if (this.child.exitCode !== null) return;
    this.child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGKILL');
        resolve();
      }, 5000);
      this.child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

async function run() {
  const initialPort = await getAvailablePort();
  let updatedPort = await getAvailablePort();
  while (updatedPort === initialPort) {
    updatedPort = await getAvailablePort();
  }

  const scratchDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-pr59-')));
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: scratchDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCP_EXEC_SECURITY_LEVEL: 'permissive',
      MCP_EXEC_LOG_DIR: scratchDir,
      MCP_EXEC_MONITORING_ENABLED: 'true',
      MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED: 'false',
      MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'true',
      MCP_EXEC_TERMINAL_VIEWER_HOST: '127.0.0.1',
      MCP_EXEC_TERMINAL_VIEWER_PORT: String(initialPort),
    },
  });
  const client = new McpTestClient(child);

  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'pr59-regression-test', version: '1.0.0' },
    });

    console.log('Testing terminal viewer restart after reset...');
    await waitForEndpoint(initialPort, true, 'initial viewer startup');
    const viewerUpdate = await client.callTool('update_terminal_viewer', { port: updatedPort });
    assert.strictEqual(viewerUpdate.result.isError, undefined, viewerUpdate.text);
    await waitForEndpoint(updatedPort, true, 'updated viewer startup');
    await waitForEndpoint(initialPort, false, 'old viewer shutdown');

    const viewerReset = await client.callTool('reset_configuration', { section: 'terminalViewer' });
    assert.strictEqual(viewerReset.result.isError, undefined, viewerReset.text);
    await waitForEndpoint(initialPort, true, 'reset viewer startup');
    await waitForEndpoint(updatedPort, false, 'updated viewer shutdown');

    console.log('Testing negative history-limit validation...');
    const directNegative = await client.callTool('update_context_config', { maxHistorySize: -1 });
    assert.strictEqual(directNegative.result.isError, true, directNegative.text);
    assert.match(directNegative.text, /greater than or equal to 0|non-negative/i);

    const genericNegative = await client.callTool('update_configuration', {
      section: 'context',
      settings: { maxHistorySize: -1 },
    });
    assert.strictEqual(genericNegative.result.isError, true, genericNegative.text);
    assert.match(genericNegative.text, /greater than or equal to 0|non-negative/i);

    const liveCheck = await client.callTool('execute_command', { command: 'pwd' });
    assert.strictEqual(liveCheck.result.isError, undefined, liveCheck.text);
    assert.match(liveCheck.text, new RegExp(scratchDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    console.log('Testing audit monitoring rollback...');
    const disableMonitoring = await client.callTool('update_audit_logging', { monitoringEnabled: false });
    assert.strictEqual(disableMonitoring.result.isError, undefined, disableMonitoring.text);
    const historyResponse = await client.callTool('get_configuration_history', { limit: 1 });
    const history = JSON.parse(historyResponse.text).history;
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].section, 'audit');

    const rollback = await client.callTool('rollback_configuration', { changeId: history[0].id });
    assert.strictEqual(rollback.result.isError, undefined, rollback.text);
    const failedCommand = await client.callTool('execute_command', { command: 'false' });
    assert.strictEqual(failedCommand.result.isError, undefined, failedCommand.text);
    const alertsResponse = await client.callTool('get_alerts', {});
    const alerts = JSON.parse(alertsResponse.text).alerts;
    assert.ok(
      alerts.some((alert) => alert.ruleId === 'command-failure' && alert.logEntry.command === 'false'),
      `expected a command-failure alert after rollback, got ${alertsResponse.text}`
    );

    console.log('Testing logical logging reset...');
    await client.callTool('update_audit_logging', { retention: 61, monitoringEnabled: false });
    await client.callTool('update_mcp_logging', { rateLimitPerMinute: 123, maxQueueSize: 321 });
    const loggingReset = await client.callTool('reset_configuration', { section: 'logging' });
    assert.strictEqual(loggingReset.result.isError, undefined, loggingReset.text);

    const loggingConfigResponse = await client.callTool('get_configuration', { section: 'logging' });
    const logging = JSON.parse(loggingConfigResponse.text).configuration.logging;
    assert.strictEqual(logging.audit.retention, 30);
    assert.strictEqual(logging.audit.monitoring.enabled, true);
    assert.strictEqual(logging.mcpLogging.rateLimitPerMinute, 60);
    assert.strictEqual(logging.mcpLogging.maxQueueSize, 100);

    console.log('✅ PR #59 configuration regressions passed');
  } finally {
    await client.stop();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('❌ PR #59 configuration regression failed:', error);
  process.exitCode = 1;
});
