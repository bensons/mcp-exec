#!/usr/bin/env node

/**
 * Simple smoke test for startup, activity, and SIGTERM shutdown.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function testBasicLifecycle() {
  console.log('🧪 Testing Basic MCP Server Lifecycle\n');

  const serverPath = path.join(__dirname, '..', 'dist', 'index.js');
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Built server not found at ${serverPath}; run \`npm run build\` first.`);
  }

  const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-simple-lifecycle-'));
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('MCP_EXEC_'))
  );

  console.log('📡 Test: Basic startup and SIGTERM shutdown');

  try {
    await new Promise((resolve, reject) => {
      const server = spawn(process.execPath, [serverPath], {
        cwd: testDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...inheritedEnvironment,
          HOME: testDirectory,
          USERPROFILE: testDirectory,
          NODE_ENV: 'test',
          MCP_EXEC_AUDIT_LOG: path.join(testDirectory, 'audit.log'),
          MCP_EXEC_LOG_DIR: testDirectory,
          MCP_EXEC_WORKSPACE_DIR: testDirectory,
          MCP_EXEC_SESSION_SCOPE: 'simple-lifecycle',
          MCP_EXEC_INACTIVITY_TIMEOUT: '0',
          MCP_EXEC_SHUTDOWN_TIMEOUT: '5000',
          MCP_EXEC_ENABLE_HEARTBEAT: 'true',
          MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'false',
          MCP_EXEC_TERMINAL_VIEWER_PORT: '0',
          MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED: 'false',
        },
      });

      let stdout = '';
      let stderr = '';
      let initialized = false;
      let toolCalled = false;

      const cleanupTimers = () => {
        clearTimeout(initializeTimer);
        clearTimeout(toolTimer);
        clearTimeout(signalTimer);
        clearTimeout(timeoutTimer);
      };

      server.stdout.on('data', data => {
        stdout += data.toString();
        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            if (message.id === 1) initialized = true;
            if (message.id === 2) toolCalled = true;
          } catch {
            // Ignore non-JSON stdout.
          }
        }
      });

      server.stderr.on('data', data => {
        stderr += data.toString();
      });

      const initializeTimer = setTimeout(() => {
        server.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'simple-test', version: '1.0.0' },
          },
        }) + '\n');
      }, 100);

      const toolTimer = setTimeout(() => {
        server.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'get_security_status',
            arguments: {},
          },
        }) + '\n');
      }, 300);

      const signalTimer = setTimeout(() => {
        server.kill('SIGTERM');
      }, 500);

      const timeoutTimer = setTimeout(() => {
        if (server.exitCode === null && server.signalCode === null) {
          server.kill('SIGKILL');
        }
        cleanupTimers();
        reject(new Error('Timed out waiting for SIGTERM shutdown'));
      }, 10000);

      server.once('close', (code, signal) => {
        cleanupTimers();
        if (code === 0 && signal === null && initialized && toolCalled) {
          console.log(`🏁 Server exited cleanly after initialization and activity`);
          resolve();
          return;
        }
        reject(new Error(
          `Server failed lifecycle smoke test (code=${code}, signal=${signal}, ` +
          `initialized=${initialized}, toolCalled=${toolCalled})\n${stderr.slice(-1000)}`
        ));
      });

      server.once('error', error => {
        cleanupTimers();
        reject(error);
      });
    });

    console.log('✅ Test completed successfully!');
  } finally {
    fs.rmSync(testDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  testBasicLifecycle().catch(error => {
    console.error('❌ Test failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { testBasicLifecycle };
