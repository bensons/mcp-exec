#!/usr/bin/env node

/**
 * Test script to verify audit log configuration functionality
 */

const { AuditLogger } = require('./dist/audit/logger.js');
const path = require('path');
const fs = require('fs');

async function testAuditLogConfiguration() {
  console.log('🧪 Testing Audit Log Configuration...\n');

  // Test 1: Default configuration (current working directory)
  console.log('Test 1: Default configuration');
  const defaultConfig = {
    enabled: true,
    logLevel: 'info',
    retention: 30
  };
  
  const defaultLogger = new AuditLogger(defaultConfig);
  const defaultLogPath = defaultLogger.getLogFilePath();
  console.log(`✅ Default log path: ${defaultLogPath}`);
  console.log(`   Expected: ${path.join(process.cwd(), '.mcp-exec-audit.log')}`);
  console.log(`   Match: ${defaultLogPath === path.join(process.cwd(), '.mcp-exec-audit.log')}\n`);

  // Test 2: Custom log directory
  console.log('Test 2: Custom log directory');
  const customDirConfig = {
    enabled: true,
    logLevel: 'info',
    retention: 30,
    logDirectory: '/tmp/mcp-exec-test'
  };
  
  const customDirLogger = new AuditLogger(customDirConfig);
  const customDirLogPath = customDirLogger.getLogFilePath();
  console.log(`✅ Custom directory log path: ${customDirLogPath}`);
  console.log(`   Expected: ${path.join('/tmp/mcp-exec-test', '.mcp-exec-audit.log')}`);
  console.log(`   Match: ${customDirLogPath === path.join('/tmp/mcp-exec-test', '.mcp-exec-audit.log')}\n`);

  // Test 3: Custom log file path
  console.log('Test 3: Custom log file path');
  const customFileConfig = {
    enabled: true,
    logLevel: 'info',
    retention: 30,
    logFile: '/tmp/mcp-exec-test/custom-audit.log'
  };
  
  const customFileLogger = new AuditLogger(customFileConfig);
  const customFileLogPath = customFileLogger.getLogFilePath();
  console.log(`✅ Custom file log path: ${customFileLogPath}`);
  console.log(`   Expected: ${path.resolve('/tmp/mcp-exec-test/custom-audit.log')}`);
  console.log(`   Match: ${customFileLogPath === path.resolve('/tmp/mcp-exec-test/custom-audit.log')}\n`);

  // Test 4: Environment variable MCP_EXEC_LOG_DIR
  console.log('Test 4: Environment variable MCP_EXEC_LOG_DIR');
  process.env.MCP_EXEC_LOG_DIR = '/tmp/mcp-exec-env-test';
  const envDirConfig = {
    enabled: true,
    logLevel: 'info',
    retention: 30
  };
  
  const envDirLogger = new AuditLogger(envDirConfig);
  const envDirLogPath = envDirLogger.getLogFilePath();
  console.log(`✅ Environment directory log path: ${envDirLogPath}`);
  console.log(`   Expected: ${path.join('/tmp/mcp-exec-env-test', '.mcp-exec-audit.log')}`);
  console.log(`   Match: ${envDirLogPath === path.join('/tmp/mcp-exec-env-test', '.mcp-exec-audit.log')}\n`);

  // Test 5: Environment variable MCP_EXEC_AUDIT_LOG
  console.log('Test 5: Environment variable MCP_EXEC_AUDIT_LOG');
  process.env.MCP_EXEC_AUDIT_LOG = '/tmp/mcp-exec-env-test/env-audit.log';
  const envFileConfig = {
    enabled: true,
    logLevel: 'info',
    retention: 30
  };
  
  const envFileLogger = new AuditLogger(envFileConfig);
  const envFileLogPath = envFileLogger.getLogFilePath();
  console.log(`✅ Environment file log path: ${envFileLogPath}`);
  console.log(`   Expected: ${path.resolve('/tmp/mcp-exec-env-test/env-audit.log')}`);
  console.log(`   Match: ${envFileLogPath === path.resolve('/tmp/mcp-exec-env-test/env-audit.log')}\n`);

  // Test 6: Priority order (config.logFile should override environment)
  console.log('Test 6: Priority order (config overrides environment)');
  process.env.MCP_EXEC_AUDIT_LOG = '/tmp/should-be-ignored.log';
  const priorityConfig = {
    enabled: true,
    logLevel: 'info',
    retention: 30,
    logFile: '/tmp/mcp-exec-test/priority-test.log'
  };
  
  const priorityLogger = new AuditLogger(priorityConfig);
  const priorityLogPath = priorityLogger.getLogFilePath();
  console.log(`✅ Priority test log path: ${priorityLogPath}`);
  console.log(`   Expected: ${path.resolve('/tmp/mcp-exec-test/priority-test.log')}`);
  console.log(`   Match: ${priorityLogPath === path.resolve('/tmp/mcp-exec-test/priority-test.log')}`);
  console.log(`   Environment variable ignored: ${process.env.MCP_EXEC_AUDIT_LOG !== priorityLogPath}\n`);

  // Clean up environment variables
  delete process.env.MCP_EXEC_LOG_DIR;
  delete process.env.MCP_EXEC_AUDIT_LOG;

  console.log('🎉 All audit log configuration tests completed!');
}

// Run the tests
testAuditLogConfiguration().catch(console.error);
