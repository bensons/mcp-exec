#!/usr/bin/env node

/**
 * Cross-platform regression tests for the shell option (issue #39).
 */

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-shell-'));
const SHELL_DIR = path.join(TMP_DIR, 'shell path (test)');
const BLOCKED_SHELL = path.join(TMP_DIR, process.platform === 'win32' ? 'blocked-shell.exe' : 'blocked-shell');

function copyExecutable(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (process.platform !== 'win32') {
    fs.chmodSync(destination, 0o755);
  }
}

function createTestShell() {
  const shellName = process.platform === 'win32' ? 'cmd.exe' : 'test-shell';
  const shellPath = path.join(SHELL_DIR, shellName);
  const systemShell = process.platform === 'win32'
    ? process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
    : '/bin/sh';

  if (process.platform === 'win32') {
    copyExecutable(systemShell, shellPath);
  } else {
    fs.mkdirSync(path.dirname(shellPath), { recursive: true });
    fs.symlinkSync(systemShell, shellPath);
  }
  copyExecutable(process.execPath, BLOCKED_SHELL);
  return { shellName, shellPath };
}

function startServer() {
  const allowedRoot = path.parse(process.execPath).root;
  const server = spawn(process.execPath, [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: TMP_DIR,
    env: {
      ...process.env,
      MCP_EXEC_ALLOWED_DIRECTORIES: [allowedRoot, TMP_DIR].join(','),
      MCP_EXEC_BLOCKED_COMMANDS: BLOCKED_SHELL,
      MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED: 'false',
      MCP_EXEC_LOG_DIR: TMP_DIR,
      MCP_EXEC_SESSION_PERSISTENCE: 'false',
      MCP_EXEC_TERMINAL_VIEWER_PORT: '0',
    },
  });

  let nextId = 1;
  let buffer = '';
  let stderr = '';
  const pending = new Map();

  server.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const handler = pending.get(message.id);
      if (handler) {
        pending.delete(message.id);
        handler.resolve(message);
      }
    }
  });

  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  server.on('close', (code) => {
    for (const { reject } of pending.values()) {
      reject(new Error(`Server exited with code ${code}: ${stderr.slice(-1000)}`));
    }
    pending.clear();
  });

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for response to ${method}: ${stderr.slice(-1000)}`));
    }, 20000);
    pending.set(id, {
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const callTool = async (name, args) => {
    const response = await request('tools/call', { name, arguments: args });
    if (response.error) {
      throw new Error(response.error.message || JSON.stringify(response.error));
    }
    return response.result.content.map((part) => part.text).join('\n');
  };

  const close = () => new Promise((resolve) => {
    if (server.exitCode !== null || server.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 2000);
    server.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    server.kill();
  });

  return { request, callTool, close };
}

function extractSessionId(text) {
  const match = text.match(/Session ID:\*\* `([^`]+)`/);
  assert.ok(match, `Expected a session ID in:\n${text}`);
  return match[1];
}

async function waitForSessionOutput(client, sessionId, expected) {
  const deadline = Date.now() + 10000;
  let output = '';
  while (Date.now() < deadline) {
    output = await client.callTool('read_session_output', { sessionId });
    if (output.includes(expected)) {
      return output;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expected} in session output:\n${output}`);
}

async function testShellOption() {
  console.log('🧪 Testing shell option behavior...');
  const { shellName, shellPath } = createTestShell();

  // Unit-level resolution covers paths that cannot necessarily serve as a shell
  // on every host (notably copied executables on native Windows).
  const { resolveShellOption } = require('../dist/core/shell-option');
  assert.strictEqual(resolveShellOption(shellPath), shellPath);
  assert.strictEqual(
    resolveShellOption(shellName, {
      cwd: TMP_DIR,
      env: { PATH: path.relative(TMP_DIR, SHELL_DIR), PATHEXT: process.env.PATHEXT },
    }),
    shellPath
  );
  assert.throws(() => resolveShellOption('rm -rf /'), /Invalid shell/);
  console.log('✅ absolute whitespace paths and child cwd/PATH resolution');

  const client = startServer();
  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'shell-option-test', version: '1.0.0' },
    });

    const directMarker = 'DIRECT_ARGS:';
    const direct = await client.callTool('execute_command', {
      command: process.execPath,
      args: [
        '-e',
        `process.stdout.write(${JSON.stringify(directMarker)} + JSON.stringify(process.argv.slice(1)))`,
        'a b',
        '$NOT_EXPANDED',
      ],
      shell: false,
    });
    assert.ok(
      direct.includes(`${directMarker}["a b","$NOT_EXPANDED"]`),
      `shell:false did not preserve arguments:\n${direct}`
    );
    console.log('✅ execute_command shell:false preserves arguments with process.execPath');

    const namedShell = await client.callTool('start_interactive_session', {
      command: process.platform === 'win32' ? 'echo CHILD_PATH_OK' : 'printf CHILD_PATH_OK',
      cwd: TMP_DIR,
      env: {
        PATH: path.relative(TMP_DIR, SHELL_DIR),
        ...(process.env.PATHEXT ? { PATHEXT: process.env.PATHEXT } : {}),
      },
      shell: shellName,
    });
    const namedSessionId = extractSessionId(namedShell);
    await waitForSessionOutput(client, namedSessionId, 'CHILD_PATH_OK');
    console.log('✅ bare custom shell uses the child environment PATH and cwd');

    const blocked = await client.callTool('start_interactive_session', {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("SHOULD_NOT_RUN")'],
      shell: BLOCKED_SHELL,
    });
    assert.match(blocked, /blocked by security policy/, blocked);
    assert.ok(!blocked.includes('Session ID:**'), blocked);
    console.log('✅ custom shell executable is checked by command policy');

    const viewerMarker = 'VIEWER_ARGS:';
    const viewed = await client.callTool('execute_command', {
      command: process.execPath,
      args: [
        '-e',
        `process.stdout.write(${JSON.stringify(viewerMarker)} + JSON.stringify(process.argv.slice(1)))`,
        'a b',
        '$NOT_EXPANDED',
      ],
      shell: false,
      enableTerminalViewer: true,
    });
    const viewerSessionId = extractSessionId(viewed);
    const viewerOutput = await waitForSessionOutput(client, viewerSessionId, viewerMarker);
    const viewerData = JSON.parse(viewerOutput);
    assert.strictEqual(
      viewerData.recentOutput,
      `${viewerMarker}["a b","$NOT_EXPANDED"]`,
      `terminal-viewer shell:false did not preserve arguments:\n${viewerOutput}`
    );
    console.log('✅ terminal-viewer shell:false directly spawns the command');

    await client.callTool('kill_session', { sessionId: namedSessionId }).catch(() => {});
    await client.callTool('kill_session', { sessionId: viewerSessionId }).catch(() => {});
  } finally {
    await client.close();
  }

  console.log('🎉 Shell option regression tests passed');
}

if (require.main === module) {
  testShellOption().catch((error) => {
    console.error('💥 Shell option tests failed:', error);
    process.exit(1);
  });
}

module.exports = { testShellBehavior: testShellOption, testShellOption };
