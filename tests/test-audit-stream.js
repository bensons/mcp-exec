#!/usr/bin/env node

/**
 * Regression tests for issue #36: audit I/O and notifications must not block
 * the execute_command response path.
 *
 *  1. MonitoringSystem.processLogEntry returns immediately even when the
 *     desktop notifier never settles (fire-and-forget notifications).
 *  2. maxAlertsPerHour is enforced.
 *  3. Audit log lines are written through the append stream and survive a
 *     graceful shutdown (AuditLogger.flush).
 */

const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MonitoringSystem } = require(path.resolve(__dirname, '..', 'dist', 'audit', 'monitoring'));
const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');

function makeLogEntry(command, exitCode) {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date(),
    sessionId: 'test-session',
    userId: 'tester',
    command,
    context: {
      sessionId: 'test-session',
      workingDirectory: '/tmp',
      environmentVariables: {},
      currentDirectory: '/tmp',
      commandHistory: [],
      fileSystemChanges: [],
    },
    result: {
      stdout: '',
      stderr: '',
      exitCode,
      metadata: { executionTime: 1, commandType: 'test', affectedResources: [], warnings: [], suggestions: [] },
      summary: { success: exitCode === 0, mainResult: 'test', sideEffects: [] },
    },
    securityCheck: { allowed: true, riskLevel: 'low' },
  };
}

async function testNotificationsDoNotBlock() {
  console.log('📝 processLogEntry does not await desktop notifications');

  const monitoring = new MonitoringSystem({
    enabled: true,
    alertRetention: 7,
    maxAlertsPerHour: 100,
    desktopNotifications: { enabled: true },
  });

  // Simulate node-notifier hanging (no display / no notification daemon).
  let notifierCalls = 0;
  monitoring.sendDesktopNotification = () => {
    notifierCalls += 1;
    return new Promise(() => {});
  };

  let timer;
  const start = Date.now();
  const alerts = await Promise.race([
    monitoring.processLogEntry(makeLogEntry('false', 1)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('processLogEntry never resolved - it is awaiting the notifier')),
        5000
      );
    }),
  ]).finally(() => clearTimeout(timer));
  const elapsed = Date.now() - start;

  assert.ok(alerts.length > 0, 'a non-zero exit should trigger the command-failure rule');
  assert.strictEqual(notifierCalls, 1, 'the notification should still be dispatched');
  assert.ok(elapsed < 500, `processLogEntry blocked for ${elapsed}ms on a hung notifier`);
  console.log(`✅ returned in ${elapsed}ms with a hung notifier`);
}

async function testMaxAlertsPerHour() {
  console.log('📝 maxAlertsPerHour is enforced');

  const monitoring = new MonitoringSystem({
    enabled: true,
    alertRetention: 7,
    maxAlertsPerHour: 2,
    desktopNotifications: { enabled: false },
  });

  // Cooldowns would mask the cap, so drive distinct rules with a zero cooldown.
  for (const rule of monitoring.getAlertRules()) {
    monitoring.updateAlertRule(rule.id, { cooldownMinutes: 0 });
  }

  for (let i = 0; i < 10; i++) {
    await monitoring.processLogEntry(makeLogEntry('sudo rm -rf /', 1));
  }

  const total = monitoring.getAlerts().length;
  assert.ok(total <= 2, `expected at most 2 alerts per hour, got ${total}`);
  console.log(`✅ capped at ${total} alerts (limit 2)`);
}

async function testAuditLogFlushedOnShutdown() {
  console.log('📝 audit log is written and flushed on graceful shutdown');

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-audit-'));
  const logFile = path.join(workDir, '.mcp-exec-audit.log');

  let id = 1;
  let buffer = '';
  const pending = new Map();

  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: workDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MCP_EXEC_LOG_DIR: workDir,
      MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED: 'false',
    },
  });

  server.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        const resolve = pending.get(message.id);
        if (resolve) {
          pending.delete(message.id);
          resolve(message);
        }
      } catch {
        // Ignore non-JSON stdout
      }
    }
  });
  server.stderr.on('data', () => {});

  const call = (method, params) => new Promise((resolve, reject) => {
    const messageId = id++;
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${method}`)), 30000);
    pending.set(messageId, (message) => { clearTimeout(timer); resolve(message); });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: messageId, method, params }) + '\n');
  });

  try {
    await call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'audit-stream-test', version: '1.0.0' },
    });
    await call('tools/call', {
      name: 'execute_command',
      arguments: { command: 'echo', args: ['audit-stream-marker'] },
    });

    const exited = new Promise((resolve) => server.on('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error('graceful shutdown hung')), 15000)),
    ]);

    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());
    assert.ok(lines.length > 1, `expected audit lines, got ${lines.length}`);
    lines.forEach((line) => JSON.parse(line)); // every line must be a complete JSON record
    assert.ok(content.includes('audit-stream-marker'), 'command entry missing from audit log');
    console.log(`✅ ${lines.length} well-formed audit lines survived shutdown`);
  } finally {
    server.kill();
  }
}

async function run() {
  console.log('🧪 Testing audit stream / notification latency behaviour...\n');
  try {
    await testNotificationsDoNotBlock();
    await testMaxAlertsPerHour();
    await testAuditLogFlushedOnShutdown();
    console.log('\n🎉 Audit stream regression tests passed');
  } catch (error) {
    console.error('💥 Audit stream tests failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
