#!/usr/bin/env node

/**
 * Unit tests for IntentTracker classification and recording.
 *
 * Regression coverage for issue #41:
 *  - ungrouped alternations (`/^ls|dir/`) misclassified `mkdir`, `git stash pop`, ...
 *  - `suggestNextCommands` recorded intents, so every executed command counted twice.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Keep audit logging out of the repo and out of ~/.mcp-exec.
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-intent-'));
process.env.MCP_EXEC_LOG_DIR = logDir;

const { IntentTracker } = require('../dist/utils/intent-tracker');
const { ShellExecutor } = require('../dist/core/executor');
const { SecurityManager } = require('../dist/security/manager');
const { ContextManager } = require('../dist/context/manager');
const { AuditLogger } = require('../dist/audit/logger');

// [command, expected category]
const CLASSIFICATION_CASES = [
  ['ls -la', 'exploration'],
  ['dir', 'exploration'],
  ['mkdir x', 'general'],          // was 'exploration' (/^ls|dir/ matched "dir" in "mkdir")
  ['git stash pop', 'general'],    // was 'monitoring' (/^ps|top|htop/ matched "top" in "pop")
  ['lsof -i', 'general'],          // was 'exploration'
  ['ahead-of-time --build', 'general'], // was 'inspection' (matched "head")
  ['stop-server', 'general'],      // was 'monitoring' (matched "top")
  ['cat file.txt', 'inspection'],
  ['cd /tmp', 'navigation'],
  ['git status', 'development'],
  ['npm install', 'development'],
  ['ps aux', 'monitoring'],
  ['top', 'monitoring'],
  ['find . -name x', 'search'],
  ['curl https://example.com', 'network'],
  ['wget https://example.com', 'network'],
];

function testClassification() {
  console.log('📝 classify() maps commands to the right category');
  const tracker = new IntentTracker();
  for (const [command, expected] of CLASSIFICATION_CASES) {
    assert.strictEqual(
      tracker.classify(command).category,
      expected,
      `"${command}" should classify as "${expected}"`
    );
  }
  console.log('✅ classification');
}

function testClassifyIsPure() {
  console.log('📝 classify()/suggestNextCommands() do not record history');
  const tracker = new IntentTracker();
  tracker.classify('ls -la');
  tracker.suggestNextCommands('ls -la');
  assert.strictEqual(tracker.getIntentSummary().totalCommands, 0);

  tracker.analyzeIntent('ls -la');
  assert.strictEqual(tracker.getIntentSummary().totalCommands, 1);
  assert.deepStrictEqual(tracker.getIntentSummary().categories, { exploration: 1 });
  console.log('✅ classify is side-effect free');
}

function testSuggestionsIncludeRelatedCommands() {
  console.log('📝 suggestNextCommands() keeps the current intent\'s related commands');
  // Regression guard for review feedback on PR #45: making suggestNextCommands
  // side-effect-free removed the just-recorded history entry it used to read its
  // own relatedCommands back from, silently shrinking suggestions from 5 to 3.
  const tracker = new IntentTracker();
  const suggestions = tracker.suggestNextCommands('ls -la');

  assert.deepStrictEqual(
    suggestions,
    ['cd <directory>', 'cat <file>', 'less <file>', 'cd', 'pwd'],
    'a fresh tracker must still suggest the exploration intent\'s related commands'
  );
  // Still pure.
  assert.strictEqual(tracker.getIntentSummary().totalCommands, 0);
  console.log('✅ related commands preserved without recording');
}

function testClassifyReturnsDetachedIntent() {
  console.log('📝 classify() returns a detached intent, not the pattern-table entry');
  // Regression guard for review feedback on PR #45: classify() handed out the
  // object stored in intentPatterns, so a caller's edit rewrote every later
  // classification and every recorded history entry.
  const tracker = new IntentTracker();

  const first = tracker.classify('ls -la');
  first.category = 'MUTATED';
  first.purpose = 'MUTATED';
  first.relatedCommands.push('INJECTED');
  first.suggestedFollowups.push('INJECTED');

  const second = tracker.classify('ls -la');
  assert.notStrictEqual(first, second, 'classify must not return a shared instance');
  assert.strictEqual(second.category, 'exploration', 'category must survive a caller mutation');
  assert.strictEqual(second.purpose, 'List directory contents');
  assert.ok(!second.relatedCommands.includes('INJECTED'), 'relatedCommands must be cloned');
  assert.ok(!second.suggestedFollowups.includes('INJECTED'), 'suggestedFollowups must be cloned');

  // The same leak reached recorded history through analyzeIntent().
  const recorded = tracker.analyzeIntent('ls -la');
  recorded.purpose = 'CORRUPTED';
  assert.strictEqual(
    tracker.getRecentIntents(1)[0].intent.purpose,
    'List directory contents',
    'mutating a returned intent must not corrupt recorded history'
  );

  // Context-enhanced results are detached too (they were a shallow spread).
  const withContext = tracker.classify('ls -la', 'debug this');
  withContext.relatedCommands.push('INJECTED');
  assert.ok(!tracker.classify('ls -la').relatedCommands.includes('INJECTED'));
  console.log('✅ detached intents');
}

async function testExecutorRecordsOnce() {
  console.log('📝 executeCommand records exactly one intent');
  const config = {
    security: {
      level: 'permissive',
      confirmDangerous: false,
      allowedDirectories: [process.cwd(), os.tmpdir()],
      blockedCommands: ['rm -rf /'],
      timeout: 30000,
      sandboxing: { enabled: false, networkAccess: true, fileSystemAccess: 'full' },
    },
    context: {
      preserveWorkingDirectory: true,
      sessionPersistence: false,
      maxHistorySize: 100,
    },
    sessions: {
      maxInteractiveSessions: 1,
      sessionTimeout: 60000,
      outputBufferBytes: 100,
    },
    output: {
      formatStructured: true,
      stripAnsi: true,
      summarizeVerbose: false,
      enableAiOptimizations: true,
      maxOutputLength: 10000,
    },
    audit: {
      enabled: false,
      logLevel: 'error',
      retention: 1,
      logDirectory: logDir,
    },
  };

  const auditLogger = new AuditLogger(config.audit);
  const executor = new ShellExecutor(
    new SecurityManager(config.security),
    new ContextManager(config.context, auditLogger),
    auditLogger,
    config
  );

  try {
    const output = await executor.executeCommand({ command: 'echo', args: ['hello'] });
    assert.strictEqual(output.exitCode, 0, 'echo should succeed');
    assert.strictEqual(
      executor.getIntentSummary().totalCommands,
      1,
      'one executeCommand must record exactly one intent'
    );
  } finally {
    await executor.shutdown();
  }
  console.log('✅ single recording per execution');
}

async function run() {
  console.log('🧪 Testing IntentTracker...\n');
  testClassification();
  testClassifyIsPure();
  testSuggestionsIncludeRelatedCommands();
  testClassifyReturnsDetachedIntent();
  await testExecutorRecordsOnce();
  console.log('\n🎉 All intent tracker tests passed');
}

run()
  .then(() => {
    fs.rmSync(logDir, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Intent tracker tests failed:', error);
    fs.rmSync(logDir, { recursive: true, force: true });
    process.exit(1);
  });
