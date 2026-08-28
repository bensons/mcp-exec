#!/usr/bin/env node

/**
 * Regression tests for issue #30: audit entries must stay small (no embedded
 * command history / environment) and must never carry secrets to disk.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SecurityManager } = require('../dist/security/manager');
const { ContextManager } = require('../dist/context/manager');
const { AuditLogger } = require('../dist/audit/logger');
const { ShellExecutor } = require('../dist/core/executor');
const { redactSecrets, REDACTED } = require('../dist/audit/redact');

const SECRET_VALUE = 'abc123-super-secret-value';
const MAX_ENTRY_BYTES = 2048;

function buildConfig(logDirectory) {
  return {
    security: {
      level: 'permissive',
      confirmDangerous: false,
      allowedDirectories: [process.cwd(), os.tmpdir(), '/tmp'],
      blockedCommands: ['rm -rf /', 'mkfs'],
      timeout: 30000,
      sandboxing: { enabled: false, networkAccess: true, fileSystemAccess: 'full' },
    },
    context: {
      preserveWorkingDirectory: true,
      sessionPersistence: true,
      maxHistorySize: 1000,
    },
    sessions: {
      maxInteractiveSessions: 10,
      sessionTimeout: 1800000,
      outputBufferSize: 1000,
    },
    lifecycle: {
      inactivityTimeout: 0,
      gracefulShutdownTimeout: 5000,
      enableHeartbeat: false,
    },
    output: {
      formatStructured: true,
      stripAnsi: true,
      summarizeVerbose: true,
      enableAiOptimizations: true,
      maxOutputLength: 10000,
    },
    display: {
      showCommandHeader: true,
      showExecutionTime: true,
      showExitCode: true,
      formatCodeBlocks: true,
      includeMetadata: true,
      includeSuggestions: true,
      useMarkdown: true,
      colorizeOutput: false,
    },
    audit: {
      enabled: true,
      logLevel: 'debug',
      retention: 30,
      logDirectory,
      maxOutputBytes: 4096,
      maxInMemoryEntries: 1000,
    },
  };
}

function readCommandEntries(logFile) {
  return fs
    .readFileSync(logFile, 'utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        return { line, entry: JSON.parse(line) };
      } catch {
        return null;
      }
    })
    .filter(record => record && record.entry.id && record.entry.command);
}

async function run() {
  console.log('🧪 Testing audit entry size and redaction...\n');

  const logDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-audit-'));
  process.env.MCP_EXEC_LOG_DIR = logDirectory;
  process.env.SUPER_SECRET = SECRET_VALUE;
  process.env.MY_API_KEY = SECRET_VALUE;

  const config = buildConfig(logDirectory);
  const securityManager = new SecurityManager(config.security);
  const auditLogger = new AuditLogger(config.audit);
  const contextManager = new ContextManager(config.context, auditLogger);
  const executor = new ShellExecutor(securityManager, contextManager, auditLogger, config);

  const logFile = auditLogger.getLogFilePath();
  assert.ok(
    logFile.startsWith(logDirectory),
    `audit log must live in the temp dir, got ${logFile}`
  );

  console.log('📝 redactSecrets replaces secret-bearing keys');
  const redacted = redactSecrets({
    AWS_SECRET_ACCESS_KEY: SECRET_VALUE,
    nested: { githubToken: SECRET_VALUE, PATH: '/usr/bin' },
    list: [{ password: SECRET_VALUE }],
    command: 'echo hi',
  });
  assert.strictEqual(redacted.AWS_SECRET_ACCESS_KEY, REDACTED);
  assert.strictEqual(redacted.nested.githubToken, REDACTED);
  assert.strictEqual(redacted.list[0].password, REDACTED);
  assert.strictEqual(redacted.nested.PATH, '/usr/bin');
  assert.strictEqual(redacted.command, 'echo hi');
  console.log('✅ redactSecrets');

  console.log('📝 running 50 commands');
  for (let i = 0; i < 50; i++) {
    const result = await executor.executeCommand({ command: 'echo', args: ['hi'] });
    assert.strictEqual(result.exitCode, 0, `command ${i} should succeed`);
  }

  const records = readCommandEntries(logFile);
  assert.ok(records.length >= 50, `expected >= 50 audit entries, got ${records.length}`);

  const sizes = records.map(record => Buffer.byteLength(record.line, 'utf-8'));
  const maxSize = Math.max(...sizes);
  const firstSize = sizes[0];
  const lastSize = sizes[sizes.length - 1];
  console.log(
    `   entry bytes: first=${firstSize} last=${lastSize} max=${maxSize} ` +
      `avg=${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)}`
  );

  assert.ok(maxSize < MAX_ENTRY_BYTES, `largest audit entry ${maxSize}B exceeds ${MAX_ENTRY_BYTES}B`);
  // Growth must be flat, not quadratic: the last entry may not balloon past the first.
  assert.ok(
    lastSize < firstSize * 2,
    `audit entries grow with history: first=${firstSize}B last=${lastSize}B`
  );
  console.log('✅ entry size stays bounded');

  console.log('📝 audit context is slim');
  for (const { entry } of records) {
    const context = entry.context;
    assert.ok(context, 'entry must have a context');
    for (const forbidden of [
      'environment',
      'environmentVariables',
      'commandHistory',
      'outputCache',
      'fileSystemChanges',
    ]) {
      assert.ok(
        !(forbidden in context),
        `audit context must not include ${forbidden}`
      );
    }
    assert.ok(typeof context.sessionId === 'string', 'context.sessionId missing');
    assert.ok(typeof context.workingDirectory === 'string', 'context.workingDirectory missing');
    assert.ok(Array.isArray(context.previousCommands), 'context.previousCommands missing');
    assert.ok(context.previousCommands.length <= 5, 'previousCommands must be capped at 5');
  }
  console.log('✅ slim context');

  console.log('📝 secrets never reach the log file or exports');
  const rawLog = fs.readFileSync(logFile, 'utf-8');
  assert.ok(!rawLog.includes(SECRET_VALUE), 'secret env value leaked into the audit log');

  for (const format of ['json', 'csv', 'xml']) {
    const exported = await auditLogger.exportLogs(format, {});
    assert.ok(
      !exported.includes(SECRET_VALUE),
      `secret env value leaked into export_logs (${format})`
    );
  }
  console.log('✅ no secrets on disk or in export_logs');

  console.log('📝 large output is truncated in the audit entry');
  await executor.executeCommand({
    command: 'node',
    args: ['-e', '"process.stdout.write(\'x\'.repeat(20000))"'],
  });
  const afterBig = readCommandEntries(logFile);
  const bigEntry = afterBig[afterBig.length - 1];
  const storedStdout = bigEntry.entry.result.stdout || '';
  assert.ok(
    storedStdout.length <= 4096 + 64,
    `stdout should be truncated to ~4096 bytes, got ${storedStdout.length}`
  );
  assert.match(storedStdout, /truncated to 4096 bytes/, 'expected truncation marker');
  console.log(`✅ stdout truncated to ${storedStdout.length} bytes`);

  console.log('📝 in-memory entry count is capped');
  const capped = new AuditLogger({ ...config.audit, maxInMemoryEntries: 5 });
  for (let i = 0; i < 12; i++) {
    await capped.logCommand({
      commandId: `cmd-${i}`,
      command: `echo ${i}`,
      context: { sessionId: 's', workingDirectory: '/tmp', previousCommands: [] },
      result: {
        stdout: `${i}`,
        stderr: '',
        exitCode: 0,
        metadata: { executionTime: 1, commandType: 'test', affectedResources: [], warnings: [], suggestions: [] },
        summary: { success: true, mainResult: 'ok', sideEffects: [] },
      },
      securityCheck: { allowed: true, riskLevel: 'low' },
      executionTime: 1,
    });
  }
  const kept = await capped.queryLogs({});
  assert.strictEqual(kept.length, 5, `expected 5 in-memory entries, got ${kept.length}`);
  assert.strictEqual(kept[kept.length - 1].command, 'echo 11', 'newest entry should be retained');
  console.log('✅ in-memory cap enforced');

  fs.rmSync(logDirectory, { recursive: true, force: true });
  console.log('\n🎉 audit entry size and redaction tests passed');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('💥 audit entry size tests failed:', error);
      process.exit(1);
    });
}

module.exports = { run };
