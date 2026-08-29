#!/usr/bin/env node

/**
 * Tests for executor exit-code reporting (issue #25):
 * - timed-out commands return exit code 124, success: false, and leave no orphans
 * - signal-killed commands return 128 + signal, success: false
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ShellExecutor } = require('../dist/core/executor');
const { SecurityManager } = require('../dist/security/manager');
const { ContextManager } = require('../dist/context/manager');
const { AuditLogger } = require('../dist/audit/logger');

// Unique per run so concurrent test runs never see each other's processes
const MARKER = `mcpexec25-${process.pid}-${crypto.randomUUID()}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-exit-codes-'));
const FIXTURE = path.join('tests', 'fixtures', 'executor-command.js');

function createExecutor() {
  const config = {
    security: {
      level: 'permissive',
      confirmDangerous: false,
      allowedDirectories: [TMP_DIR, process.cwd(), os.tmpdir()],
      blockedCommands: [],
      timeout: 30000,
    },
    context: {
      preserveWorkingDirectory: false,
      sessionPersistence: false, // never write .mcp-exec-session.json to the repo
      maxHistorySize: 10,
    },
    sessions: {
      maxInteractiveSessions: 1,
      sessionTimeout: 60000,
      outputBufferSize: 100,
    },
    lifecycle: {
      inactivityTimeout: 0,
      gracefulShutdownTimeout: 1000,
      enableHeartbeat: false,
    },
    output: {
      formatStructured: false,
      stripAnsi: true,
      summarizeVerbose: false,
      enableAiOptimizations: false,
      maxOutputLength: 10000,
    },
    display: {
      showCommandHeader: false,
      showExecutionTime: false,
      showExitCode: false,
      formatCodeBlocks: false,
      includeMetadata: false,
      includeSuggestions: false,
      useMarkdown: false,
      colorizeOutput: false,
    },
    audit: {
      enabled: false, // no log files
      logLevel: 'error',
      retention: 1,
      logDirectory: TMP_DIR,
    },
  };

  const auditLogger = new AuditLogger(config.audit);
  return new ShellExecutor(
    new SecurityManager(config.security),
    new ContextManager(config.context, auditLogger),
    auditLogger,
    config
  );
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

async function waitForProcessExit(pid, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return !processExists(pid);
}

async function testTimeout(executor) {
  console.log('📝 timed-out command returns 124 and kills the process tree');

  // The grandchild closes its stdio and ignores SIGTERM on POSIX. This makes
  // the wrapping shell emit `close` while the process group is still alive,
  // which used to cancel the pending SIGKILL escalation.
  const start = Date.now();
  const result = await executor.executeCommand({
    command: 'node',
    args: [FIXTURE, 'timeout-tree', MARKER],
    timeout: 500,
    cwd: process.cwd(),
  });
  const elapsed = Date.now() - start;

  assert.strictEqual(result.exitCode, 124, `expected exit code 124, got ${result.exitCode}`);
  assert.strictEqual(result.summary.success, false, 'timed-out command must not report success');
  assert.match(result.summary.mainResult, /timed out/i, result.summary.mainResult);
  assert.ok(
    result.metadata.warnings.some(w => /timed out/i.test(w)),
    `expected a timeout warning, got ${JSON.stringify(result.metadata.warnings)}`
  );
  assert.ok(
    result.stdout.includes(`started-${MARKER}`),
    `partial output should be preserved, got: ${JSON.stringify(result.stdout)}`
  );
  assert.ok(elapsed < 5000, `expected a bounded return, took ${elapsed}ms`);

  const pidMatch = result.stdout.match(/child-pid:(\d+)/);
  assert.ok(pidMatch, `expected child PID in output, got: ${JSON.stringify(result.stdout)}`);
  const childPid = Number(pidMatch[1]);
  const childExited = await waitForProcessExit(childPid);
  if (!childExited) {
    try {
      process.kill(childPid, 'SIGKILL');
    } catch (error) {
      // already gone
    }
  }
  assert.ok(childExited, `timeout left descendant process ${childPid} running`);

  if (process.platform !== 'win32') {
    assert.ok(
      elapsed >= 1800,
      `executor returned before the SIGKILL grace period elapsed (${elapsed}ms)`
    );
  }

  console.log(`✅ exit code 124 in ${elapsed}ms, no orphaned processes`);
}

async function testSignal(executor) {
  if (process.platform === 'win32') {
    console.log('⏭️  signal exit-code test is POSIX-only');
    return;
  }

  console.log('📝 signal-killed command reports 128 + signal, not success');

  const result = await executor.executeCommand({ command: 'kill -TERM $$', cwd: TMP_DIR });

  assert.strictEqual(result.exitCode, 143, `expected exit code 143, got ${result.exitCode}`);
  assert.strictEqual(result.summary.success, false, 'signal-killed command must not report success');
  assert.match(result.summary.mainResult, /SIGTERM/, result.summary.mainResult);

  console.log('✅ exit code 143, success: false, mentions SIGTERM');
}

async function testNonzeroExit(executor) {
  console.log('📝 non-zero exit code is preserved');

  const result = await executor.executeCommand({
    command: 'node',
    args: [FIXTURE, 'exit', '7'],
    cwd: process.cwd(),
  });

  assert.strictEqual(result.exitCode, 7, `expected exit code 7, got ${result.exitCode}`);
  assert.strictEqual(result.summary.success, false, 'non-zero exit must not report success');

  console.log('✅ exit code 7, success: false');
}

async function testSuccessStillWorks(executor) {
  console.log('📝 normal command still reports success');

  const result = await executor.executeCommand({
    command: 'node',
    args: [FIXTURE, 'output', `ok-${MARKER}`],
    cwd: process.cwd(),
  });

  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.summary.success, true);
  assert.ok(result.stdout.includes(`ok-${MARKER}`));

  console.log('✅ successful command unchanged');
}

async function run() {
  console.log('🧪 Testing executor exit codes and timeout handling...\n');

  const executor = createExecutor();
  try {
    await testTimeout(executor);
    await testSignal(executor);
    await testNonzeroExit(executor);
    await testSuccessStillWorks(executor);
  } finally {
    await executor.shutdown();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }

  console.log('\n🎉 All executor exit-code tests passed!');
}

run().then(
  () => process.exit(0),
  error => {
    console.error('\n❌ Executor exit-code tests failed:', error.message);
    process.exit(1);
  }
);
