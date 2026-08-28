#!/usr/bin/env node

/**
 * Unit tests for shared command-policy helpers.
 */

const assert = require('assert');
const { SecurityManager } = require('../dist/security/manager');
const { assertCommandAllowed, buildFullCommand } = require('../dist/security/command-policy');

function createSecurityManager() {
  return new SecurityManager({
    level: 'permissive',
    confirmDangerous: false,
    allowedDirectories: [process.cwd(), '/tmp'],
    blockedCommands: [
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
  await expectBlocked(
    assertCommandAllowed(securityManager, 'sudo rm -rf /tmp', auditLogger),
    'sudo rm -rf /tmp'
  );

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
