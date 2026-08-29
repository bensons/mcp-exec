#!/usr/bin/env node

/**
 * Regression test for issue #24: starting the server with
 * MCP_EXEC_MCP_LOG_LEVEL=debug used to emit "Not connected" rejections from
 * server.notification() before connect() resolved, which the global
 * unhandledRejection handler turned into an immediate shutdown.
 */

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '..', 'dist', 'index.js');
const REJECT_NOTIFICATIONS_PRELOAD = path.join(__dirname, 'fixtures', 'reject-mcp-notifications.js');
const UNHANDLED_REJECTION_PRELOAD = path.join(__dirname, 'fixtures', 'unhandled-rejection.js');
const STDIN_OPEN_MS = 2000;
const HARD_TIMEOUT_MS = 20000;

function startServer(tempDir, { nodeArgs = [], stdinOpenMs = STDIN_OPEN_MS } = {}) {
  return new Promise((resolve, reject) => {
    // cwd + MCP_EXEC_LOG_DIR keep every file the server writes inside tempDir.
    const child = spawn(process.execPath, [...nodeArgs, SERVER_PATH], {
      cwd: tempDir,
      env: {
        ...process.env,
        MCP_EXEC_MCP_LOG_LEVEL: 'debug',
        MCP_EXEC_AUDIT_ENABLED: 'false',
        MCP_EXEC_SESSION_PERSISTENCE: 'false',
        MCP_EXEC_LOG_DIR: tempDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const hardTimeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Server did not exit within ${HARD_TIMEOUT_MS}ms\nstderr:\n${stderr}`));
    }, HARD_TIMEOUT_MS);

    // Keep stdin open so the server has to survive on its own for a while,
    // then close it to trigger the graceful shutdown path.
    const closeStdin = setTimeout(() => child.stdin.end(), stdinOpenMs);

    child.on('error', (error) => {
      clearTimeout(hardTimeout);
      clearTimeout(closeStdin);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(hardTimeout);
      clearTimeout(closeStdin);
      resolve({ code, stdout, stderr });
    });
  });
}

async function withTempDir(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-debug-startup-'));
  try {
    return await callback(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function run() {
  console.log('🧪 Testing startup with MCP_EXEC_MCP_LOG_LEVEL=debug...\n');

  assert.ok(fs.existsSync(SERVER_PATH), `Build missing: ${SERVER_PATH} (run npm run build)`);

  const result = await withTempDir((tempDir) => startServer(tempDir));

  console.log('📝 server does not report unhandled rejections');
  assert.ok(
    !result.stderr.includes('Unhandled rejection'),
    `Unexpected unhandled rejection:\n${result.stderr}`
  );
  assert.ok(
    !result.stderr.includes('Not connected'),
    `Notification sent before transport was connected:\n${result.stderr}`
  );
  console.log('✅ no unhandled rejections');

  console.log('📝 server stays up until stdin closes, then exits cleanly');
  assert.ok(
    result.stderr.includes('Client disconnection'),
    `Expected shutdown to be caused by stdin closing:\n${result.stderr}`
  );
  assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}\n${result.stderr}`);
  console.log('✅ clean exit');

  console.log('📝 debug-level log notifications reach the client');
  const notifications = result.stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((message) => message.method === 'notifications/message');
  assert.ok(
    notifications.some((message) => message.params.level === 'debug'),
    `Expected at least one debug notification, got: ${JSON.stringify(notifications.map((m) => m.params.level))}`
  );
  console.log(`✅ ${notifications.length} notifications received`);

  console.log('📝 rejected MCP notifications are handled locally');
  const notificationFailure = await withTempDir((tempDir) => startServer(tempDir, {
    nodeArgs: ['--require', REJECT_NOTIFICATIONS_PRELOAD],
  }));
  assert.ok(
    notificationFailure.stderr.includes('Failed to send MCP log notification: Injected notification failure'),
    `Expected a locally handled notification failure:\n${notificationFailure.stderr}`
  );
  assert.ok(
    !notificationFailure.stderr.includes('Unhandled rejection at:'),
    `Notification failure escaped to the process handler:\n${notificationFailure.stderr}`
  );
  assert.ok(
    notificationFailure.stderr.includes('Client disconnection'),
    `Notification failure terminated the server early:\n${notificationFailure.stderr}`
  );
  assert.strictEqual(notificationFailure.code, 0, `Expected exit code 0, got ${notificationFailure.code}`);
  console.log('✅ notification failures do not escape their local catch');

  console.log('📝 unrelated unhandled rejections still fail closed');
  const unrelatedFailure = await withTempDir((tempDir) => startServer(tempDir, {
    nodeArgs: ['--require', UNHANDLED_REJECTION_PRELOAD],
    stdinOpenMs: 5000,
  }));
  assert.ok(
    unrelatedFailure.stderr.includes('Unhandled rejection at:') &&
      unrelatedFailure.stderr.includes('Injected unrelated rejection'),
    `Expected the process-level handler to report the rejection:\n${unrelatedFailure.stderr}`
  );
  assert.ok(
    unrelatedFailure.stderr.includes('Initiating graceful shutdown: Unhandled rejection'),
    `Expected an unhandled rejection to shut down the server:\n${unrelatedFailure.stderr}`
  );
  assert.ok(
    !unrelatedFailure.stderr.includes('Initiating graceful shutdown: Client disconnection'),
    `Server waited for stdin instead of failing closed:\n${unrelatedFailure.stderr}`
  );
  assert.strictEqual(unrelatedFailure.code, 0, `Expected graceful exit code 0, got ${unrelatedFailure.code}`);
  console.log('✅ unrelated unhandled rejections trigger graceful shutdown');

  console.log('\n🎉 Debug log level startup test passed');
}

run().catch((error) => {
  console.error('\n❌ Debug log level startup test failed:', error.message);
  process.exit(1);
});
