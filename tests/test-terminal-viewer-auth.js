#!/usr/bin/env node

/**
 * Tests for terminal viewer authentication (issue #29).
 *
 * Covers: 401 without a token, 200 with a token (query string and Bearer header),
 * WebSocket rejection with close code 1008, token auto-generation, resize bounds,
 * and the non-loopback-without-auth start refusal.
 */

const assert = require('assert');
const net = require('net');
const WebSocket = require('ws');
const { TerminalViewerService } = require('../dist/terminal/viewer-service');

const TOKEN = 'test-token-issue-29';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function makeService(overrides) {
  const port = await getFreePort();
  const config = Object.assign(
    {
      enabled: true,
      port,
      host: '127.0.0.1',
      maxSessions: 10,
      sessionTimeout: 60000,
      bufferSize: 100,
      enableAuth: true,
      authToken: TOKEN,
    },
    overrides
  );
  return { service: new TerminalViewerService(config), config };
}

function makeSession(sessionId) {
  return {
    sessionId,
    command: 'echo hello',
    args: [],
    cwd: process.cwd(),
    env: {},
    startTime: new Date(),
    lastActivity: new Date(),
    status: 'running',
    buffer: { lines: [], cursor: { x: 0, y: 0 }, scrollback: 0, maxLines: 100 },
    viewers: new Set(),
  };
}

/** Resolves with the close code, or rejects if the socket stays open. */
function wsCloseCode(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WebSocket ${url} was neither closed nor errored`));
    }, 3000);
    ws.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.on('error', () => {
      /* close follows */
    });
  });
}

function wsOpens(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WebSocket ${url} did not open`));
    }, 3000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve(true);
    });
    ws.on('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket ${url} closed before opening (code ${code})`));
    });
  });
}

async function testHttpAuth() {
  console.log('📝 HTTP routes require the token when enableAuth is true');
  const { service, config } = await makeService();
  const base = `http://127.0.0.1:${config.port}`;
  await service.start();

  try {
    for (const path of ['/api/sessions', '/health', '/static/terminal.js']) {
      const res = await fetch(`${base}${path}`);
      assert.strictEqual(res.status, 401, `${path} without a token should be 401`);
    }

    const wrong = await fetch(`${base}/api/sessions?token=nope`);
    assert.strictEqual(wrong.status, 401, 'wrong token should be 401');

    const byQuery = await fetch(`${base}/api/sessions?token=${TOKEN}`);
    assert.strictEqual(byQuery.status, 200, 'valid ?token= should be 200');
    assert.ok(Array.isArray((await byQuery.json()).sessions), 'response should list sessions');

    const byHeader = await fetch(`${base}/api/sessions`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.strictEqual(byHeader.status, 200, 'valid Bearer header should be 200');
  } finally {
    await service.stop();
  }
  console.log('✅ HTTP auth');
}

async function testNoAuthIsOpen() {
  console.log('📝 HTTP routes stay open when enableAuth is false');
  const { service, config } = await makeService({ enableAuth: false, authToken: undefined });
  await service.start();
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/api/sessions`);
    assert.strictEqual(res.status, 200, 'auth disabled should not gate requests');
  } finally {
    await service.stop();
  }
  console.log('✅ auth disabled');
}

async function testWebSocketAuth() {
  console.log('📝 WebSocket upgrades require the token');
  const { service, config } = await makeService();
  const base = `ws://127.0.0.1:${config.port}/terminal/test-session`;
  service.addSession(makeSession('test-session'));
  await service.start();

  try {
    assert.strictEqual(await wsCloseCode(base), 1008, 'no token should close with 1008');
    assert.strictEqual(await wsCloseCode(`${base}?token=nope`), 1008, 'bad token should close with 1008');
    assert.ok(await wsOpens(`${base}?token=${TOKEN}`), 'valid token should connect');
  } finally {
    await service.stop();
  }
  console.log('✅ WebSocket auth');
}

async function testGeneratedTokenAndUrls() {
  console.log('📝 A token is generated when auth is on but none is configured');
  const { service, config } = await makeService({ authToken: undefined });
  await service.start();

  try {
    assert.ok(config.authToken, 'start() should generate an auth token');
    assert.ok(config.authToken.length >= 24, 'generated token should be long');

    service.addSession(makeSession('url-session'));
    const url = service.getSessionUrl('url-session');
    assert.ok(
      url.includes(`token=${encodeURIComponent(config.authToken)}`),
      `session URL should carry the token: ${url}`
    );
    assert.ok(
      service.getStatus().activeSessions[0].url.includes('token='),
      'getStatus() URLs should carry the token'
    );

    const res = await fetch(url);
    assert.strictEqual(res.status, 200, 'the generated URL should be usable as-is');
    const html = await res.text();
    assert.ok(html.includes(`/static/terminal.js?token=`), 'static asset URLs should carry the token');
  } finally {
    await service.stop();
  }
  console.log('✅ token generation');
}

async function testNoTokenInUrlsWhenAuthDisabled() {
  console.log('📝 URLs stay clean when auth is disabled');
  const { service } = await makeService({ enableAuth: false, authToken: undefined });
  await service.start();
  try {
    service.addSession(makeSession('plain-session'));
    assert.ok(!service.getSessionUrl('plain-session').includes('token='), 'no token query expected');
  } finally {
    await service.stop();
  }
  console.log('✅ clean URLs');
}

async function testNonLoopbackRequiresAuth() {
  console.log('📝 Non-loopback binds refuse to start without auth');
  const { service } = await makeService({ host: '0.0.0.0', enableAuth: false, authToken: undefined });
  await assert.rejects(
    () => service.start(),
    /non-loopback host/i,
    'binding 0.0.0.0 without auth should be refused'
  );
  console.log('✅ non-loopback refusal');
}

async function testResizeBounds() {
  console.log('📝 Resize payloads are bounds-checked');
  const { service } = await makeService();
  const session = makeSession('resize-session');
  const resizes = [];
  session.pty = {
    onData() {},
    onExit() {},
    resize(cols, rows) {
      resizes.push([cols, rows]);
    },
  };
  service.addSession(session);

  const send = (size) =>
    service.handleWebSocketMessage('conn', 'resize-session', {
      type: 'resize',
      sessionId: 'resize-session',
      size,
      timestamp: new Date(),
    });

  send({ cols: 120, rows: 40 });
  send({ cols: 0, rows: 24 });
  send({ cols: 80, rows: 0 });
  send({ cols: 501, rows: 24 });
  send({ cols: 80, rows: 301 });
  send({ cols: 80.5, rows: 24 });
  send({ cols: '80', rows: 24 });

  assert.deepStrictEqual(resizes, [[120, 40]], 'only the in-range resize should reach the PTY');
  console.log('✅ resize bounds');
}

async function run() {
  console.log('🧪 Testing terminal viewer authentication...\n');

  await testHttpAuth();
  await testNoAuthIsOpen();
  await testWebSocketAuth();
  await testGeneratedTokenAndUrls();
  await testNoTokenInUrlsWhenAuthDisabled();
  await testNonLoopbackRequiresAuth();
  await testResizeBounds();

  console.log('\n🎉 All terminal viewer auth tests passed');
}

run().catch((error) => {
  console.error('\n❌ Terminal viewer auth tests failed:', error);
  process.exit(1);
});
