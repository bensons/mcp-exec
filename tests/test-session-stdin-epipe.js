#!/usr/bin/env node

/**
 * Regression tests for issue #23: writing to an interactive session whose child has closed
 * its stdin must reject the sendInput promise instead of raising an uncaught EPIPE that
 * takes down the whole MCP server.
 */

const assert = require('assert');
const os = require('os');
const { InteractiveSessionManager } = require('../dist/core/interactive-session-manager');

const SESSION_CONFIG = {
  maxInteractiveSessions: 5,
  sessionTimeout: 60000,
  outputBufferSize: 100,
};

const BIG_INPUT = 'x'.repeat(70000); // > the 64KB pipe buffer, so the write cannot be absorbed

const uncaught = [];
process.on('uncaughtException', (error) => {
  uncaught.push(error);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function expectRejection(promise, label) {
  try {
    await promise;
    return null;
  } catch (error) {
    assert.ok(error instanceof Error, `${label}: expected an Error, got ${error}`);
    return error;
  }
}

async function run() {
  console.log('🧪 Testing interactive session stdin EPIPE handling...\n');

  const manager = new InteractiveSessionManager(SESSION_CONFIG);

  try {
    console.log('📝 sendInput on a child that closed its stdin rejects instead of crashing');
    const sessionId = await manager.startSession({
      command: "sh -c 'exec 0<&-; sleep 5'",
      cwd: os.tmpdir(),
    });
    await sleep(300); // let the shell close its stdin

    const first = await expectRejection(
      manager.sendInput({ sessionId, input: BIG_INPUT }),
      'first sendInput'
    );
    await sleep(100); // the EPIPE from a backpressured write arrives asynchronously
    const second = await expectRejection(
      manager.sendInput({ sessionId, input: BIG_INPUT }),
      'second sendInput'
    );

    assert.ok(
      first || second,
      'expected at least one sendInput to reject once the child closed its stdin'
    );
    const reported = (second || first).message;
    assert.match(
      reported,
      /stdin is closed|EPIPE|not running/,
      `unexpected rejection message: ${reported}`
    );
    console.log(`✅ rejected with: ${reported}`);

    console.log('📝 the stdin error is recorded on the session, not thrown at the process');
    const session = manager.getSession(sessionId);
    assert.ok(session, 'session should still exist');
    assert.strictEqual(session.status, 'error', 'session status should flip to error');
    assert.ok(
      session.errorBuffer.some((line) => line.includes('stdin error')),
      `expected a stdin error in the error buffer, got: ${JSON.stringify(session.errorBuffer)}`
    );
    console.log('✅ stdin error captured on the session');

    console.log('📝 killSession still terminates the (alive) child after a stdin error');
    const pid = session.process.pid;
    await manager.killSession(sessionId);
    await sleep(300);
    assert.throws(
      () => process.kill(pid, 0),
      /ESRCH/,
      'child process should have been terminated, not leaked'
    );
    console.log('✅ child terminated');

    console.log('📝 sendInput after the child exited rejects');
    const shortId = await manager.startSession({ command: 'sh -c "exit 0"', cwd: os.tmpdir() });
    await sleep(400);
    const afterExit = await expectRejection(
      manager.sendInput({ sessionId: shortId, input: 'hello' }),
      'sendInput after exit'
    );
    assert.ok(afterExit, 'expected sendInput on an exited session to reject');
    console.log(`✅ rejected with: ${afterExit.message}`);

    console.log('📝 the manager still works afterwards (no server-wide damage)');
    const liveId = await manager.startSession({ command: 'cat', cwd: os.tmpdir() });
    await manager.sendInput({ sessionId: liveId, input: 'still alive' });
    await sleep(300);
    const output = await manager.readOutput(liveId);
    assert.match(output.stdout, /still alive/, `unexpected session output: ${output.stdout}`);
    console.log('✅ subsequent sessions unaffected');
  } finally {
    await manager.shutdown();
  }

  await sleep(200);
  assert.strictEqual(
    uncaught.length,
    0,
    `expected no uncaught exceptions, got: ${uncaught.map((e) => e.message).join(', ')}`
  );

  console.log('\n🎉 session stdin EPIPE tests passed');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('💥 session stdin EPIPE tests failed:', error);
      process.exit(1);
    });
}

module.exports = { run };
