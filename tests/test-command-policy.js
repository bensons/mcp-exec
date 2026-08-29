#!/usr/bin/env node

/**
 * Unit tests for shared command-policy helpers.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { SecurityManager, isInside } = require('../dist/security/manager');
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

function managerWith(overrides, configurationBase) {
  return new SecurityManager({
    level: 'permissive',
    confirmDangerous: false,
    allowedDirectories: [],
    blockedCommands: [],
    timeout: 300000,
    ...overrides,
  }, undefined, configurationBase);
}

async function assertAllowed(manager, command, options, label) {
  const result = await manager.validateCommand(command, options);
  assert.ok(result.allowed, `${label}: expected allowed, got: ${result.reason}`);
}

async function assertDenied(manager, command, options, label) {
  const result = await manager.validateCommand(command, options);
  assert.strictEqual(result.allowed, false, `${label}: expected blocked`);
  return result;
}

async function testDirectoryAccess() {
  console.log('\n📝 isInside uses path boundaries, not string prefixes');
  assert.ok(isInside('/home/user', '/home/user'));
  assert.ok(isInside('/home/user', '/home/user/x'));
  assert.ok(!isInside('/home/user', '/home/user-other'));
  assert.ok(!isInside('/home/user', '/home/username2'));
  assert.ok(!isInside('/home/user', '/home'));
  console.log('✅ isInside');

  console.log('📝 allowedDirectories match on path boundaries');
  const allowlisted = managerWith({ allowedDirectories: ['/home/user'] });
  await assertAllowed(allowlisted, 'ls /home/user/x', { cwd: '/home/user' }, 'ls /home/user/x');
  await assertDenied(allowlisted, 'ls /home/user-other', { cwd: '/home/user' }, 'ls /home/user-other');
  await assertDenied(allowlisted, 'ls /home/username2', { cwd: '/home/user' }, 'ls /home/username2');
  console.log('✅ allowedDirectories boundaries');

  console.log('📝 relative paths are resolved against the session cwd');
  // /home/user/a/b + ../../etc/passwd -> /home/user/etc/passwd (inside the allowlist)
  await assertAllowed(allowlisted, 'cat ../../etc/passwd', { cwd: '/home/user/a/b' }, 'stays inside');
  // /home/user/a + ../../etc/passwd -> /home/etc/passwd (escapes the allowlist)
  await assertDenied(allowlisted, 'cat ../../etc/passwd', { cwd: '/home/user/a' }, 'escapes allowlist');
  await assertDenied(allowlisted, 'cat ../../../etc/passwd', { cwd: '/home/user/a/b' }, 'deep traversal');
  console.log('✅ relative path resolution');

  console.log('📝 ~ is expanded to the home directory');
  const homeOnly = managerWith({ allowedDirectories: [os.homedir()] });
  await assertAllowed(homeOnly, 'cat ~/x', { cwd: os.homedir() }, 'cat ~/x');
  await assertDenied(homeOnly, 'cat ~/../other-home/x', { cwd: os.homedir() }, 'cat ~/../other-home/x');
  await assertAllowed(managerWith({ allowedDirectories: ['~'] }), 'cat ~/x', { cwd: os.homedir() }, '~ allowlist entry');
  console.log('✅ ~ expansion');

  console.log('📝 quoted and =-attached paths are extracted');
  await assertDenied(allowlisted, 'tee --output=/etc/hosts', { cwd: '/home/user' }, '--output=/etc/hosts');
  await assertDenied(allowlisted, 'cat "/etc/some file"', { cwd: '/home/user' }, 'quoted path with space');
  await assertDenied(allowlisted, "cat '/etc/some file'", { cwd: '/home/user' }, 'single-quoted path');
  console.log('✅ token extraction');

  console.log('📝 non-path tokens do not trip the allowlist');
  await assertAllowed(allowlisted, 'echo hello.world', { cwd: '/home/user' }, 'bare word with a dot');
  await assertAllowed(allowlisted, 'node --version', { cwd: '/home/user' }, 'flag');
  await assertAllowed(allowlisted, 'curl https://example.com', { cwd: '/home/user' }, 'url');
  console.log('✅ non-path tokens');

  console.log('📝 the effective cwd itself must be allowlisted');
  await assertDenied(allowlisted, 'cat passwd', { cwd: '/etc' }, 'bare operand from outside cwd');
  await assertDenied(allowlisted, 'echo harmless', { cwd: '/var/tmp' }, 'command cwd outside allowlist');
  await assertDenied(allowlisted, '', { cwd: '/var/tmp' }, 'empty command outside allowlist');
  console.log('✅ effective cwd validation');

  console.log('📝 strict mode blocks system directories on path boundaries');
  const strict = managerWith({ level: 'strict' });
  await assertDenied(strict, 'ls /bin', { cwd: '/home/user' }, 'ls /bin');
  await assertDenied(strict, 'ls /bin/ls', { cwd: '/home/user' }, 'ls /bin/ls');
  await assertAllowed(strict, 'ls /binaries', { cwd: '/home/user' }, 'ls /binaries');
  await assertAllowed(strict, 'ls /etcetera', { cwd: '/home/user' }, 'ls /etcetera');
  const strictBase = path.join(path.dirname(fs.realpathSync('/etc')), 'tmp');
  await assertDenied(strict, 'ls ../etc', { cwd: strictBase }, 'relative path into /etc');
  console.log('✅ strict system directories');

  console.log('📝 an empty allowlist means no directory restriction');
  const unrestricted = managerWith({});
  await assertAllowed(unrestricted, 'ls /var/log', { cwd: '/home/user' }, 'empty allowlist');
  console.log('✅ empty allowlist');

  console.log('📝 the cwd option, not process.cwd(), is the resolution base');
  const cwdOnly = managerWith({ allowedDirectories: [process.cwd()] });
  await assertAllowed(cwdOnly, 'cat file.txt', { cwd: path.join(process.cwd(), 'tests') }, 'inside cwd');
  await assertDenied(cwdOnly, 'cat ./x', { cwd: os.tmpdir() }, 'relative path outside cwd');
  console.log('✅ cwd base');

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-policy-'));
  try {
    const allowedRoot = path.join(fixtureRoot, 'allowed');
    const outsideRoot = path.join(fixtureRoot, 'outside');
    fs.mkdirSync(allowedRoot);
    fs.mkdirSync(outsideRoot);
    fs.writeFileSync(path.join(allowedRoot, 'inside.txt'), 'inside');
    fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'secret');
    const fixtureManager = managerWith({ allowedDirectories: [allowedRoot] });

    console.log('📝 local file URLs are checked as filesystem paths');
    await assertAllowed(
      fixtureManager,
      `curl ${pathToFileURL(path.join(allowedRoot, 'inside.txt')).href}`,
      { cwd: allowedRoot },
      'allowed file URL'
    );
    await assertDenied(
      fixtureManager,
      `curl ${pathToFileURL(path.join(outsideRoot, 'secret.txt')).href}`,
      { cwd: allowedRoot },
      'outside file URL'
    );
    await assertDenied(fixtureManager, 'curl file://remote-host/share/file', { cwd: allowedRoot }, 'unsupported file URL');
    console.log('✅ local file URLs');

    console.log('📝 attached shell redirections are split and checked');
    await assertAllowed(fixtureManager, 'cat<inside.txt', { cwd: allowedRoot }, 'attached allowed input redirect');
    await assertDenied(
      fixtureManager,
      `cat<${path.join(outsideRoot, 'secret.txt')}`,
      { cwd: allowedRoot },
      'attached outside input redirect'
    );
    await assertDenied(
      fixtureManager,
      `echo nope 2>${path.join(outsideRoot, 'error.log')}`,
      { cwd: allowedRoot },
      'attached outside output redirect'
    );
    console.log('✅ attached redirections');

    console.log('📝 known shell expansions are resolved and ambiguous expansions fail closed');
    await assertAllowed(
      fixtureManager,
      'cat $HOME/inside.txt',
      { cwd: allowedRoot, env: { HOME: allowedRoot } },
      'allowed HOME expansion'
    );
    const expandedHomeDenial = await assertDenied(
      fixtureManager,
      'cat ${HOME}/secret.txt',
      { cwd: allowedRoot, env: { HOME: outsideRoot } },
      'outside HOME expansion'
    );
    assert.ok(
      !(expandedHomeDenial.reason || '').includes(outsideRoot),
      'policy reason must not expose the environment-derived HOME value'
    );
    await assertDenied(fixtureManager, 'cat $(pwd)/secret.txt', { cwd: allowedRoot }, 'command substitution');
    await assertDenied(fixtureManager, 'cat "unterminated', { cwd: allowedRoot }, 'unterminated quote');
    await assertDenied(fixtureManager, 'cat ../*', { cwd: allowedRoot }, 'wildcard path');
    console.log('✅ shell expansion handling');

    console.log('📝 relative allowlist entries use their configuration base, not command cwd');
    const relativeManager = managerWith({ allowedDirectories: ['.'] }, allowedRoot);
    await assertAllowed(relativeManager, 'cat inside.txt', { cwd: allowedRoot }, 'relative configured root');
    await assertDenied(relativeManager, 'cat secret.txt', { cwd: outsideRoot }, 'caller cwd cannot move configured root');
    console.log('✅ stable relative allowlist base');

    console.log('📝 deterministic cd changes report and validate the next cwd');
    const child = path.join(allowedRoot, 'child');
    fs.mkdirSync(child);
    const cdResult = await fixtureManager.validateCommand('cd child', { cwd: allowedRoot });
    assert.ok(cdResult.allowed, cdResult.reason);
    assert.strictEqual(cdResult.resultingCwd, fs.realpathSync(child));
    await assertDenied(fixtureManager, `cd ${outsideRoot}`, { cwd: allowedRoot }, 'cd outside allowlist');
    await assertDenied(fixtureManager, 'cd child && cat file', { cwd: allowedRoot }, 'compound cd');
    await assertDenied(
      fixtureManager,
      'cd child',
      { cwd: allowedRoot, env: { CDPATH: outsideRoot } },
      'relative cd with CDPATH'
    );
    console.log('✅ stateful cwd policy');

    if (process.platform !== 'win32') {
      console.log('📝 symlinks cannot escape the allowlist');
      const link = path.join(allowedRoot, 'outside-link');
      fs.symlinkSync(outsideRoot, link);
      await assertDenied(fixtureManager, 'cat ./outside-link/secret.txt', { cwd: allowedRoot }, 'symlink escape');
      console.log('✅ symlink containment');
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
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

  await testDirectoryAccess();

  console.log('\n🎉 command-policy unit tests passed');
}

if (require.main === module) {
  run().catch(() => {
    // Individual case labels identify the failing regression without emitting
    // assertion objects that may contain environment-derived path values.
    console.error('💥 command-policy unit tests failed');
    process.exit(1);
  });
}

module.exports = { run };
