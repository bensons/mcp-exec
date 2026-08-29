#!/usr/bin/env node

/**
 * Test that environment variables are properly supported for all configuration options
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { ShellExecutor } = require('../dist/core/executor');

const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');

/**
 * Start an mcp-exec server in a throwaway directory and return a JSON-RPC client.
 * Everything the server writes (audit log, session file) is confined to that
 * directory so concurrent test runs never collide.
 */
function startServer(extraEnv = {}, options = {}) {
  const tmpDir = options.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-test-'));
  const server = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: tmpDir,
    env: {
      ...process.env,
      MCP_EXEC_LOG_DIR: tmpDir,
      MCP_EXEC_SESSION_PERSISTENCE: 'false',
      MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'false',
      ...extraEnv,
    },
  });

  const pending = new Map();
  let buffer = '';
  server.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('{')) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (e) {
        continue;
      }
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  });

  let nextId = 0;
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Timed out waiting for ${method}`));
    }, 20000);
  });

  return {
    tmpDir,
    send,
    initialize: () => send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    }),
    call: async (name, args) => {
      const response = await send('tools/call', { name, arguments: args });
      if (response.error) throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
      return response.result.content[0].text;
    },
    stop: (cleanup = true) => new Promise((resolve) => {
      const finish = () => {
        if (cleanup) fs.rmSync(tmpDir, { recursive: true, force: true });
        resolve();
      };
      if (server.exitCode !== null || server.signalCode !== null) {
        finish();
        return;
      }
      server.once('close', finish);
      server.kill();
    }),
  };
}

/**
 * Regression tests for issue #38: per-command `env` overrides must not become
 * permanent, `export` must only be parsed when it is actually executed, and `cd`
 * must be tracked when it is part of a larger command line.
 */
async function testContextTracking() {
  console.log('🧪 Testing context env/cwd tracking (issue #38)...');
  const client = startServer({
    MCP_EXEC_SECURITY_LEVEL: 'permissive',
    MCP_TEST_INHERITED: 'inherited-value',
    MCP_TEST_OVERRIDE_BASE: 'base-value',
  });
  const initialDirectory = fs.realpathSync(client.tmpDir);
  const trackedHomePath = path.join(client.tmpDir, 'tracked-home');
  fs.mkdirSync(trackedHomePath);
  const trackedHome = fs.realpathSync(trackedHomePath);
  const failures = [];
  const check = (name, condition, detail) => {
    if (condition) {
      console.log(`✅ ${name}`);
    } else {
      console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
      failures.push(name);
    }
  };

  try {
    await client.initialize();

    // 1. A one-off `env` override applies to its own command only.
    const withOverride = await client.call('execute_command', {
      command: "env | grep '^MCP_TEST_CI='",
      env: { MCP_TEST_CI: '1' },
    });
    check('override reaches the command it was passed to', withOverride.includes('MCP_TEST_CI=1'));

    const withoutOverride = await client.call('execute_command', {
      command: "env | grep '^MCP_TEST_CI='",
    });
    check(
      'override does not leak into the next command',
      !withoutOverride.includes('MCP_TEST_CI=1'),
      'MCP_TEST_CI was still set'
    );

    await client.call('execute_command', {
      command: "printf '%s' \"$MCP_TEST_OVERRIDE_BASE\"",
      env: { MCP_TEST_OVERRIDE_BASE: 'temporary-value' },
    });
    const restoredOverride = await client.call('execute_command', {
      command: "printf 'OVERRIDE=%s' \"$MCP_TEST_OVERRIDE_BASE\"",
    });
    check(
      'override restores a pre-existing tracked value',
      restoredOverride.includes('OVERRIDE=base-value'),
      restoredOverride
    );

    // 2. An `export` that is only printed must not mutate the context.
    await client.call('execute_command', { command: "echo 'export MCP_TEST_FOO=bar'" });

    // 3. Persist values after the shell has expanded them, not their source text.
    await client.call('execute_command', {
      command: 'export MCP_TEST_EXPANDED="$PATH:/opt/mcp-test" MCP_TEST_ROOT="$(pwd)"',
    });
    const expanded = await client.call('execute_command', {
      command: "printf 'EXPANDED=%s\\nROOT=%s' \"$MCP_TEST_EXPANDED\" \"$MCP_TEST_ROOT\"",
    });
    check(
      'exported shell expressions persist their evaluated values',
      expanded.includes(':/opt/mcp-test') &&
        !expanded.includes('$PATH') &&
        expanded.includes(`ROOT=${initialDirectory}`),
      expanded
    );

    // 4. Unsets must remove variables inherited from the server process.
    await client.call('execute_command', { command: 'unset MCP_TEST_INHERITED' });

    // 5. POSIX `set`, bare assignments, and pipeline subshells do not export state.
    await client.call('execute_command', { command: 'set MCP_TEST_POSIX_SET=bad' });
    await client.call('execute_command', { command: 'MCP_TEST_BARE=bad' });
    await client.call('execute_command', { command: 'export MCP_TEST_PIPELINE=bad | cat' });

    // 6. Only the branch actually selected by the shell contributes state.
    await client.call('execute_command', { command: 'true || export MCP_TEST_SKIPPED=bad' });
    await client.call('execute_command', { command: 'false || export MCP_TEST_SELECTED=good' });
    const variables = await client.call('execute_command', {
      command: "printf 'inherited=%s set=%s bare=%s pipeline=%s skipped=%s selected=%s' " +
        '"${MCP_TEST_INHERITED-absent}" "${MCP_TEST_POSIX_SET-absent}" ' +
        '"${MCP_TEST_BARE-absent}" "${MCP_TEST_PIPELINE-absent}" ' +
        '"${MCP_TEST_SKIPPED-absent}" "${MCP_TEST_SELECTED-absent}"',
    });
    check(
      'shell export semantics are preserved across commands',
      variables.includes('inherited=absent') &&
        variables.includes('set=absent') &&
        variables.includes('bare=absent') &&
        variables.includes('pipeline=absent') &&
        variables.includes('skipped=absent') &&
        variables.includes('selected=good'),
      variables
    );

    await client.call('execute_command', {
      command: 'export MCP_TEST_BASH=from-bash',
      shell: '/bin/bash',
    });
    await client.call('execute_command', {
      command: 'export MCP_TEST_MANUAL_SH=from-manual-sh',
      shell: false,
    });
    const crossShell = await client.call('execute_command', {
      command: "printf 'bash=%s manual=%s' \"$MCP_TEST_BASH\" \"$MCP_TEST_MANUAL_SH\"",
    });
    check(
      'state capture works with explicit Bash and manual /bin/sh execution',
      crossShell.includes('bash=from-bash manual=from-manual-sh'),
      crossShell
    );

    // 7. HOME, conditionals, pipelines, cd -, and per-command cwd use actual shell state.
    await client.call('execute_command', {
      command: `export HOME='${trackedHome}' && cd ~`,
    });
    const homePwd = await client.call('execute_command', { command: "printf 'PWD=%s' \"$PWD\"" });
    check('cd ~ uses the tracked HOME', homePwd.includes(`PWD=${trackedHome}`), homePwd);

    await client.call('execute_command', { command: 'cd /tmp | cat' });
    await client.call('execute_command', { command: 'false && cd /tmp' });
    const afterIgnoredCd = await client.call('execute_command', { command: "printf 'PWD=%s' \"$PWD\"" });
    check(
      'pipeline and skipped conditional cd do not change the tracked cwd',
      afterIgnoredCd.includes(`PWD=${trackedHome}`),
      afterIgnoredCd
    );

    await client.call('execute_command', { command: 'cd /tmp && true' });
    const cdDash = await client.call('execute_command', { command: 'cd - >/dev/null' });
    const afterCdDash = await client.call('execute_command', { command: "printf 'PWD=%s' \"$PWD\"" });
    check(
      'cd - navigation persists across executions',
      afterCdDash.includes(`PWD=${trackedHome}`),
      `${cdDash}\n${afterCdDash}`
    );

    await client.call('execute_command', { command: 'pwd', cwd: '/tmp' });
    const afterScopedCwd = await client.call('execute_command', { command: "printf 'PWD=%s' \"$PWD\"" });
    check('per-command cwd remains scoped', afterScopedCwd.includes(`PWD=${trackedHome}`), afterScopedCwd);

    // 8. A failed compound command is not applied.
    await client.call('execute_command', { command: 'export MCP_TEST_FAIL=1 && false' });

    const context = await client.call('get_context', {});
    check(
      "echo 'export FOO=bar' leaves FOO unset",
      !context.includes('MCP_TEST_FOO'),
      'MCP_TEST_FOO appeared in the context'
    );
    check(
      'one-off override is absent from the context',
      !context.includes('MCP_TEST_CI'),
      'MCP_TEST_CI appeared in the context'
    );
    check(
      'export from a failed command is not applied',
      !context.includes('MCP_TEST_FAIL'),
      'MCP_TEST_FAIL appeared in the context'
    );
    check('tracked working directory remains at HOME', context.includes(`**Working Directory:** \`${trackedHome}\``));
  } finally {
    await client.stop();
  }

  if (failures.length > 0) {
    throw new Error(`Context tracking checks failed: ${failures.join(', ')}`);
  }
  console.log('✅ Context env/cwd tracking behaves correctly');
}

