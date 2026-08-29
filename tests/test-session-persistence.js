#!/usr/bin/env node

/** Deterministic regressions for scoped and durable session persistence. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { ContextManager } = require('../dist/context/manager.js');

const CONFIG = {
  preserveWorkingDirectory: true,
  sessionPersistence: true,
  maxHistorySize: 1000,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✅ ${message}`);
}

function logger(logDir, filename = 'audit.log') {
  return {
    getLogFilePath: () => path.join(logDir, filename),
    notice: async () => {},
    debug: async () => {},
  };
}

function commandOutput(stdout = '', stderr = '', exitCode = 0, mainResult = stdout.trim()) {
  return {
    stdout,
    stderr,
    exitCode,
    metadata: {
      executionTime: 1,
      commandType: 'test',
      affectedResources: [],
      warnings: [],
      suggestions: [],
    },
    summary: {
      success: exitCode === 0,
      mainResult,
      sideEffects: [],
    },
  };
}

async function add(manager, id, command, output = commandOutput()) {
  await manager.updateAfterCommand({
    id,
    command,
    workingDirectory: process.cwd(),
    environment: {},
    output,
  });
}

async function testDebounceAndOversizedOutput(root) {
  const logDir = fs.mkdtempSync(path.join(root, 'debounce-logs-'));
  const workspace = fs.mkdtempSync(path.join(root, 'debounce-workspace-'));
  let writes = 0;
  let sessionFile;
  const manager = new ContextManager(CONFIG, logger(logDir), {
    workspaceDirectory: workspace,
    onSessionPersisted: (file) => {
      writes += 1;
      sessionFile = file;
    },
  });

  for (let index = 0; index < 200; index++) {
    await add(manager, `command-${index}`, 'true');
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await manager.flushSession();
  assert(writes === 1, `counted exactly one completed write for 200 debounced commands (${writes})`);

  const oversizedCommand = spawnSync(process.execPath, [
    '-e',
    "process.stdout.write('x'.repeat(4096)); process.stderr.write('y'.repeat(4096))",
  ], { encoding: 'utf8' });
  assert(oversizedCommand.stdout.length === 4096 && oversizedCommand.stderr.length === 4096,
    'fixture command produces oversized output on both streams');
  await add(manager, 'oversized', 'oversized-output', commandOutput(
    oversizedCommand.stdout,
    oversizedCommand.stderr,
    0,
    'z'.repeat(4096)
  ));
  await manager.flushSession();
  const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const output = data.commandHistory.at(-1).output;
  assert(output.stdout === 'x'.repeat(1024), 'actual oversized stdout is truncated to 1 KiB');
  assert(output.stderr === 'y'.repeat(1024), 'actual oversized stderr is truncated to 1 KiB');
  assert(output.summary.mainResult === 'z'.repeat(1024), 'actual oversized result is truncated to 1 KiB');
  assert(data.commandHistory.length === 50, 'persisted history is capped at 50 entries');
  await manager.dispose();
}

async function testIsolation(root) {
  const logDir = fs.mkdtempSync(path.join(root, 'isolation-logs-'));
  const workspaceA = fs.mkdtempSync(path.join(root, 'workspace-a-'));
  const workspaceB = fs.mkdtempSync(path.join(root, 'workspace-b-'));
  const files = {};
  const managerA = new ContextManager(CONFIG, logger(logDir), {
    workspaceDirectory: workspaceA,
    onSessionPersisted: (file) => { files.workspaceA = file; },
  });
  const managerB = new ContextManager(CONFIG, logger(logDir), {
    workspaceDirectory: workspaceB,
    onSessionPersisted: (file) => { files.workspaceB = file; },
  });
  await add(managerA, 'a', 'workspace-a-command');
  await add(managerB, 'b', 'workspace-b-command');
  await Promise.all([managerA.flushSession(), managerB.flushSession()]);
  assert(files.workspaceA !== files.workspaceB, 'shared log directory uses workspace-scoped files');
  assert(JSON.parse(fs.readFileSync(files.workspaceA, 'utf8')).commandHistory[0].command === 'workspace-a-command',
    'workspace A cannot restore workspace B history');

  const auditA = new ContextManager(CONFIG, logger(logDir, 'audit-a.log'), {
    workspaceDirectory: workspaceA,
    onSessionPersisted: (file) => { files.auditA = file; },
  });
  const auditB = new ContextManager(CONFIG, logger(logDir, 'audit-b.log'), {
    workspaceDirectory: workspaceA,
    onSessionPersisted: (file) => { files.auditB = file; },
  });
  await add(auditA, 'audit-a', 'audit-a-command');
  await add(auditB, 'audit-b', 'audit-b-command');
  await Promise.all([auditA.flushSession(), auditB.flushSession()]);
  assert(files.auditA !== files.auditB, 'distinct audit files in one directory use distinct session files');

  const clientA = new ContextManager(CONFIG, logger(logDir), {
    workspaceDirectory: workspaceA,
    sessionScope: 'client-a',
    onSessionPersisted: (file) => { files.clientA = file; },
  });
  const clientB = new ContextManager(CONFIG, logger(logDir), {
    workspaceDirectory: workspaceA,
    sessionScope: 'client-b',
    onSessionPersisted: (file) => { files.clientB = file; },
  });
  await add(clientA, 'client-a', 'client-a-command');
  await add(clientB, 'client-b', 'client-b-command');
  await Promise.all([clientA.flushSession(), clientB.flushSession()]);
  assert(files.clientA !== files.clientB, 'explicit server scopes isolate clients in one workspace');

  await Promise.all([
    managerA.dispose(), managerB.dispose(), auditA.dispose(), auditB.dispose(),
    clientA.dispose(), clientB.dispose(),
  ]);
}

async function testSerializationAndDisable(root) {
  const logDir = fs.mkdtempSync(path.join(root, 'queue-logs-'));
  const workspace = fs.mkdtempSync(path.join(root, 'queue-workspace-'));
  let release;
  let firstStarted;
  const blocked = new Promise((resolve) => { firstStarted = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let writes = 0;
  let sessionFile;
  const manager = new ContextManager(CONFIG, logger(logDir), {
    workspaceDirectory: workspace,
    onSessionPersisted: async (file) => {
      writes += 1;
      sessionFile = file;
      if (writes === 1) {
        firstStarted();
        await gate;
      }
    },
  });
  await add(manager, 'first', 'first-command');
  const firstFlush = manager.flushSession();
  await blocked;
  await add(manager, 'second', 'second-command');
  const secondFlush = manager.flushSession();
  release();
  await Promise.all([firstFlush, secondFlush]);

  const commands = JSON.parse(fs.readFileSync(sessionFile, 'utf8')).commandHistory
    .map((entry) => entry.command);
  assert(writes === 2 && commands.join(',') === 'first-command,second-command',
    'overlapping flushes serialize and publish the newest snapshot last');
  assert(!fs.readdirSync(logDir).some((name) => name.endsWith('.tmp')),
    'serialized publications leave no temporary files');

  let disabledWrites = 0;
  const disabled = new ContextManager(CONFIG, logger(logDir), {
    workspaceDirectory: workspace,
    sessionScope: 'disabled',
    onSessionPersisted: () => { disabledWrites += 1; },
  });
  await add(disabled, 'queued', 'must-not-be-written');
  await disabled.updateConfig({ ...CONFIG, sessionPersistence: false });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert(disabledWrites === 0, 'disabling persistence cancels the queued debounce write');

  await manager.dispose();
  await disabled.dispose();
}

async function testDurableClearAndRestore(root) {
  const logDir = fs.mkdtempSync(path.join(root, 'clear-logs-'));
  const workspace = fs.mkdtempSync(path.join(root, 'clear-workspace-'));
  let sessionFile;
  const manager = new ContextManager(CONFIG, logger(logDir), {
    workspaceDirectory: workspace,
    onSessionPersisted: (file) => { sessionFile = file; },
  });
  await add(manager, 'success', 'printf result', commandOutput('result', '', 0, 'result'));
  await manager.flushSession();

  const restored = new ContextManager(CONFIG, logger(logDir), { workspaceDirectory: workspace });
  await restored.loadSession();
  const entry = (await restored.getHistory())[0];
  assert(entry.output.summary.success === true, 'restored output preserves success');
  assert(entry.output.summary.mainResult === 'result', 'restored output preserves its result');
  assert((await restored.getOutput('success')).summary.success === true,
    'restored output cache contains complete summary data');

  await manager.clearHistory();
  assert(JSON.parse(fs.readFileSync(sessionFile, 'utf8')).commandHistory.length === 0,
    'clearHistory publishes the empty snapshot before resolving');
  const afterClear = new ContextManager(CONFIG, logger(logDir), { workspaceDirectory: workspace });
  await afterClear.loadSession();
  assert((await afterClear.getHistory()).length === 0, 'history stays cleared on immediate restart');

  await manager.dispose();
  await restored.dispose();
  await afterClear.dispose();
}

async function testLegacyMigration(root) {
  const logDir = fs.mkdtempSync(path.join(root, 'migration-logs-'));
  const workspace = fs.mkdtempSync(path.join(root, 'migration-workspace-'));
  const legacyFile = path.join(workspace, '.mcp-exec-session.json');
  const legacy = {
    sessionId: 'legacy',
    currentDirectory: workspace,
    environmentVariables: { SAFE_OVERRIDE: 'restored', SECRET_TOKEN: 'hidden' },
    commandHistory: [{
      id: 'legacy-command',
      command: 'printf legacy',
      timestamp: new Date().toISOString(),
      workingDirectory: workspace,
      environment: {},
      relatedCommands: [],
      output: { stdout: 'legacy', stderr: '', exitCode: 0 },
    }],
    fileSystemChanges: [],
  };
  fs.writeFileSync(legacyFile, JSON.stringify(legacy));
  let sessionFile;
  const manager = new ContextManager(CONFIG, logger(logDir), {
    workspaceDirectory: workspace,
    onSessionPersisted: (file) => { sessionFile = file; },
  });
  await manager.loadSession();
  assert(fs.existsSync(sessionFile) && !fs.existsSync(legacyFile),
    'legacy workspace snapshot migrates to the scoped file');
  const entry = (await manager.getHistory())[0];
  assert(entry.output.summary.success && entry.output.summary.mainResult === 'legacy',
    'legacy output receives complete restored summary fields');
  const context = await manager.getCurrentContext();
  assert(context.environmentVariables.SAFE_OVERRIDE === 'restored' &&
    context.environmentVariables.SECRET_TOKEN === undefined,
    'legacy migration keeps safe overrides and drops secret values');

  const foreignWorkspace = fs.mkdtempSync(path.join(root, 'foreign-workspace-'));
  const foreignLogs = fs.mkdtempSync(path.join(root, 'foreign-logs-'));
  fs.writeFileSync(path.join(foreignLogs, 'session.json'), JSON.stringify({
    ...legacy,
    currentDirectory: foreignWorkspace,
  }));
  const isolated = new ContextManager(CONFIG, logger(foreignLogs), { workspaceDirectory: workspace });
  await isolated.loadSession();
  assert((await isolated.getHistory()).length === 0,
    'directory-global legacy data from another workspace is not migrated');

  await manager.dispose();
  await isolated.dispose();
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-session-'));
  try {
    await testDebounceAndOversizedOutput(root);
    await testIsolation(root);
    await testSerializationAndDisable(root);
    await testDurableClearAndRestore(root);
    await testLegacyMigration(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run()
    .then(() => console.log('\n🎉 Session persistence regressions passed'))
    .catch((error) => {
      console.error('\n💥 Session persistence regressions failed:', error);
      process.exitCode = 1;
    });
}

module.exports = { run };
