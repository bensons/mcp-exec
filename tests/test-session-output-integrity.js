#!/usr/bin/env node

/**
 * Regression tests for interactive session output integrity (issue #33).
 *
 * Output must be returned verbatim: lines split across data chunks stay one line,
 * blank lines survive, multi-byte characters are never cut in half, and buffer
 * overflow is reported via droppedBytes instead of silently mangling the text.
 */

const assert = require('assert');
const path = require('path');

const { InteractiveSessionManager } = require(path.resolve(__dirname, '..', 'dist', 'core', 'interactive-session-manager.js'));

const baseConfig = {
  maxInteractiveSessions: 10,
  sessionTimeout: 60000,
  outputBufferBytes: 262144,
};

function newManager(overrides = {}) {
  return new InteractiveSessionManager({ ...baseConfig, ...overrides });
}

/** Poll readOutput until the session stops running, accumulating everything. */
async function drain(manager, sessionId, timeoutMs = 10000) {
  const started = Date.now();
  let stdout = '';
  let stderr = '';
  let droppedBytes = 0;

  for (;;) {
    const out = await manager.readOutput(sessionId);
    stdout += out.stdout;
    stderr += out.stderr;
    droppedBytes += out.droppedBytes;

    if (out.status !== 'running') {
      // One last read to pick up data delivered alongside the exit
      const tail = await manager.readOutput(sessionId);
      return {
        stdout: stdout + tail.stdout,
        stderr: stderr + tail.stderr,
        droppedBytes: droppedBytes + tail.droppedBytes,
        status: out.status,
      };
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out draining session ${sessionId}`);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function run(command, overrides) {
  const manager = newManager(overrides);
  try {
    const sessionId = await manager.startSession({ command });
    return await drain(manager, sessionId);
  } finally {
    await manager.shutdown();
  }
}

const tests = {
  async 'blank lines and chunk-split lines survive'() {
    // The sleep forces "b" and "c" into separate data chunks; they are one line.
    const { stdout } = await run(`printf 'a\\n\\nb'; sleep 0.2; printf 'c\\n'`);
    assert.strictEqual(stdout, 'a\n\nbc\n');
  },

  async 'multibyte output is byte-identical'() {
    const { stdout } = await run(`printf '日本語\\n'; sleep 0.2; printf '🎉 émoji\\n'`);
    assert.strictEqual(stdout, '日本語\n🎉 émoji\n');
    assert.ok(!stdout.includes('�'), 'replacement character in output');
  },

  async 'multibyte characters split across chunks are rejoined'() {
    // Write one CJK character one byte at a time so every data chunk cuts a code point.
    const bytes = Buffer.from('日本語', 'utf8');
    // POSIX printf requires octal byte escapes; dash does not support \xNN.
    const escaped = [...bytes].map(b => `\\${b.toString(8).padStart(3, '0')}`);
    const parts = escaped.map(part => `printf '${part}'; sleep 0.02;`).join(' ');
    const { stdout } = await run(`${parts} printf '\\n'`);
    assert.strictEqual(stdout, '日本語\n');
  },

  async 'trailing whitespace and CRLF are preserved'() {
    const { stdout } = await run(`printf 'one\\r\\ntwo  \\n'`);
    assert.strictEqual(stdout, 'one\r\ntwo  \n');
  },

  async 'stderr is buffered verbatim and kept separate'() {
    const { stdout, stderr } = await run(`printf 'out\\n'; printf 'err\\n\\nerr2\\n' 1>&2`);
    assert.strictEqual(stdout, 'out\n');
    assert.strictEqual(stderr, 'err\n\nerr2\n');
  },

  async 'overflow drops from the front and reports droppedBytes'() {
    const { stdout, droppedBytes } = await run(
      `for i in $(seq 1 200); do printf 'line%s\\n' "$i"; done`,
      { outputBufferBytes: 256 }
    );
    assert.ok(droppedBytes > 0, 'expected droppedBytes > 0');
    assert.ok(Buffer.byteLength(stdout) <= 256, `buffer over cap: ${Buffer.byteLength(stdout)}`);
    // Oldest lines dropped, newest retained, and the cut lands on a line boundary.
    assert.ok(stdout.endsWith('line200\n'), `unexpected tail: ${JSON.stringify(stdout)}`);
    assert.ok(!stdout.includes('line1\n'), 'oldest line should have been dropped');
    assert.ok(/^line\d+\n/.test(stdout), `cut mid-line: ${JSON.stringify(stdout.slice(0, 20))}`);
  },

  async 'overflow of a single long multibyte line keeps code points intact'() {
    const { stdout, droppedBytes } = await run(
      `for i in $(seq 1 200); do printf '日'; done; printf '\\n'`,
      { outputBufferBytes: 64 }
    );
    assert.ok(droppedBytes > 0, 'expected droppedBytes > 0');
    assert.ok(!stdout.includes('�'), 'replacement character after front-trim');
    assert.strictEqual(stdout.replace(/\n$/, ''), '日'.repeat(stdout.replace(/\n$/, '').length));
  },

  async 'single oversized newline-terminated chunk keeps its newest tail'() {
    const manager = newManager({ outputBufferBytes: 64 });
    try {
      const buffer = manager.createOutputBuffer();
      const droppedBytes = manager.appendCapped(buffer, `${'x'.repeat(600)}\n`);
      const stdout = manager.consumeBuffer(buffer);

      assert.strictEqual(stdout, `${'x'.repeat(63)}\n`);
      assert.strictEqual(droppedBytes, 537);
      assert.strictEqual(Buffer.byteLength(stdout), 64);
    } finally {
      await manager.shutdown();
    }
  },

  async 'small hot-path appends encode only the new chunks'() {
    const manager = newManager({ outputBufferBytes: 64 });
    const originalFrom = Buffer.from;
    let largestEncodedString = 0;
    try {
      const buffer = manager.createOutputBuffer();
      Buffer.from = function(value, ...args) {
        if (typeof value === 'string') {
          largestEncodedString = Math.max(largestEncodedString, value.length);
        }
        return Reflect.apply(originalFrom, Buffer, [value, ...args]);
      };

      let droppedBytes = 0;
      for (let i = 0; i < 2000; i++) {
        droppedBytes += manager.appendCapped(buffer, 'abcd');
      }
      Buffer.from = originalFrom;

      const stdout = manager.consumeBuffer(buffer);
      assert.strictEqual(largestEncodedString, 4, 'append re-encoded retained history');
      assert.strictEqual(stdout, 'abcd'.repeat(16));
      assert.strictEqual(droppedBytes, (2000 - 16) * 4);
    } finally {
      Buffer.from = originalFrom;
      await manager.shutdown();
    }
  },

  async 'readOutput clears the buffer and resets droppedBytes'() {
    const manager = newManager();
    try {
      const sessionId = await manager.startSession({ command: `printf 'x\\n'` });
      await drain(manager, sessionId);
      const second = await manager.readOutput(sessionId);
      assert.strictEqual(second.stdout, '');
      assert.strictEqual(second.stderr, '');
      assert.strictEqual(second.droppedBytes, 0);
    } finally {
      await manager.shutdown();
    }
  },
};

async function main() {
  let failures = 0;

  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      console.log(`✅ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`❌ ${name}: ${error.message}`);
    }
  }

  if (failures > 0) {
    console.error(`\n💥 ${failures} session output integrity test(s) failed`);
    process.exit(1);
  }
  console.log('\n🎉 Session output integrity tests passed');
}

if (require.main === module) {
  main();
}

module.exports = { main };
