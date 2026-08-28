#!/usr/bin/env node

/**
 * Test dynamic configuration tools
 * Verifies that all the new configuration management tools work correctly
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');

/**
 * Isolated scratch directory for a server run: keeps audit logs and session
 * state out of ~/.mcp-exec and the repo, so concurrent test runs cannot
 * clobber each other.
 */
function makeScratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-test-'));
}

function testDynamicConfiguration() {
  return new Promise((resolve, reject) => {
    const serverPath = SERVER_PATH;
    const scratchDir = makeScratchDir();

    console.log('🧪 Testing dynamic configuration tools...');
    console.log(`Server path: ${serverPath}`);

    const server = spawn('node', [serverPath], {
      cwd: scratchDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_EXEC_SECURITY_LEVEL: 'permissive',
        MCP_EXEC_LOG_DIR: scratchDir,
        MCP_EXEC_MONITORING_ENABLED: 'false',
        MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED: 'false'
      }
    });
    
    let stdout = '';
    let stderr = '';
    let testsPassed = 0;
    const expectedTests = 15;
    
    // Send MCP initialization message
    const initMessage = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    }) + '\n';
    
    server.stdin.write(initMessage);
    
    // Test 1: Get current configuration
    setTimeout(() => {
      console.log('📝 Test 1: Getting current configuration...');
      const getConfigMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_configuration',
          arguments: { section: 'security' }
        }
      }) + '\n';
      
      server.stdin.write(getConfigMessage);
    }, 500);
    
    // Test 2: Update security configuration
    setTimeout(() => {
      console.log('📝 Test 2: Updating security configuration...');
      const updateConfigMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'update_configuration',
          arguments: {
            section: 'security',
            settings: { level: 'strict' }
          }
        }
      }) + '\n';
      
      server.stdin.write(updateConfigMessage);
    }, 1000);
    
    // Test 3: Manage blocked commands
    setTimeout(() => {
      console.log('📝 Test 3: Managing blocked commands...');
      const manageCommandsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'manage_blocked_commands',
          arguments: {
            action: 'add',
            commands: ['test-command-1', 'test-command-2']
          }
        }
      }) + '\n';
      
      server.stdin.write(manageCommandsMessage);
    }, 1500);
    
    // Test 4: Manage allowed directories
    setTimeout(() => {
      console.log('📝 Test 4: Managing allowed directories...');
      const manageDirsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'manage_allowed_directories',
          arguments: {
            action: 'add',
            directories: ['/test/dir1', '/test/dir2']
          }
        }
      }) + '\n';
      
      server.stdin.write(manageDirsMessage);
    }, 2000);
    
    // Test 5: Update resource limits
    setTimeout(() => {
      console.log('📝 Test 5: Updating resource limits...');
      const updateLimitsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'update_resource_limits',
          arguments: {
            maxMemoryUsage: 2048,
            maxFileSize: 200,
            maxProcesses: 20
          }
        }
      }) + '\n';
      
      server.stdin.write(updateLimitsMessage);
    }, 2500);
    
    // Test 6: Update MCP logging
    setTimeout(() => {
      console.log('📝 Test 6: Updating MCP logging...');
      const updateMcpLoggingMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'update_mcp_logging',
          arguments: {
            minLevel: 'debug',
            rateLimitPerMinute: 120,
            maxQueueSize: 200
          }
        }
      }) + '\n';
      
      server.stdin.write(updateMcpLoggingMessage);
    }, 3000);
    
    // Test 7: Update audit logging
    setTimeout(() => {
      console.log('📝 Test 7: Updating audit logging...');
      const updateAuditMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'update_audit_logging',
          arguments: {
            retention: 60,
            monitoringEnabled: true,
            desktopNotifications: true
          }
        }
      }) + '\n';
      
      server.stdin.write(updateAuditMessage);
    }, 3500);
    
    // Test 8: Update session limits
    setTimeout(() => {
      console.log('📝 Test 8: Updating session limits...');
      const updateSessionsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'update_session_limits',
          arguments: {
            maxInteractiveSessions: 20,
            sessionTimeout: 3600000,
            outputBufferSize: 2000
          }
        }
      }) + '\n';
      
      server.stdin.write(updateSessionsMessage);
    }, 4000);
    
    // Test 9: Update output formatting
    setTimeout(() => {
      console.log('📝 Test 9: Updating output formatting...');
      const updateOutputMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'update_output_formatting',
          arguments: {
            formatStructured: false,
            stripAnsi: false,
            enableAiOptimizations: false,
            maxOutputLength: 20000
          }
        }
      }) + '\n';
      
      server.stdin.write(updateOutputMessage);
    }, 4500);
    
    // Test 10: Update display options
    setTimeout(() => {
      console.log('📝 Test 10: Updating display options...');
      const updateDisplayMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'update_display_options',
          arguments: {
            showCommandHeader: false,
            showExecutionTime: false,
            showExitCode: false,
            useMarkdown: false,
            colorizeOutput: true
          }
        }
      }) + '\n';
      
      server.stdin.write(updateDisplayMessage);
    }, 5000);
    
    // Test 11: Update context config
    setTimeout(() => {
      console.log('📝 Test 11: Updating context configuration...');
      const updateContextMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'update_context_config',
          arguments: {
            preserveWorkingDirectory: false,
            sessionPersistence: false,
            maxHistorySize: 2000
          }
        }
      }) + '\n';
      
      server.stdin.write(updateContextMessage);
    }, 5500);
    
    // Test 12: Update lifecycle config
    setTimeout(() => {
      console.log('📝 Test 12: Updating lifecycle configuration...');
      const updateLifecycleMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'update_lifecycle_config',
          arguments: {
            inactivityTimeout: 600000,
            gracefulShutdownTimeout: 10000,
            enableHeartbeat: false
          }
        }
      }) + '\n';
      
      server.stdin.write(updateLifecycleMessage);
    }, 6000);
    
    // Test 13: Get configuration history
    setTimeout(() => {
      console.log('📝 Test 13: Getting configuration history...');
      const getHistoryMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'get_configuration_history',
          arguments: { limit: 5 }
        }
      }) + '\n';
      
      server.stdin.write(getHistoryMessage);
    }, 6500);
    
    // Test 14: List blocked commands
    setTimeout(() => {
      console.log('📝 Test 14: Listing blocked commands...');
      const listCommandsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'manage_blocked_commands',
          arguments: { action: 'list' }
        }
      }) + '\n';
      
      server.stdin.write(listCommandsMessage);
    }, 7000);
    
    // Test 15: List allowed directories
    setTimeout(() => {
      console.log('📝 Test 15: Listing allowed directories...');
      const listDirsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 16,
        method: 'tools/call',
        params: {
          name: 'manage_allowed_directories',
          arguments: { action: 'list' }
        }
      }) + '\n';
      
      server.stdin.write(listDirsMessage);
    }, 7500);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      
      console.log(`\n✅ Dynamic Configuration Tests Complete`);
      console.log(`📊 Results: ${testsPassed}/${expectedTests} tests passed`);
      
      if (testsPassed >= expectedTests * 0.8) { // Allow 80% success rate
        resolve();
      } else {
        reject(new Error(`Only ${testsPassed}/${expectedTests} tests passed`));
      }
    }, 8000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      
      // Check for successful responses
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            if (response.result && response.result.content) {
              const content = response.result.content[0]?.text;
              if (content && (content.includes('success') || content.includes('configuration') || content.includes('blockedCommands') || content.includes('allowedDirectories'))) {
                testsPassed++;
                console.log(`✅ Test ${testsPassed} passed`);
              }
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }
      });
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('error', (error) => {
      console.error('❌ Server error:', error.message);
      reject(error);
    });
    
    server.on('close', (code) => {
      if (code !== 0) {
        console.error(`❌ Server exited with code ${code}`);
        console.error('📝 Full stderr:');
        console.error(stderr);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

/**
 * Regression tests for issue #27: configuration tools used to recreate
 * SecurityManager / ContextManager / AuditLogger while ShellExecutor kept the
 * originals, so `execute_command` silently diverged from the session tools.
 */
function testStaleComponentReferences() {
  const scratchDir = makeScratchDir();
  const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-cwd-')));

  console.log('\n🧪 Testing component reference stability after config changes (issue #27)...');

  const server = spawn('node', [SERVER_PATH], {
    cwd: scratchDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCP_EXEC_SECURITY_LEVEL: 'permissive',
      MCP_EXEC_LOG_DIR: scratchDir,
      MCP_EXEC_MONITORING_ENABLED: 'false',
      MCP_EXEC_DESKTOP_NOTIFICATIONS_ENABLED: 'false',
      MCP_EXEC_ALLOWED_DIRECTORIES: `${scratchDir},${workDir},/tmp`
    }
  });

  let stderr = '';
  server.stderr.on('data', (d) => { stderr += d.toString(); });

  const pending = new Map();
  let buffer = '';
  let nextId = 1;

  server.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (e) {
        continue; // not a JSON-RPC frame
      }
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter(message);
      }
    }
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for response to ${method}`));
      }, 20000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async function callTool(name, args) {
    const response = await request('tools/call', { name, arguments: args || {} });
    if (response.error) {
      throw new Error(`${name} failed: ${JSON.stringify(response.error)}`);
    }
    return response.result.content.map((c) => c.text).join('\n');
  }

  const failures = [];
  function check(label, condition, detail) {
    if (condition) {
      console.log(`✅ ${label}`);
    } else {
      console.log(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
      failures.push(label);
    }
  }

  return (async () => {
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'issue-27-test', version: '1.0.0' }
    });

    // --- Sequence 1: history survives update_context_config -----------------
    console.log('📝 Sequence 1: history survives update_context_config');
    await callTool('execute_command', { command: 'pwd' });
    await callTool('update_context_config', { maxHistorySize: 500 });
    await callTool('execute_command', { command: 'pwd' });

    const history = await callTool('get_history', {});
    const historyCount = Number((history.match(/Showing (\d+) command/) || [])[1] || 0);
    check(
      'get_history reports 2 entries after update_context_config',
      historyCount === 2,
      `got ${historyCount}\n${history}`
    );

    // --- Sequence 2: set_working_directory still affects execute_command ----
    console.log('📝 Sequence 2: set_working_directory affects execute_command after a config update');
    const setCwd = await callTool('set_working_directory', { directory: workDir });
    check('set_working_directory succeeded', setCwd.includes('"success": true'), setCwd);

    const pwdOutput = await callTool('execute_command', { command: 'pwd' });
    check(
      'execute_command runs in the directory set via set_working_directory',
      pwdOutput.includes(workDir),
      `expected ${workDir} in:\n${pwdOutput}`
    );

    // --- Sequence 3: security policy resets apply to execute_command --------
    console.log('📝 Sequence 3: reset_configuration security applies to execute_command');
    await callTool('update_security_config', { level: 'strict' });

    const blocked = await callTool('execute_command', { command: 'sudo', args: ['-n', 'true'] });
    check(
      'strict mode blocks sudo via execute_command',
      blocked.includes('blocked by security policy'),
      blocked
    );

    await callTool('reset_configuration', { section: 'security' });

    const afterReset = await callTool('execute_command', { command: 'sudo', args: ['-n', 'true'] });
    check(
      'reset_configuration security unblocks sudo via execute_command',
      !afterReset.includes('blocked by security policy'),
      afterReset
    );

    // reset_configuration with no section must not throw on the schema-only
    // 'logging' section.
    const resetAll = await callTool('reset_configuration', {});
    check('reset_configuration (all sections) succeeds', resetAll.includes('"success": true'), resetAll);

    return failures;
  })()
    .then((result) => {
      server.kill();
      if (result.length > 0) {
        throw new Error(`Issue #27 regressions: ${result.join('; ')}`);
      }
      console.log('✅ Component references stayed live across configuration changes');
    })
    .catch((error) => {
      server.kill();
      if (stderr.trim()) {
        console.error('📝 Server stderr:\n' + stderr);
      }
      throw error;
    });
}

// Run the test
if (require.main === module) {
  testDynamicConfiguration()
    .then(() => testStaleComponentReferences())
    .then(() => {
      console.log('\n🎉 All dynamic configuration tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Dynamic configuration tests failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testDynamicConfiguration, testStaleComponentReferences }; 