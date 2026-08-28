#!/usr/bin/env node

/**
 * Regression tests for issue #42: ShellExecutor must bound how much of a child's
 * stdout/stderr it keeps in memory, and must not split multi-byte UTF-8 sequences.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Keep audit/log files out of the repo and out of ~/.mcp-exec.
if (!process.env.MCP_EXEC_LOG_DIR) {
  process.env.MCP_EXEC_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-output-cap-'));
}

const { ShellExecutor } = require('../dist/core/executor');
const { SecurityManager } = require('../dist/security/manager');
const { ContextManager } = require('../dist/context/manager');
const { AuditLogger } = require('../dist/audit/logger');

const MB = 1024 * 1024;

function createExecutor(outputOverrides = {}) {
  const config = {
    security: {
      level: 'permissive',
      confirmDangerous: false,
      allowedDirectories: [process.cwd(), os.tmpdir()],
      blockedCommands: [],
      timeout: 120000,
      resourceLimits: {
        maxMemoryUsage: 1024,
        maxFileSize: 100,
        maxProcesses: 10,
      },
      sandboxing: {
        enabled: false,
        networkAccess: true,
        fileSystemAccess: 'full',
      },
    },
    context: {
      preserveWorkingDirectory: true,
      sessionPersistence: false,
      maxHistorySize: 10,
    },
    sessions: {
      maxInteractiveSessions: 1,
      sessionTimeout: 60000,
      outputBufferSize: 100,
    },
    lifecycle: {
      inactivityTimeout: 0,
      gracefulShutdownTimeout: 5000,
      enableHeartbeat: false,
    },
    output: {
      formatStructured: false,
      stripAnsi: false,
      summarizeVerbose: false,
      enableAiOptimizations: false,
      maxOutputLength: 10000,
      ...outputOverrides,
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
      enabled: false,
      logLevel: 'error',
      retention: 1,
    },
  };

  const auditLogger = new AuditLogger(config.audit);
  const securityManager = new SecurityManager(config.security);
  const contextManager = new ContextManager(config.context, auditLogger);
  return new ShellExecutor(securityManager, contextManager, auditLogger, config);
}

/** Runs `fn` while sampling RSS, returning the peak growth in bytes. */
async function measurePeakRssGrowth(fn) {
  const baseline = process.memoryUsage().rss;
  let peak = baseline;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 25);
  try {
    const result = await fn();
    peak = Math.max(peak, process.memoryUsage().rss);
    return { result, peakGrowth: peak - baseline };
  } finally {
    clearInterval(sampler);
  }
}

async function testLargeOutputIsCapped() {
  console.log('📝 300 MB of stdout stays within the memory cap');

  const maxOutputLength = 10000;
  const executor = createExecutor({ maxOutputLength, maxCollectedBytes: MB });

  const { result, peakGrowth } = await measurePeakRssGrowth(() =>
    executor.executeCommand({
      // 300 MB streamed through a pipe, never written to disk. (`/dev/zero` as in the
      // issue is rejected by the security policy's allowed-directory check.)
      command: 'yes abcdefghijklmnopqrstuvwxyz | head -c 300000000',
      shell: true,
      timeout: 120000,
    })
  );

  console.log(`   peak RSS growth: ${(peakGrowth / MB).toFixed(1)} MB`);
  console.log(`   returned stdout: ${result.stdout.length} chars`);

  assert.strictEqual(result.exitCode, 0, 'command should succeed');
  assert.ok(
    peakGrowth < 50 * MB,
    `expected peak RSS growth < 50 MB, got ${(peakGrowth / MB).toFixed(1)} MB`
  );
  assert.ok(
    result.stdout.length <= maxOutputLength,
    `expected stdout <= ${maxOutputLength} chars, got ${result.stdout.length}`
  );

  const warning = result.metadata.warnings.find(w => w.startsWith('[Output truncated:'));
  assert.ok(warning, `expected a truncation warning, got ${JSON.stringify(result.metadata.warnings)}`);
  const dropped = parseInt(warning.match(/(\d+) bytes dropped/)[1], 10);
  assert.ok(dropped > 200 * MB, `expected >200 MB reported as dropped, got ${dropped}`);
  assert.ok(
    result.summary.mainResult.includes('[Output truncated:'),
    'expected the truncation notice in summary.mainResult'
  );

  console.log('✅ large output capped');
  await executor.shutdown();
}

async function testMultibyteOutputIsExact() {
  console.log('📝 multi-byte output is returned exactly');

  const executor = createExecutor();
  const result = await executor.executeCommand({
    command: "printf '日本語\\n'",
    shell: true,
  });

  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.stdout, '日本語\n', `unexpected stdout: ${JSON.stringify(result.stdout)}`);

  console.log('✅ printf 日本語 exact');
  await executor.shutdown();
}

async function testMultibyteAcrossChunkBoundaries() {
  console.log('📝 multi-byte characters survive chunk boundaries');

  // "日本\n" is 7 bytes, so the 64 KB stream chunks land mid-character; 100k repetitions
  // is an exact byte count, so any replacement character means a sequence was split.
  const repeats = 100000;
  const expected = '日本\n'.repeat(repeats);
  const executor = createExecutor({ maxOutputLength: 0, maxCollectedBytes: 8 * MB });
  const result = await executor.executeCommand({
    command: `yes 日本 | head -c ${Buffer.byteLength(expected, 'utf8')}`,
    shell: true,
  });

  assert.strictEqual(result.exitCode, 0, `command failed: ${result.stderr}`);
  assert.ok(!result.stdout.includes('�'), 'output contains U+FFFD replacement characters');
  assert.strictEqual(result.stdout, expected, `expected ${expected.length} chars, got ${result.stdout.length}`);
  assert.strictEqual(result.metadata.warnings.filter(w => w.startsWith('[Output truncated:')).length, 0);

  console.log('✅ no split multi-byte sequences');
  await executor.shutdown();
}

async function run() {
  console.log('🧪 Testing ShellExecutor output memory cap (issue #42)...\n');

  await testLargeOutputIsCapped();
  await testMultibyteOutputIsExact();
  await testMultibyteAcrossChunkBoundaries();

  console.log('\n🎉 executor output cap tests passed');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('💥 executor output cap tests failed:', error);
      process.exit(1);
    });
}

module.exports = { run };
