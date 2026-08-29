#!/usr/bin/env node

/**
 * Tests for terminal viewer authentication (issue #29).
 *
 * Covers: HTTP and WebSocket authorization and rate limits, Bearer-authenticated
 * browser flows, token auto-generation, runtime update safety, resize bounds,
 * and the non-loopback-without-auth start refusal.
 */

const assert = require('assert');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');
const { TerminalViewerService } = require('../dist/terminal/viewer-service');
const { createTerminalBuffer } = require('../dist/terminal/buffer');

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
    buffer: createTerminalBuffer(100),
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

function startMcpServer(env) {
  const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  let stdoutBuffer = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP request ${method} timed out: ${stderr}`));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        child.once('close', resolve);
        child.kill();
      });
    },
  };
}

async function waitForHttp(url, options) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
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
      headers: { Authorization: `bEaReR ${TOKEN}` },
    });
    assert.strictEqual(byHeader.status, 200, 'valid Bearer header should be 200');
    assert.strictEqual(byHeader.headers.get('cache-control'), 'no-store', 'auth responses must not be cached');

    const malformedHeader = await fetch(`${base}/api/sessions`, {
      headers: { Authorization: `Bearer  ${TOKEN}` },
    });
    assert.strictEqual(malformedHeader.status, 401, 'malformed Bearer spacing should be rejected');
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

async function testBearerAuthenticatedPageWebSocket() {
  console.log('📝 Bearer-authenticated viewer pages pass credentials to browser WebSockets');
  const { service, config } = await makeService();
  const sessionId = 'bearer-session';
  service.addSession(makeSession(sessionId));
  await service.start();

  try {
    const response = await fetch(
      `http://127.0.0.1:${config.port}/terminal/${sessionId}/view`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    assert.strictEqual(response.status, 200, 'Bearer-authenticated viewer page should load');
    assert.strictEqual(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.ok(
      html.includes(`initTerminal("${sessionId}", "127.0.0.1", ${config.port}, "${TOKEN}")`),
      'viewer HTML should inject the authenticated WebSocket credential'
    );

    const frontend = await fetch(`http://127.0.0.1:${config.port}/static/terminal.js`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const frontendSource = await frontend.text();
    assert.ok(
      frontendSource.includes('viewerToken || new URLSearchParams'),
      'browser frontend should prefer the server-injected credential'
    );
    assert.ok(
      await wsOpens(`ws://127.0.0.1:${config.port}/terminal/${sessionId}?token=${TOKEN}`),
      'the injected credential should authorize the browser WebSocket'
    );
  } finally {
    await service.stop();
  }
  console.log('✅ Bearer page WebSocket flow');
}

async function testInlineCredentialEscaping() {
  console.log('📝 Embedded viewer credentials are JSON-escaped and never cached');
  const maliciousToken = `'</script><script>globalThis.pwned=true</script><!--`;
  const { service, config } = await makeService({ authToken: maliciousToken });
  const sessionId = 'escaping-session';
  service.addSession(makeSession(sessionId));
  await service.start();

  try {
    const response = await fetch(
      `http://127.0.0.1:${config.port}/terminal/${sessionId}/view?token=${encodeURIComponent(maliciousToken)}`
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.ok(!html.includes(maliciousToken), 'raw credential must not appear in inline script');
    assert.ok(
      html.includes('\\u003c/script\\u003e\\u003cscript\\u003e'),
      'HTML-significant credential characters should use JSON-safe Unicode escapes'
    );
    assert.ok(!html.includes('globalThis.pwned=true</script>'), 'credential must not terminate script');
  } finally {
    await service.stop();
  }
  console.log('✅ inline credential escaping');
}

async function testHttpAuthRateLimit() {
  console.log('📝 Failed HTTP authentication attempts are rate-limited');
  const { service, config } = await makeService();
  const url = `http://127.0.0.1:${config.port}/health?token=wrong`;
  await service.start();

  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await fetch(url);
      assert.strictEqual(response.status, 401, `failed attempt ${attempt + 1} should be unauthorized`);
    }
    const limited = await fetch(url);
    assert.strictEqual(limited.status, 429, 'the next failed attempt should be rate-limited');

    const authorized = await fetch(`http://127.0.0.1:${config.port}/health?token=${TOKEN}`);
    assert.strictEqual(authorized.status, 200, 'valid credentials should not be blocked by failures');
  } finally {
    await service.stop();
  }
  console.log('✅ HTTP auth rate limit');
}

