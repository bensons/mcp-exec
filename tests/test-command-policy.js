#!/usr/bin/env node

/**
 * Unit tests for shared command-policy helpers.
 */

const assert = require('assert');
const { SecurityManager } = require('../dist/security/manager');
const { assertCommandAllowed, buildFullCommand } = require('../dist/security/command-policy');
const {
  matchesPattern,
  parseBlockedCommandsEnvironment,
  parseCommand,
  tokenizeCommand,
} = require('../dist/security/tokenize');

function createSecurityManager(overrides = {}) {
  return new SecurityManager({
    level: 'permissive',
    confirmDangerous: false,
    allowedDirectories: [process.cwd(), '/tmp'],
    ...overrides,
    blockedCommands: overrides.blockedCommands || [
      'rm -rf /',
      'format',
      'del /f /s /q C:\\',
      'sudo rm -rf /',
      'dd if=/dev/zero',
      'mkfs',
      'fdisk',
      'parted',
    ],
    timeout: 300000,
  });
}

async function expectBlocked(promise, label) {
  try {
    await promise;
    throw new Error(`${label}: expected command to be blocked`);
  } catch (error) {
    assert.match(
      error.message,
      /blocked by security policy/,
      `${label}: unexpected error: ${error.message}`
    );
  }
}

async function run() {
  console.log('🧪 Testing command-policy helpers...\n');

  const securityManager = createSecurityManager();
  const warnings = [];
  const auditLogger = {
    warning: async (message, context, logger) => {
      warnings.push({ message, context, logger });
    },
  };

  console.log('📝 buildFullCommand joins command and args');
  assert.strictEqual(buildFullCommand('echo'), 'echo');
  assert.strictEqual(buildFullCommand('echo', ['hello', 'world']), 'echo hello world');
  assert.strictEqual(buildFullCommand(undefined, ['x']), '');
  console.log('✅ buildFullCommand');

  console.log('📝 allowed commands pass');
  await assertCommandAllowed(securityManager, 'echo hello', auditLogger, { source: 'test' });
  await assertCommandAllowed(securityManager, '   ', auditLogger);
  console.log('✅ allowed commands');

  console.log('📝 blocked commands throw and emit an audit warning');
  await expectBlocked(
    assertCommandAllowed(securityManager, 'rm -rf /', auditLogger, { source: 'unit-test' }),
    'rm -rf /'
  );

  // Blocked-command entries are command patterns, not substrings (issue #26).
  const blocked = [
    'rm -rf /',
    'rm  -rf /',
    'rm -fr /',
    'rm -r -f /',
    'rm -rf //',
    'rm -rf /*',
    'sudo rm -rf /',
    'sudo -u root rm -rf /',
    'echo hi && rm -rf /',
    'echo $(rm -rf /)',
    'mkfs.ext4 /dev/sda1',
    'fdisk /dev/sda',
    'parted /dev/sda',
    'dd if=/dev/zero of=/dev/sda',
    '/sbin/fdisk /dev/sda',
  ];
  for (const command of blocked) {
    await expectBlocked(assertCommandAllowed(securityManager, command, auditLogger), command);
  }

  // Previously blocked by substring matching; these are ordinary commands.
  const allowed = [
    'git log --format=%H -3',
    'npm run format',
    'ls src/formatters',
    'echo departed',
    'rm -rf /tmp/build-cache',
    'echo "dd if=/dev/zero" >> notes.txt',
    'sudo rm -rf /tmp/build-cache',
  ];
  for (const command of allowed) {
    await assertCommandAllowed(securityManager, command, auditLogger, { source: 'false-positive' });
  }
  console.log('✅ blocked-command pattern matching');

  console.log('📝 nested interpreters, groups, and control syntax cannot bypass blocking');
  const publishManager = createSecurityManager({ blockedCommands: ['npm publish'] });
  const nestedBlocked = [
    "sh -c 'npm publish'",
    "bash -lc 'echo preparing; npm publish'",
    '(npm publish)',
    '{ npm publish; }',
    'if npm publish; then echo unexpected; fi',
    'echo ready || npm publish',
    'echo "$(npm publish)"',
    "eval 'npm publish'",
  ];
  for (const command of nestedBlocked) {
    await expectBlocked(assertCommandAllowed(publishManager, command, auditLogger), command);
  }
  console.log('✅ nested and control syntax');

  console.log('📝 transparent wrappers consume options and positional arguments safely');
  const wrappedBlocked = [
    'timeout 5 npm publish',
    'timeout -sKILL 5 npm publish',
    'timeout --signal KILL 5 npm publish',
    'env -u FOO npm publish',
    'env -uFOO npm publish',
    'env --unset=FOO MODE=release npm publish',
    'sudo -uroot npm publish',
    'sudo --user=root npm publish',
    'nice -n5 npm publish',
    'stdbuf --output=L npm publish',
    'xargs -I{} npm publish',
  ];
  for (const command of wrappedBlocked) {
    await expectBlocked(assertCommandAllowed(publishManager, command, auditLogger), command);
  }
  await expectBlocked(
    assertCommandAllowed(publishManager, 'timeout --future-option npm publish', auditLogger),
    'unknown wrapper option fails closed'
  );
  console.log('✅ wrapper parsing');

  console.log('📝 wrappers can themselves be explicitly blocked');
  const sudoManager = createSecurityManager({ blockedCommands: ['sudo'] });
  await expectBlocked(assertCommandAllowed(sudoManager, 'sudo -u root echo safe', auditLogger), 'sudo wrapper');
  await assertCommandAllowed(sudoManager, 'echo sudo', auditLogger);
  console.log('✅ explicit wrapper blocking');

  console.log('📝 attached long-option values and positional order remain significant');
  const namespaceManager = createSecurityManager({
    blockedCommands: ['kubectl delete pod api --namespace=prod'],
  });
  await expectBlocked(
    assertCommandAllowed(namespaceManager, 'kubectl --namespace=prod delete pod api', auditLogger),
    'matching attached option value'
  );
  await assertCommandAllowed(
    namespaceManager,
    'kubectl delete pod api --namespace=staging',
    auditLogger
  );
  const copyManager = createSecurityManager({ blockedCommands: ['cp secret.txt public.txt'] });
  await expectBlocked(
    assertCommandAllowed(copyManager, 'cp secret.txt public.txt', auditLogger),
    'matching positional order'
  );
  await assertCommandAllowed(copyManager, 'cp public.txt secret.txt', auditLogger);
  console.log('✅ option values and positional order');

  console.log('📝 re: entries are treated as raw regexes');
  const regexManager = createSecurityManager({ blockedCommands: ['re:^npm\\s+run\\s+format$'] });
  await expectBlocked(
    assertCommandAllowed(regexManager, 'npm run format', auditLogger),
    're:npm run format'
  );
  await assertCommandAllowed(regexManager, 'npm run format:check', auditLogger);

  const regexEntries = parseBlockedCommandsEnvironment(
    'rm -rf /,re:^echo\\s+\\d{1,3}$,re:^echo foo\\,bar$'
  );
  assert.deepStrictEqual(regexEntries, [
    'rm -rf /',
    're:^echo\\s+\\d{1,3}$',
    're:^echo foo,bar$',
  ]);
  const envRegexManager = createSecurityManager({ blockedCommands: regexEntries });
  await expectBlocked(assertCommandAllowed(envRegexManager, 'echo 123', auditLogger), 'regex quantifier comma');
  await expectBlocked(assertCommandAllowed(envRegexManager, 'echo foo,bar', auditLogger), 'escaped regex comma');
  console.log('✅ re: escape hatch');

  console.log('📝 tokenizer splits sub-commands and expands flags');
  const subs = tokenizeCommand('echo hi && sudo -u root rm -vrf "/some dir"');
  assert.strictEqual(subs.length, 2);
  assert.strictEqual(subs[0].argv0, 'echo');
  assert.strictEqual(subs[1].argv0, 'rm');
  assert.deepStrictEqual([...subs[1].flags].sort(), ['f', 'r', 'v']);
  assert.deepStrictEqual(subs[1].operands, ['/some dir']);

  const windowsPattern = tokenizeCommand('del /f /s /q C:\\', 'win32')[0];
  const windowsCandidate = tokenizeCommand('del /F /S /Q c:\\', 'win32')[0];
  assert.ok(matchesPattern(windowsCandidate, windowsPattern));
  assert.ok(
    tokenizeCommand("echo ' & format C: & echo '", 'win32').some(sub => sub.argv0 === 'format'),
    'cmd.exe single quotes must not hide command separators'
  );
  assert.ok(
    !tokenizeCommand("echo ' & format C: & echo '", 'posix').some(sub => sub.argv0 === 'format'),
    'POSIX single quotes must continue to protect separators'
  );
  assert.ok(
    tokenizeCommand('cmd /c "format C:"', 'win32').some(sub => sub.argv0 === 'format'),
    'cmd.exe /c payload must be inspected'
  );
  console.log('✅ Windows-aware quoting and comparison');

  console.log('📝 ambiguous executable parsing fails closed');
  for (const command of ["echo 'unterminated", '$COMMAND --flag', 'sudo --unknown value echo']) {
    assert.strictEqual(parseCommand(command).complete, false, `${command}: expected incomplete parse`);
    await expectBlocked(assertCommandAllowed(publishManager, command, auditLogger), command);
  }
  console.log('✅ fail-closed parsing');
  console.log('✅ tokenizer');

  assert.ok(warnings.length >= 1, 'expected at least one audit warning');
  assert.strictEqual(warnings[0].message, 'Command blocked by security policy');
  assert.strictEqual(warnings[0].logger, 'security-validator');
  assert.strictEqual(warnings[0].context.fullCommand, 'rm -rf /');
  assert.strictEqual(warnings[0].context.source, 'unit-test');
  assert.ok(warnings[0].context.reason);
  assert.ok(warnings[0].context.riskLevel);
  console.log('✅ blocked commands and audit warning');

  console.log('\n🎉 command-policy unit tests passed');
}

if (require.main === module) {
  run().catch((error) => {
    console.error('💥 command-policy unit tests failed:', error);
    process.exit(1);
  });
}

module.exports = { run };
