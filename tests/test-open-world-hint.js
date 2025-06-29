#!/usr/bin/env node

/**
 * Test that openWorldHint annotation is properly set for command execution tools
 */

const { spawn } = require('child_process');
const path = require('path');

function testOpenWorldHint() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing openWorldHint annotation...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
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
    
    // Request tools list
    setTimeout(() => {
      console.log('📝 Requesting tools list...');
      const listToolsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      }) + '\n';
      
      server.stdin.write(listToolsMessage);
    }, 500);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      if (testPassed) {
        resolve();
      } else {
        reject(new Error('openWorldHint test failed'));
      }
    }, 2000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Check tools list response
      if (output.includes('"id":2') && output.includes('tools')) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":2')) {
              const response = JSON.parse(line);
              if (response.result && response.result.tools) {
                console.log('✅ Tools list response received');
                
                const tools = response.result.tools;
                const commandExecutionTools = [
                  'execute_command',
                  'start_interactive_session', 
                  'start_terminal_session',
                  'send_to_session'
                ];
                
                let allToolsHaveHint = true;
                let toolsWithHint = [];
                let toolsWithoutHint = [];
                
                for (const toolName of commandExecutionTools) {
                  const tool = tools.find(t => t.name === toolName);
                  if (tool) {
                    if (tool.openWorldHint === true) {
                      toolsWithHint.push(toolName);
                      console.log(`✅ ${toolName} has openWorldHint: true`);
                    } else {
                      toolsWithoutHint.push(toolName);
                      console.log(`❌ ${toolName} missing openWorldHint or not true`);
                      allToolsHaveHint = false;
                    }
                  } else {
                    console.log(`❌ ${toolName} not found in tools list`);
                    allToolsHaveHint = false;
                  }
                }
                
                // Check that non-command tools don't have the hint
                const nonCommandTools = [
                  'get_context',
                  'get_history', 
                  'list_sessions',
                  'get_security_status'
                ];
                
                let nonCommandToolsCorrect = true;
                for (const toolName of nonCommandTools) {
                  const tool = tools.find(t => t.name === toolName);
                  if (tool && tool.openWorldHint === true) {
                    console.log(`⚠️  ${toolName} has openWorldHint but shouldn't (it doesn't execute commands)`);
                    nonCommandToolsCorrect = false;
                  }
                }
                
                console.log('\n📊 Summary:');
                console.log(`Tools with openWorldHint: ${toolsWithHint.length}/${commandExecutionTools.length}`);
                console.log(`Tools with hint: ${toolsWithHint.join(', ')}`);
                if (toolsWithoutHint.length > 0) {
                  console.log(`Tools without hint: ${toolsWithoutHint.join(', ')}`);
                }
                
                if (allToolsHaveHint && nonCommandToolsCorrect) {
                  console.log('✅ All command execution tools have openWorldHint: true');
                  console.log('✅ Non-command tools correctly do not have openWorldHint');
                  testPassed = true;
                } else {
                  console.log('❌ Some tools are missing openWorldHint or have it incorrectly');
                }
              }
            }
          }
        } catch (e) {
          console.error('Error parsing tools list response:', e);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('close', (code) => {
      if (!testPassed) {
        console.log('❌ openWorldHint test failed');
        console.log('Exit code:', code);
        if (stderr) {
          console.log('Stderr:', stderr);
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
  testOpenWorldHint()
    .then(() => {
      console.log('🎉 openWorldHint test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 openWorldHint test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testOpenWorldHint };