async function testWebSocketAuthRateLimit() {
  console.log('📝 Failed WebSocket authentication attempts are rate-limited');
  const { service, config } = await makeService();
  const sessionId = 'rate-limit-session';
  const url = `ws://127.0.0.1:${config.port}/terminal/${sessionId}?token=wrong`;
  service.addSession(makeSession(sessionId));
  await service.start();

  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      assert.strictEqual(
        await wsCloseCode(url),
        1008,
        `failed attempt ${attempt + 1} should be unauthorized`
      );
    }
    assert.strictEqual(await wsCloseCode(url), 1013, 'the next failed attempt should be rate-limited');
    assert.ok(
      await wsOpens(`ws://127.0.0.1:${config.port}/terminal/${sessionId}?token=${TOKEN}`),
      'valid credentials should not be blocked by failures'
    );
  } finally {
    await service.stop();
  }
  console.log('✅ WebSocket auth rate limit');
}

async function testGeneratedTokenAndUrls() {
  console.log('📝 A token is generated when auth is on but none is configured');
  const { service, config } = await makeService({ authToken: undefined });
  await service.start();

  try {
    service.addSession(makeSession('url-session'));
    const url = service.getSessionUrl('url-session');
    const generatedToken = new URL(url).searchParams.get('token');
    assert.ok(generatedToken, 'start() should generate a token in viewer URLs');
    assert.ok(generatedToken.length >= 24, 'generated token should be long');
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

async function testExternalConfigMutationCannotDisableAuth() {
  console.log('📝 Mutating the caller config cannot disable live non-loopback authentication');
  const { service, config } = await makeService({ host: '0.0.0.0' });
  await service.start();

  try {
    config.enableAuth = false;
    config.authToken = undefined;
    const unauthorized = await fetch(`http://127.0.0.1:${config.port}/health`);
    assert.strictEqual(unauthorized.status, 401, 'live service must retain its safe auth state');
    const authorized = await fetch(`http://127.0.0.1:${config.port}/health?token=${TOKEN}`);
    assert.strictEqual(authorized.status, 200, 'original credentials should remain active');
  } finally {
    await service.stop();
  }
  console.log('✅ live config isolation');
}

async function testRuntimeUpdateRejectsUnsafeAuthDisable() {
  console.log('📝 Runtime updates reject disabling auth on a non-loopback viewer');
  const port = await getFreePort();
  const mcp = startMcpServer({
    MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'true',
    MCP_EXEC_TERMINAL_VIEWER_PORT: String(port),
    MCP_EXEC_TERMINAL_VIEWER_HOST: '0.0.0.0',
    MCP_EXEC_TERMINAL_VIEWER_ENABLE_AUTH: 'true',
    MCP_EXEC_TERMINAL_VIEWER_AUTH_TOKEN: TOKEN,
    MCP_EXEC_AUDIT_ENABLED: 'false',
  });

  try {
    const initialized = await mcp.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'viewer-auth-test', version: '1.0.0' },
    });
    assert.ok(initialized.result, 'MCP server should initialize');

    const healthUrl = `http://127.0.0.1:${port}/health`;
    const ready = await waitForHttp(`${healthUrl}?token=${TOKEN}`);
    assert.strictEqual(ready.status, 200, 'non-loopback viewer should start with auth');

    const update = await mcp.request('tools/call', {
      name: 'update_configuration',
      arguments: {
        section: 'terminalViewer',
        settings: { enableAuth: false },
      },
    });
    assert.match(
      JSON.stringify(update),
      /non-loopback host/i,
      'unsafe runtime update should return an explanatory error'
    );

    const configuration = await mcp.request('tools/call', {
      name: 'get_configuration',
      arguments: { section: 'terminalViewer' },
    });
    const payload = JSON.parse(configuration.result.content[0].text);
    assert.strictEqual(
      payload.configuration.terminalViewer.enableAuth,
      true,
      'rejected update must not mutate stored configuration'
    );

    const unauthorized = await fetch(healthUrl);
    assert.strictEqual(unauthorized.status, 401, 'running viewer must remain authenticated');
  } finally {
    await mcp.stop();
  }
  console.log('✅ unsafe runtime update rejected');
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
  await testBearerAuthenticatedPageWebSocket();
  await testInlineCredentialEscaping();
  await testHttpAuthRateLimit();
  await testWebSocketAuthRateLimit();
  await testGeneratedTokenAndUrls();
  await testNoTokenInUrlsWhenAuthDisabled();
  await testNonLoopbackRequiresAuth();
  await testExternalConfigMutationCannotDisableAuth();
  await testRuntimeUpdateRejectsUnsafeAuthDisable();
  await testResizeBounds();

  console.log('\n🎉 All terminal viewer auth tests passed');
}

run().catch((error) => {
  console.error('\n❌ Terminal viewer auth tests failed:', error);
  process.exit(1);
});
