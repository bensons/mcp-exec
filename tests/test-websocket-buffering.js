/**
 * Terminal viewer replay contract (issue #37):
 *  - a viewer that connects gets the scrollback in a single data message
 *    (plus one status message), never one message per line;
 *  - the replayed bytes are exactly what the PTY emitted, so a trailing prompt
 *    without a newline is not broken onto a line of its own;
 *  - live output still reaches viewers now that the process.nextTick wrappers
 *    are gone.
 */

const WebSocket = require('ws');
const { TerminalSessionManager } = require('../dist/terminal/terminal-session-manager.js');
const { TerminalViewerService } = require('../dist/terminal/viewer-service.js');
const { createTerminalBuffer, appendToBuffer, bufferLines } = require('../dist/terminal/buffer.js');

const viewerConfig = {
  enabled: true,
  port: 0, // ephemeral - other agents/tests run viewers concurrently
  host: '127.0.0.1',
  maxSessions: 5,
  sessionTimeout: 300000,
  bufferSize: 10000,
  enableAuth: false,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function collectMessages(url, idleMs = 500) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    let timer;
    const finish = () => {
      clearTimeout(timer);
      ws.close();
      resolve(messages);
    };
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(finish, idleMs);
    };
    ws.on('open', bump);
    ws.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
      bump();
    });
    ws.on('error', reject);
  });
}

function testBufferHelpers() {
  // Ring trim: cap is bufferSize * 100 bytes, oldest whole chunks go first.
  const buffer = createTerminalBuffer(1); // 100 byte cap
  appendToBuffer(buffer, 'a'.repeat(80));
  appendToBuffer(buffer, 'b'.repeat(80));
  assert(buffer.bytes === 80 && buffer.chunks.join('') === 'b'.repeat(80), 'ring buffer did not trim from the front');
  appendToBuffer(buffer, 'c'.repeat(300));
  assert(buffer.bytes === 100 && buffer.chunks.join('') === 'c'.repeat(100), 'oversized single chunk was not tailed');
  console.log('OK buffer trims by whole chunks and caps oversized chunks');

  // Derived lines: ANSI stripped, \r overwrites resolved, trailing prompt kept.
  const readable = createTerminalBuffer(100);
  appendToBuffer(readable, 'one\r\n\u001b[32mtwo\u001b[0m\r\n');
  appendToBuffer(readable, '50%\r100%\r\n$ ');
  const lines = bufferLines(readable);
  assert(
    JSON.stringify(lines) === JSON.stringify(['one', 'two', '100%', '$ ']),
    `derived lines wrong: ${JSON.stringify(lines)}`
  );
  console.log('OK read-time lines strip ANSI, resolve carriage returns and keep the partial line');
}

async function testReplay(viewerService, port) {
  // 10 000 lines of scrollback ending in a prompt with no trailing newline.
  const expected =
    Array.from({ length: 10000 }, (_, i) => `line ${i}\r\n`).join('') + 'user@host:~$ ';

  const session = {
    sessionId: 'replay-test-session',
    command: 'synthetic',
    args: [],
    cwd: process.cwd(),
    env: {},
    startTime: new Date(),
    lastActivity: new Date(),
    status: 'running',
    buffer: createTerminalBuffer(viewerConfig.bufferSize),
    viewers: new Set(),
  };
  // Feed it the way the PTY would: many small chunks.
  for (const chunk of expected.match(/[\s\S]{1,64}/g)) {
    appendToBuffer(session.buffer, chunk);
  }
  viewerService.addSession(session);

  const messages = await collectMessages(`ws://127.0.0.1:${port}/terminal/${session.sessionId}`);

  assert(messages.length <= 2, `expected <= 2 websocket messages, got ${messages.length}`);
  console.log(`OK 10 000-line session replayed in ${messages.length} websocket message(s)`);

  const data = messages.filter((m) => m.type === 'data');
  assert(data.length === 1, `expected exactly 1 data message, got ${data.length}`);
  assert(data[0].data === expected, 'replayed data does not match the raw PTY output');
  console.log('OK replayed bytes are identical to the raw PTY output');

  assert(
    messages.some((m) => m.type === 'status' && m.status === 'running'),
    'expected a status message after the replay'
  );

  const lines = data[0].data.split('\r\n');
  assert(
    lines[lines.length - 1] === 'user@host:~$ ',
    'trailing prompt was broken onto its own line'
  );
  assert(
    lines[lines.length - 2] === 'line 9999',
    'prompt is not attached to the end of the scrollback'
  );
  console.log('OK trailing prompt without a newline is not broken onto its own line');
}

async function testLiveBroadcast(viewerService, sessionManager, port) {
  const sessionId = await sessionManager.startSession({
    command: 'echo',
    args: ['hello-live'],
    enableTerminalViewer: true,
  });
  const session = sessionManager['sessions'].get(sessionId);
  viewerService.addSession(session);

  const messages = await collectMessages(`ws://127.0.0.1:${port}/terminal/${sessionId}`, 1500);
  const text = messages
    .filter((m) => m.type === 'data')
    .map((m) => m.data)
    .join('');
  assert(text.includes('hello-live'), `live output missing from viewer stream: ${JSON.stringify(text)}`);
  console.log('OK live PTY output still reaches viewers without the nextTick wrappers');

  await sessionManager.killSession(sessionId);
}

async function main() {
  const viewerService = new TerminalViewerService(viewerConfig);
  const sessionManager = new TerminalSessionManager(
    { maxInteractiveSessions: 10, sessionTimeout: 1800000, outputBufferSize: 1000 },
    viewerConfig
  );

  await viewerService.start();
  const port = viewerService['server'].address().port;
  console.log(`Terminal viewer service listening on ephemeral port ${port}`);

  try {
    testBufferHelpers();
    await testReplay(viewerService, port);
    await testLiveBroadcast(viewerService, sessionManager, port);
    console.log('\nAll websocket replay tests passed');
  } finally {
    await sessionManager.shutdown();
    await viewerService.stop();
  }
}

main()
  .then(() => process.exit(0)) // PTY handles keep the loop alive
  .catch((error) => {
    console.error('\nWebsocket replay tests failed:', error);
    process.exit(1);
  });
