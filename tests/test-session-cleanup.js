#!/usr/bin/env node

/**
 * Regression test for issue #34:
 *  - finished sessions must not keep occupying interactive session slots
 *  - terminal sessions must be removed from the terminal viewer service on termination
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TerminalViewerService } = require('../dist/terminal/viewer-service.js');

const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');
const MAX_SESSIONS = 10;
const SESSION_COUNT = 15;

class McpClient {
  constructor(workDir) {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.server = spawn('node', [SERVER_PATH], {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: workDir,
        MCP_EXEC_LOG_DIR: workDir,
        MCP_EXEC_MAX_SESSIONS: String(MAX_SESSIONS),
        MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'true',
        MCP_EXEC_TERMINAL_VIEWER_PORT: '0', // ephemeral port, safe for parallel runs
        MCP_EXEC_TERMINAL_VIEWER_MAX_SESSIONS: String(MAX_SESSIONS),
      },
    });

    this.server.stdout.on('data', (chunk) => this.onData(chunk));
    this.server.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-8000);
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString();
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const resolver = this.pending.get(message.id);
      if (resolver) {
        this.pending.delete(message.id);
        resolver(message);
      }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}\nServer stderr:\n${this.stderr}`));
      }, 20000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async callTool(name, args = {}) {
    const response = await this.request('tools/call', { name, arguments: args });
    if (response.error) {
      throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    }
    return (response.result?.content || []).map((c) => c.text).join('\n');
  }

  stop() {
    return new Promise((resolve) => {
      this.server.once('close', resolve);
      this.server.kill('SIGTERM');
      setTimeout(resolve, 3000);
    });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractSessionId(text) {
  const match = text.match(/Session ID:\*{0,2}\s*`([^`]+)`/);
  return match ? match[1] : null;
}

function testViewerExitStartsGracePeriod() {
  console.log('\n1️⃣  Viewer-backed PTY exit starts the finished-session grace period');

  let exitHandler;
  const viewer = new TerminalViewerService({
    enabled: true,
    port: 0,
    host: '127.0.0.1',
    maxSessions: 1,
    sessionTimeout: 60_000,
    bufferSize: 100,
    enableAuth: false,
  });
  const session = {
    sessionId: 'quiet-viewer-session',
    command: 'quiet-command',
    args: [],
    cwd: process.cwd(),
    env: {},
    startTime: new Date(Date.now() - 10 * 60_000),
    lastActivity: new Date(Date.now() - 10 * 60_000),
    status: 'running',
    pty: {
      onData() {},
      onExit(handler) {
        exitHandler = handler;
      },
    },
    buffer: { lines: [], cursor: { x: 0, y: 0 }, scrollback: 0, maxLines: 100 },
    viewers: new Set(),
  };

  viewer.addSession(session);
  assert(typeof exitHandler === 'function', 'Viewer should register a PTY exit handler');

  const exitStartedAt = Date.now();
  exitHandler(0);

  assert(session.status === 'finished', `Expected finished status, got ${session.status}`);
  assert(
    session.lastActivity.getTime() >= exitStartedAt,
    `PTY exit should refresh lastActivity, got ${session.lastActivity.toISOString()}`
  );
  console.log('   ✅ Quiet session grace period begins when the PTY exits');
}

async function testFinishedSessionsFreeSlots(client) {
  console.log(`\n2️⃣  Starting ${SESSION_COUNT} short-lived sessions with maxInteractiveSessions=${MAX_SESSIONS}`);
  const sessionIds = [];

  for (let i = 0; i < SESSION_COUNT; i++) {
    const text = await client.callTool('start_interactive_session', { command: 'true' });
    const sessionId = extractSessionId(text);
    assert(sessionId, `Session ${i + 1}/${SESSION_COUNT} failed to start: ${text}`);
    sessionIds.push(sessionId);
    // Give the short-lived process a moment to exit so its slot is released
    await sleep(120);
  }

  console.log(`   ✅ All ${SESSION_COUNT} sessions started`);

  // Draining a finished session's output should also drop it from the manager
  const drained = await client.callTool('read_session_output', { sessionId: sessionIds[0] });
  assert(!drained.includes('not found'), `First read of finished session should succeed: ${drained}`);
  const second = await client.callTool('read_session_output', { sessionId: sessionIds[0] });
  assert(
    /not found/i.test(second),
    `Finished session should be removed after its output is drained, got: ${second}`
  );
  console.log('   ✅ Finished session is dropped once its output has been drained');
}

async function testTerminalViewerCleanup(client) {
  console.log('\n3️⃣  Terminal session viewer cleanup on terminate_terminal_session');

  const startText = await client.callTool('start_terminal_session', { command: 'echo hello' });
  const sessionId = extractSessionId(startText);
  assert(sessionId, `Terminal session failed to start: ${startText}`);

  const before = await client.callTool('get_terminal_viewer_status');
  assert(before.includes(sessionId), `Viewer should list session ${sessionId}:\n${before}`);
  console.log('   ✅ Viewer lists the terminal session');

  const terminated = await client.callTool('terminate_terminal_session', { sessionId });
  assert(terminated.includes('Terminated'), `Terminate failed: ${terminated}`);

  const after = await client.callTool('get_terminal_viewer_status');
  assert(!after.includes(sessionId), `Viewer still lists terminated session ${sessionId}:\n${after}`);
  assert(
    /Total Sessions: 0/.test(after),
    `Viewer session count should drop to 0 after terminate:\n${after}`
  );
  console.log('   ✅ Viewer no longer lists the session and its count dropped to 0');
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-cleanup-'));
  console.log('🧪 Testing finished-session cleanup (issue #34)');
  console.log(`Work directory: ${workDir}`);

  testViewerExitStartsGracePeriod();

  const client = new McpClient(workDir);
  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'session-cleanup-test', version: '1.0.0' },
    });

    await testFinishedSessionsFreeSlots(client);
    await testTerminalViewerCleanup(client);

    console.log('\n🎉 All session cleanup tests passed');
  } finally {
    await client.stop();
    fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(`\n❌ Test failed: ${error.message}`);
  process.exit(1);
});
