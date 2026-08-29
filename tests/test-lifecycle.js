#!/usr/bin/env node

/**
 * Regression tests for MCP server process lifecycle behavior.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXIT_TIMEOUT_MS = 15000;
const INITIALIZE_TIMEOUT_MS = 10000;

class LifecycleTest {
  constructor() {
    this.serverPath = path.join(__dirname, '..', 'dist', 'index.js');
    this.results = [];
    this.tempRoot = null;
    this.nextRequestId = 1;
  }

  async runTests() {
    if (!fs.existsSync(this.serverPath)) {
      throw new Error(
        `Built server not found at ${this.serverPath}; run \`npm run build\` first.`
      );
    }

    this.tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-lifecycle-'));
    console.log('🧪 Testing MCP Server Process Lifecycle Improvements\n');

    try {
      await this.testGracefulShutdown('SIGTERM');
      await this.testGracefulShutdown('SIGINT');
      await this.testClientDisconnection();
      await this.testInactivityTimeout();
      await this.testBrokenPipe();

      const { passed, total } = this.printResults();
      if (passed !== total) {
        throw new Error(`${total - passed} lifecycle test(s) failed`);
      }
    } finally {
      if (this.tempRoot) {
        fs.rmSync(this.tempRoot, { recursive: true, force: true });
      }
    }
  }

  spawnServer(testName, extraEnv = {}) {
    const testDirectory = path.join(
      this.tempRoot,
      testName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    );
    fs.mkdirSync(testDirectory, { recursive: true });

    const child = spawn(process.execPath, [this.serverPath], {
      cwd: testDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: testDirectory,
        USERPROFILE: testDirectory,
        NODE_ENV: 'test',
        MCP_EXEC_LOG_DIR: testDirectory,
        MCP_EXEC_WORKSPACE_DIR: testDirectory,
        MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED: 'false',
        ...extraEnv,
      },
    });

    let stderr = '';
    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    return {
      child,
      getStderr: () => stderr,
    };
  }

  async initialize(child) {
    const id = this.nextRequestId++;
    const response = new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.off('close', onClose);
        child.off('error', onError);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onData = data => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            if (message.id === id) {
              finish(resolve, message);
              return;
            }
          } catch {
            // Ignore non-JSON stdout; the MCP response is line-delimited JSON.
          }
        }
      };
      const onClose = (code, signal) => {
        finish(reject, new Error(
          `Server exited before initialization completed (code=${code}, signal=${signal})`
        ));
      };
      const onError = error => finish(reject, error);
      const timer = setTimeout(() => {
        finish(reject, new Error('Timed out waiting for initialize response'));
      }, INITIALIZE_TIMEOUT_MS);

      child.stdout.on('data', onData);
      child.once('close', onClose);
      child.once('error', onError);
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'lifecycle-test', version: '1.0.0' },
      },
    }) + '\n');

    const message = await response;
    if (message.error) {
      throw new Error(`Initialize failed: ${JSON.stringify(message.error)}`);
    }
  }

  waitForExit(child, timeout = EXIT_TIMEOUT_MS) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve({
        code: child.exitCode,
        signal: child.signalCode,
        timedOut: false,
      });
    }

    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off('close', onClose);
        resolve(result);
      };
      const onClose = (code, signal) => finish({ code, signal, timedOut: false });
      const timer = setTimeout(() => {
        // `killed` only means a signal was delivered. Liveness is represented by
        // exitCode/signalCode remaining null.
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        finish({
          code: child.exitCode,
          signal: child.signalCode,
          timedOut: true,
        });
      }, timeout);

      child.once('close', onClose);
    });
  }

  recordResult(test, success, duration, details = {}) {
    console.log(`   Exit code: ${details.code}, Signal: ${details.signal}, Duration: ${duration}ms`);
    console.log(`   Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
    if (!success && details.stderr) {
      console.log(`   Stderr: ${details.stderr}`);
    }
    console.log('');
    this.results.push({ test, success, duration, details });
  }

  async testGracefulShutdown(signal) {
    const testName = `Graceful shutdown (${signal})`;
    console.log(`📡 Test: ${testName}`);
    const { child, getStderr } = this.spawnServer(testName);
    const startedAt = Date.now();

    try {
      await this.initialize(child);
      const exit = this.waitForExit(child);
      child.kill(signal);
      const outcome = await exit;
      const duration = Date.now() - startedAt;
      this.recordResult(
        testName,
        !outcome.timedOut && outcome.code === 0 && duration < 10000,
        duration,
        { ...outcome, stderr: getStderr().slice(-1000) }
      );
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      this.recordResult(testName, false, Date.now() - startedAt, {
        error: error instanceof Error ? error.message : String(error),
        stderr: getStderr().slice(-1000),
      });
    }
  }

  async testClientDisconnection() {
    const testName = 'Client disconnection';
    console.log('📡 Test: Client disconnection (stdin close)');
    const { child, getStderr } = this.spawnServer(testName);
    const startedAt = Date.now();

    try {
      await this.initialize(child);
      const exit = this.waitForExit(child);
      child.stdin.end();
      const outcome = await exit;
      const duration = Date.now() - startedAt;
      this.recordResult(
        testName,
        !outcome.timedOut && outcome.code === 0 && duration < 10000,
        duration,
        { ...outcome, stderr: getStderr().slice(-1000) }
      );
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      this.recordResult(testName, false, Date.now() - startedAt, {
        error: error instanceof Error ? error.message : String(error),
        stderr: getStderr().slice(-1000),
      });
    }
  }

  async testInactivityTimeout() {
    const testName = 'Inactivity timeout';
    console.log('📡 Test: Inactivity timeout (shortened for testing)');
    const { child, getStderr } = this.spawnServer(testName, {
      MCP_EXEC_INACTIVITY_TIMEOUT: '1000',
    });
    const startedAt = Date.now();

    try {
      await this.initialize(child);
      const outcome = await this.waitForExit(child);
      const duration = Date.now() - startedAt;
      this.recordResult(
        testName,
        !outcome.timedOut && outcome.code === 0 && duration >= 1000 && duration < 10000,
        duration,
        { ...outcome, stderr: getStderr().slice(-1000) }
      );
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      this.recordResult(testName, false, Date.now() - startedAt, {
        error: error instanceof Error ? error.message : String(error),
        stderr: getStderr().slice(-1000),
      });
    }
  }

  async testBrokenPipe() {
    const testName = 'Broken pipe';
    console.log('📡 Test: Broken pipe handling');
    const { child, getStderr } = this.spawnServer(testName);
    const startedAt = Date.now();

    try {
      await this.initialize(child);
      const exit = this.waitForExit(child);

      // Close the reader and then force the server to write another MCP
      // response. The write observes EPIPE and exercises its stdout error path.
      child.stdout.destroy();
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextRequestId++,
        method: 'tools/list',
        params: {},
      }) + '\n');

      const outcome = await exit;
      const duration = Date.now() - startedAt;
      const stderr = getStderr();
      this.recordResult(
        testName,
        !outcome.timedOut && outcome.code === 0 && duration < 10000 &&
          /Stdout error|EPIPE|broken pipe/i.test(stderr),
        duration,
        { ...outcome, stderr: stderr.slice(-1000) }
      );
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      this.recordResult(testName, false, Date.now() - startedAt, {
        error: error instanceof Error ? error.message : String(error),
        stderr: getStderr().slice(-1000),
      });
    }
  }

  printResults() {
    console.log('📊 Test Results Summary:');
    console.log('========================');

    const passed = this.results.filter(result => result.success).length;
    const total = this.results.length;
    for (const result of this.results) {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${result.test} (${result.duration}ms)`);
    }

    console.log(`\n🎯 Overall: ${passed}/${total} tests passed`);
    if (passed === total) {
      console.log('🎉 All process lifecycle improvements are working correctly!');
    }
    return { passed, total };
  }
}

if (require.main === module) {
  const test = new LifecycleTest();
  test.runTests().catch(error => {
    console.error('❌ Test execution failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { LifecycleTest };
