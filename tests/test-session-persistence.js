#!/usr/bin/env node

/**
 * Test script for session-file persistence (issue #31).
 *
 * Verifies that the session snapshot:
 *  - lives next to the audit log (MCP_EXEC_LOG_DIR/session.json), not process.cwd()
 *  - is written a handful of times for 200 commands (debounced), not once per command
 *  - stays small (< 200 KB) with truncated output
 *  - never contains the inherited process environment (no SUPER_SECRET)
 *  - restores history (and its output cache) on the next server start
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');
const COMMAND_COUNT = 200;
const MAX_SESSION_FILE_BYTES = 200 * 1024;
const MAX_WRITES = 20; // "a handful" -- one write per command would be ~200

class Client {
  constructor(logDir, extraEnv = {}) {
    this.proc = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_EXEC_LOG_DIR: logDir,
        MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'false',
        ...extraEnv,
      },
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', () => {}); // server logs progress to stderr
  }

  onData(chunk) {
    this.buffer += chunk.toString();
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const resolve = this.pending.get(message.id);
      if (resolve) {
        this.pending.delete(message.id);
        resolve(message);
      }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method} (id ${id})`));
      }, 30000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'session-persistence-test', version: '1.0.0' },
    });
  }

  call(name, args) {
    return this.request('tools/call', { name, arguments: args });
  }

  shutdown(signal = 'SIGTERM') {
    return new Promise((resolve) => {
      this.proc.on('close', resolve);
      this.proc.kill(signal);
      setTimeout(() => {
        this.proc.kill('SIGKILL');
        resolve();
      }, 8000).unref();
    });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`✅ ${message}`);
}

async function run() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-session-'));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-cwd-'));
  const sessionFile = path.join(logDir, 'session.json');
  const legacyFile = path.join(workDir, '.mcp-exec-session.json');

  console.log('🧪 Testing session-file persistence (issue #31)');
  console.log(`   log dir: ${logDir}`);

  // Count distinct session-file writes while commands are running.
  const seenMtimes = new Set();
  const poller = setInterval(() => {
    try {
      seenMtimes.add(fs.statSync(sessionFile).mtimeMs);
    } catch {
      // not written yet
    }
  }, 25);

  const client = new Client(logDir, { SUPER_SECRET: 'abc123', PWD: workDir });
  try {
    await client.initialize();

    for (let i = 0; i < COMMAND_COUNT; i++) {
      const response = await client.call('execute_command', {
        command: 'true',
        args: [],
        cwd: workDir,
      });
      if (response.error) {
        throw new Error(`execute_command failed: ${JSON.stringify(response.error)}`);
      }
    }
    console.log(`   ran ${COMMAND_COUNT} commands`);

    // Let the trailing debounce timer fire, then flush on shutdown.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } finally {
    clearInterval(poller);
    await client.shutdown();
  }

  try {
    seenMtimes.add(fs.statSync(sessionFile).mtimeMs);
  } catch {
    // handled by the assertion below
  }

  assert(fs.existsSync(sessionFile), `session file written to the log directory (${sessionFile})`);
  assert(!fs.existsSync(legacyFile), 'no .mcp-exec-session.json written to the working directory');
  assert(!fs.existsSync(path.join(process.cwd(), '.mcp-exec-session.json')),
    'no .mcp-exec-session.json written to the repo root');

  const stats = fs.statSync(sessionFile);
  assert(stats.size < MAX_SESSION_FILE_BYTES,
    `session file stays under 200 KB (${(stats.size / 1024).toFixed(1)} KB)`);
  assert(seenMtimes.size <= MAX_WRITES,
    `session file written ${seenMtimes.size} times for ${COMMAND_COUNT} commands (<= ${MAX_WRITES})`);

  const raw = fs.readFileSync(sessionFile, 'utf-8');
  assert(!raw.includes('abc123') && !raw.includes('SUPER_SECRET'),
    'inherited secret env var (SUPER_SECRET=abc123) is absent from the session file');

  const data = JSON.parse(raw);
  assert(typeof data.sessionId === 'string', 'session file records a sessionId');
  assert(data.environmentVariables === undefined && typeof data.environmentOverrides === 'object',
    'session file stores environmentOverrides only, not a full environment snapshot');
  assert(data.commandHistory.length <= 50,
    `command history capped at 50 entries (${data.commandHistory.length})`);
  assert(data.commandHistory.every((e) => e.environment === undefined),
    'history entries carry no per-command environment copy');
  assert(data.commandHistory.every((e) => (e.output.stdout || '').length <= 1024 &&
    (e.output.stderr || '').length <= 1024), 'history entry output truncated to 1 KB');

  // Restart against the same log dir: history must come back.
  const second = new Client(logDir, {});
  try {
    await second.initialize();
    const history = await second.call('get_history', { limit: 5 });
    const text = history.result.content[0].text;
    assert(/Showing 5 command\(s\)/.test(text) && text.includes('`true`'),
      'restored history is available after restart');
  } finally {
    await second.shutdown();
  }

  // loadSession must rebuild the output cache so get_output-style lookups hit.
  const { ContextManager } = require(path.resolve(__dirname, '..', 'dist', 'context', 'manager.js'));
  process.env.MCP_EXEC_LOG_DIR = logDir;
  const manager = new ContextManager(
    { preserveWorkingDirectory: true, sessionPersistence: true, maxHistorySize: 100 }
  );
  await manager.loadSession();
  const restoredId = data.commandHistory[data.commandHistory.length - 1].id;
  const cached = await manager.getOutput(restoredId);
  assert(cached !== undefined && cached.exitCode === 0,
    'output cache rebuilt from restored history entries');
  assert(process.env.PATH === undefined ||
    (await manager.getCurrentContext()).environmentVariables.PATH === process.env.PATH,
    'live process environment is preserved on load (overrides merged on top)');

  fs.rmSync(logDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (require.main === module) {
  run()
    .then(() => {
      console.log('\n🎉 Session persistence test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Session persistence test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { run };