function testWindowsStateProtocol() {
  const executor = Object.create(ShellExecutor.prototype);
  const marker = '__MCP_EXEC_STATE_TEST';
  const stderr = `user error\r\n${marker}\r\nC:\\work\r\nFOO=bar\r\n` +
    `Path=C:\\bin\r\n__mcp_exec_status=0\r\n${marker}_END\r\n`;
  const state = executor.extractWindowsShellState(stderr, marker);
  if (
    state.stderr !== 'user error\r\n' ||
    state.workingDirectory !== 'C:\\work' ||
    state.environment.FOO !== 'bar' ||
    state.environment.Path !== 'C:\\bin' ||
    '__mcp_exec_status' in state.environment
  ) {
    throw new Error(`Windows shell-state protocol failed: ${JSON.stringify(state)}`);
  }
  console.log('✅ Windows cmd.exe shell-state protocol parses cwd and environment');
}

async function testNavigationPersistence() {
  console.log('🧪 Testing persisted directory navigation state...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-persistence-test-'));
  const initialDirectory = fs.realpathSync(tmpDir);
  const environment = {
    MCP_EXEC_SECURITY_LEVEL: 'permissive',
    MCP_EXEC_SESSION_PERSISTENCE: 'true',
  };

  const first = startServer(environment, { tmpDir });
  try {
    await first.initialize();
    await first.call('execute_command', { command: 'cd /tmp' });
  } finally {
    await first.stop(false);
  }

  const sessionFile = path.join(tmpDir, '.mcp-exec-session.json');
  const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  saved.previousDirectory = initialDirectory;
  saved.directoryStack = [initialDirectory];
  fs.writeFileSync(sessionFile, JSON.stringify(saved, null, 2));

  const second = startServer(environment, { tmpDir });
  try {
    await second.initialize();
    await second.call('execute_command', { command: 'echo persistence-check' });
  } finally {
    await second.stop(false);
  }

  const reSaved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const failures = [];
  if (reSaved.previousDirectory !== initialDirectory) failures.push('previousDirectory');
  if (JSON.stringify(reSaved.directoryStack) !== JSON.stringify([initialDirectory])) {
    failures.push('directoryStack');
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (failures.length > 0) {
    throw new Error(`Navigation persistence checks failed: ${failures.join(', ')}`);
  }
  console.log('✅ Previous directory and directory stack survive load/save');
}

