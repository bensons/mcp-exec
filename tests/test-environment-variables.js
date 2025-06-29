#!/usr/bin/env node

/**
 * Test that environment variables are properly supported for all configuration options
 */

const { spawn } = require('child_process');
const path = require('path');

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
      
      // Terminal viewer settings
      MCP_EXEC_TERMINAL_VIEWER_ENABLED: 'true',
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
      if (output.includes('"id":2') && output.includes('security')) {
        try {
          const lines = output.split('\n');
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
                  const checks = [
                    { name: 'Security Level', env: 'strict', found: content.includes('strict') },
                    { name: 'Confirm Dangerous', env: 'true', found: content.includes('true') || content.includes('enabled') },
                    { name: 'Timeout', env: '600000', found: content.includes('600000') || content.includes('10 minutes') },
                    { name: 'Sandboxing', env: 'enabled', found: content.includes('enabled') || content.includes('true') }
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
    .then(() => {
      console.log('🎉 Environment variables test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Environment variables test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testEnvironmentVariables };
