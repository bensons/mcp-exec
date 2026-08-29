const {
  appendToBuffer,
  bufferLines,
  bufferText,
  createTerminalBuffer,
} = require('../dist/terminal/buffer.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function testEmptyBuffer() {
  const buffer = createTerminalBuffer(1);
  assertEqual(bufferLines(buffer), [], 'an empty buffer must contain zero lines');
  console.log('OK empty buffers report zero lines');
}

function testByteCapAndUnicodeBoundaries() {
  const buffer = createTerminalBuffer(1); // 100-byte cap
  appendToBuffer(buffer, `${'a'.repeat(98)}😀`); // 102 UTF-8 bytes

  assert(buffer.bytes === 100, `expected a 100-byte buffer, got ${buffer.bytes}`);
  assert(Buffer.byteLength(bufferText(buffer), 'utf8') === 100, 'byte counter differs from retained data');
  assert(bufferText(buffer) === `${'a'.repeat(96)}😀`, 'multibyte tail was not trimmed by encoded bytes');
  assert(!bufferText(buffer).includes('\ufffd'), 'trimming introduced a replacement character');

  const boundary = createTerminalBuffer(1);
  appendToBuffer(boundary, `😀${'b'.repeat(99)}`); // the byte boundary falls inside the emoji
  assert(boundary.bytes === 99, `expected the valid 99-byte suffix, got ${boundary.bytes}`);
  assert(bufferText(boundary) === 'b'.repeat(99), 'a split leading code point was retained');
  assert(!/[\ud800-\udfff]/u.test(bufferText(boundary)), 'trimming retained an unpaired surrogate');
  console.log('OK byte caps preserve UTF-8 and UTF-16 code-point boundaries');
}

function testWholeChunkEviction() {
  const buffer = createTerminalBuffer(1);
  appendToBuffer(buffer, 'é'.repeat(30)); // 60 bytes
  appendToBuffer(buffer, '界'.repeat(20)); // 60 bytes

  assert(buffer.bytes === 60, `expected the newest 60-byte chunk, got ${buffer.bytes}`);
  assert(bufferText(buffer) === '界'.repeat(20), 'oldest complete chunk was not evicted');
  console.log('OK complete chunks are evicted using encoded byte sizes');
}

function testTerminalLineRendering() {
  const buffer = createTerminalBuffer(10);
  appendToBuffer(buffer, 'one\r\n\u001b[32mtwo\u001b[0m\r\n');
  appendToBuffer(buffer, 'Downloading 100%\rDone\n');
  appendToBuffer(buffer, '50%\r100%\r\n$ ');

  assertEqual(
    bufferLines(buffer),
    ['one', 'two', 'Doneloading 100%', '100%', '$ '],
    'terminal lines must preserve carriage-return overwrite suffixes'
  );
  console.log('OK terminal lines model carriage-return overwrites and CRLF');
}

function testRawReplayIsUnchanged() {
  const buffer = createTerminalBuffer(10);
  const raw = '\u001b[33mphase 1\u001b[0m\rphase 2\r\nprompt> ';
  appendToBuffer(buffer, raw);
  assert(bufferText(buffer) === raw, 'readable rendering mutated raw viewer replay');
  console.log('OK readable rendering leaves raw viewer replay unchanged');
}

testEmptyBuffer();
testByteCapAndUnicodeBoundaries();
testWholeChunkEviction();
testTerminalLineRendering();
testRawReplayIsUnchanged();
console.log('\nAll terminal buffer tests passed');