function testEnvironmentVariables() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing environment variable support...');
    console.log(`Server path: ${serverPath}`);
    
    // Set test environment variables
    const testEnv = {
      ...process.env,
      // Security settings
      MCP_EXEC_SECURITY_LEVEL: 'strict',
      MCP_EXEC_CONFIRM_DANGEROUS: 'true',
      MCP_EXEC_TIMEOUT: '600000',
      MCP_EXEC_MAX_MEMORY: '2048',
      MCP_EXEC_MAX_FILE_SIZE: '200',
      MCP_EXEC_MAX_PROCESSES: '20',
      MCP_EXEC_SANDBOXING_ENABLED: 'true',
      MCP_EXEC_NETWORK_ACCESS: 'false',
      MCP_EXEC_FILESYSTEM_ACCESS: 'restricted',
      
      // Context settings
      MCP_EXEC_PRESERVE_WORKING_DIR: 'false',
      MCP_EXEC_SESSION_PERSISTENCE: 'false',
      MCP_EXEC_MAX_HISTORY_SIZE: '2000',
      
      // Session settings
      MCP_EXEC_MAX_SESSIONS: '20',
      MCP_EXEC_SESSION_TIMEOUT: '3600000',
      MCP_EXEC_SESSION_BUFFER_SIZE: '2000',
      
      // Lifecycle settings
      MCP_EXEC_INACTIVITY_TIMEOUT: '600000',
      MCP_EXEC_SHUTDOWN_TIMEOUT: '10000',
      MCP_EXEC_ENABLE_HEARTBEAT: 'false',
      
      // Output settings
      MCP_EXEC_FORMAT_STRUCTURED: 'false',
      MCP_EXEC_STRIP_ANSI: 'false',
      MCP_EXEC_SUMMARIZE_VERBOSE: 'false',
      MCP_EXEC_ENABLE_AI_OPTIMIZATIONS: 'false',
      MCP_EXEC_MAX_OUTPUT_LENGTH: '20000',
      
      // Display settings
      MCP_EXEC_SHOW_COMMAND_HEADER: 'false',
      MCP_EXEC_SHOW_EXECUTION_TIME: 'false',
      MCP_EXEC_SHOW_EXIT_CODE: 'false',
      MCP_EXEC_FORMAT_CODE_BLOCKS: 'false',
      MCP_EXEC_INCLUDE_METADATA: 'false',
      MCP_EXEC_INCLUDE_SUGGESTIONS: 'false',
      MCP_EXEC_USE_MARKDOWN: 'false',
      MCP_EXEC_COLORIZE_OUTPUT: 'true',
      
      // Audit settings
      MCP_EXEC_AUDIT_ENABLED: 'false',
      MCP_EXEC_AUDIT_LOG_LEVEL: 'error',
      MCP_EXEC_AUDIT_RETENTION: '60',
      MCP_EXEC_MONITORING_ENABLED: 'false',
      MCP_EXEC_ALERT_RETENTION: '14',
      MCP_EXEC_MAX_ALERTS_PER_HOUR: '200',
      
      // Keep the server's writes out of the repo and the user's home directory
      MCP_EXEC_LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-test-')),

      // Terminal viewer settings (left disabled: starting it would bind a fixed port)
      MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'false',
      MCP_EXEC_TERMINAL_VIEWER_PORT: '4000',
      MCP_EXEC_TERMINAL_VIEWER_HOST: '0.0.0.0',
      MCP_EXEC_TERMINAL_VIEWER_MAX_SESSIONS: '20',
      MCP_EXEC_TERMINAL_VIEWER_SESSION_TIMEOUT: '3600000',
      MCP_EXEC_TERMINAL_VIEWER_BUFFER_SIZE: '2000',
      MCP_EXEC_TERMINAL_VIEWER_ENABLE_AUTH: 'true',
      MCP_EXEC_TERMINAL_VIEWER_AUTH_TOKEN: 'test-token-123'
    };
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: testEnv
    });
    
    let stdout = '';
    let stderr = '';
    let testPassed = false;
    
    // Send MCP initialization message
    const initMessage = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: false
          }
        },
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    }) + '\n';
    
    server.stdin.write(initMessage);
    
    // Test get_security_status to verify environment variables are applied
    setTimeout(() => {
      console.log('📝 Testing security status with environment variables...');
      const getSecurityMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_security_status',
          arguments: {}
        }
      }) + '\n';
      
      server.stdin.write(getSecurityMessage);
    }, 500);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      if (testPassed) {
        resolve();
      } else {
        reject(new Error('Environment variables test failed'));
      }
    }, 3000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Check security status response
      if (output.includes('"id":2')) {
        try {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":2')) {
              const response = JSON.parse(line);
              if (response.result && response.result.content) {
                console.log('✅ Security status response received');
                const content = response.result.content[0].text;
                
                // Parse the security status
                let securityConfig;
                try {
                  securityConfig = JSON.parse(content);
                } catch (e) {
                  // If it's not JSON, it might be formatted text
                  console.log('📋 Security status content (formatted):');
                  console.log(content.substring(0, 500) + '...');
                  
                  // Check for key environment variable values in the text
                  // (the status report is human-formatted, so match case-insensitively)
                  const lower = content.toLowerCase();
                  const checks = [
                    { name: 'Security Level', env: 'strict', found: lower.includes('strict') },
                    { name: 'Confirm Dangerous', env: 'true', found: lower.includes('confirmation:** ✅ enabled') },
                    { name: 'Timeout', env: '600000', found: lower.includes('600000') || lower.includes('600s') || lower.includes('10 minutes') },
                    { name: 'Sandboxing', env: 'enabled', found: lower.includes('sandboxing') }
                  ];
                  
                  let passedChecks = 0;
                  checks.forEach(check => {
                    if (check.found) {
                      console.log(`✅ ${check.name}: Found expected value`);
                      passedChecks++;
                    } else {
                      console.log(`❌ ${check.name}: Expected value not found`);
                    }
                  });
                  
                  if (passedChecks >= 2) { // At least half the checks should pass
                    console.log('✅ Environment variables appear to be working');
                    testPassed = true;
                  } else {
                    console.log('❌ Environment variables may not be working correctly');
                  }
                  return;
                }
                
                // If we got JSON, check specific values
                if (securityConfig) {
                  console.log('📋 Parsed security config:');
                  console.log(JSON.stringify(securityConfig, null, 2));
                  
                  const checks = [
                    { name: 'Security Level', expected: 'strict', actual: securityConfig.level },
                    { name: 'Confirm Dangerous', expected: true, actual: securityConfig.confirmDangerous },
                    { name: 'Timeout', expected: 600000, actual: securityConfig.timeout }
                  ];
                  
                  let passedChecks = 0;
                  checks.forEach(check => {
                    if (check.actual === check.expected) {
                      console.log(`✅ ${check.name}: ${check.actual} (correct)`);
                      passedChecks++;
                    } else {
                      console.log(`❌ ${check.name}: expected ${check.expected}, got ${check.actual}`);
                    }
                  });
                  
                  if (passedChecks === checks.length) {
                    console.log('✅ All environment variables working correctly');
                    testPassed = true;
                  } else {
                    console.log(`❌ ${passedChecks}/${checks.length} environment variables working`);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error('Error parsing security status response:', e);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('close', (code) => {
      if (!testPassed) {
        console.log('❌ Environment variables test failed');
        console.log('Exit code:', code);
        if (stderr) {
          console.log('Stderr:', stderr.substring(0, 1000));
        }
      }
    });
    
    server.on('error', (error) => {
      console.log('❌ Error starting server:', error);
      reject(error);
    });
  });
}

// Run the test
if (require.main === module) {
  testEnvironmentVariables()
    .then(testWindowsStateProtocol)
    .then(testContextTracking)
    .then(testNavigationPersistence)
    .then(() => {
      console.log('🎉 Environment variables test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Environment variables test failed:', error.message);
      process.exit(1);
    });
}

module.exports = {
  testEnvironmentVariables,
  testContextTracking,
  testNavigationPersistence,
  testWindowsStateProtocol,
  startServer,
};
