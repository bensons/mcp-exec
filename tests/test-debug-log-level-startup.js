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
const STDIN_OPEN_MS = 2000;
const HARD_TIMEOUT_MS = 20000;

function startServer(tempDir) {
  return new Promise((resolve, reject) => {
    // cwd + MCP_EXEC_LOG_DIR keep every file the server writes inside tempDir.
    const child = spawn(process.execPath, [SERVER_PATH], {
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
    const closeStdin = setTimeout(() => child.stdin.end(), STDIN_OPEN_MS);

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

async function run() {
  console.log('🧪 Testing startup with MCP_EXEC_MCP_LOG_LEVEL=debug...\n');

  assert.ok(fs.existsSync(SERVER_PATH), `Build missing: ${SERVER_PATH} (run npm run build)`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-debug-startup-'));
  let result;
  try {
    result = await startServer(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

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

  console.log('\n🎉 Debug log level startup test passed');
}

run().catch((error) => {
  console.error('\n❌ Debug log level startup test failed:', error.message);
  process.exit(1);
});
