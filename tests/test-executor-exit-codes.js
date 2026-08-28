#!/usr/bin/env node

/**
 * Tests for executor exit-code reporting (issue #25):
 * - timed-out commands return exit code 124, success: false, and leave no orphans
 * - signal-killed commands return 128 + signal, success: false
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { ShellExecutor } = require('../dist/core/executor');
const { SecurityManager } = require('../dist/security/manager');
const { ContextManager } = require('../dist/context/manager');
const { AuditLogger } = require('../dist/audit/logger');

// Unique per run so concurrent test runs never see each other's processes
const MARKER = `mcpexec25-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-exit-codes-'));

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

function findLeftoverProcesses() {
  try {
    return execSync(`pgrep -f ${MARKER}`, { encoding: 'utf8' })
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  } catch (error) {
    return []; // pgrep exits 1 when nothing matches
  }
}

async function testTimeout(executor) {
  console.log('📝 timed-out command returns 124 and kills the process tree');

  // Compound command: the shell forks a child, so killing only the shell
  // (the pre-fix behaviour) leaves the child running as an orphan.
  const command =
    `echo started-${MARKER}; node -e "setTimeout(() => {}, 5000)" ${MARKER}-orphan`;

  const start = Date.now();
  const result = await executor.executeCommand({ command, timeout: 500, cwd: TMP_DIR });
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
  assert.ok(elapsed < 4000, `expected a fast return, took ${elapsed}ms`);

  const leftovers = findLeftoverProcesses();
  leftovers.forEach(pid => {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch (error) {
      // already gone
    }
  });
  assert.deepStrictEqual(leftovers, [], `timeout left orphaned process(es): ${leftovers}`);

  console.log(`✅ exit code 124 in ${elapsed}ms, no orphaned processes`);
}

async function testSignal(executor) {
  console.log('📝 signal-killed command reports 128 + signal, not success');

  const result = await executor.executeCommand({ command: 'kill -TERM $$', cwd: TMP_DIR });

  assert.strictEqual(result.exitCode, 143, `expected exit code 143, got ${result.exitCode}`);
  assert.strictEqual(result.summary.success, false, 'signal-killed command must not report success');
  assert.match(result.summary.mainResult, /SIGTERM/, result.summary.mainResult);

  console.log('✅ exit code 143, success: false, mentions SIGTERM');
}

async function testSuccessStillWorks(executor) {
  console.log('📝 normal command still reports success');

  const result = await executor.executeCommand({ command: `echo ok-${MARKER}`, cwd: TMP_DIR });

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
    await testSuccessStillWorks(executor);
  } finally {
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
