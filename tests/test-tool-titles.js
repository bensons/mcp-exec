#!/usr/bin/env node

/**
 * Test that all MCP tools have proper title annotations
 */

const { spawn } = require('child_process');
const path = require('path');

// Expected titles for all tools
const expectedTitles = {
  'execute_command': 'Execute Shell Command',
  'start_interactive_session': 'Start Interactive Session',
  'start_terminal_session': 'Start Terminal Session',
  'send_to_session': 'Send Input to Session',
  'terminate_terminal_session': 'Terminate Terminal Session',
  'get_context': 'Get Execution Context',
  'get_history': 'Get Command History',
  'set_working_directory': 'Set Working Directory',
  'clear_history': 'Clear Command History',
  'get_filesystem_changes': 'Get File System Changes',
  'update_security_config': 'Update Security Settings',
  'get_security_status': 'Get Security Status',
  'confirm_command': 'Confirm Dangerous Command',
  'get_pending_confirmations': 'Get Pending Confirmations',
  'get_intent_summary': 'Get AI Intent Summary',
  'suggest_next_commands': 'Suggest Next Commands',
  'generate_audit_report': 'Generate Audit Report',
  'export_logs': 'Export Audit Logs',
  'get_alerts': 'Get Security Alerts',
  'acknowledge_alert': 'Acknowledge Alert',
  'get_audit_config': 'Get Audit Configuration',
  'update_audit_config': 'Update Audit Settings',
  'list_sessions': 'List Active Sessions',
  'kill_session': 'Kill Session',
  'read_session_output': 'Read Session Output',
  'toggle_terminal_viewer': 'Toggle Terminal Viewer',
  'get_terminal_viewer_status': 'Get Terminal Viewer Status'
};

function testToolTitles() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing MCP tool titles...');
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
        reject(new Error('Tool titles test failed'));
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
                let allToolsHaveTitles = true;
                let correctTitles = 0;
                let incorrectTitles = [];
                let missingTitles = [];
                
                // Check each expected tool
                for (const [toolName, expectedTitle] of Object.entries(expectedTitles)) {
                  const tool = tools.find(t => t.name === toolName);
                  if (tool) {
                    if (tool.title === expectedTitle) {
                      correctTitles++;
                      console.log(`✅ ${toolName}: "${tool.title}"`);
                    } else if (tool.title) {
                      incorrectTitles.push({
                        name: toolName,
                        expected: expectedTitle,
                        actual: tool.title
                      });
                      console.log(`❌ ${toolName}: expected "${expectedTitle}", got "${tool.title}"`);
                      allToolsHaveTitles = false;
                    } else {
                      missingTitles.push(toolName);
                      console.log(`❌ ${toolName}: missing title`);
                      allToolsHaveTitles = false;
                    }
                  } else {
                    console.log(`❌ ${toolName}: tool not found`);
                    allToolsHaveTitles = false;
                  }
                }
                
                // Check for unexpected tools
                const expectedToolNames = Object.keys(expectedTitles);
                const actualToolNames = tools.map(t => t.name);
                const unexpectedTools = actualToolNames.filter(name => !expectedToolNames.includes(name));
                
                console.log('\n📊 Summary:');
                console.log(`Total tools expected: ${expectedToolNames.length}`);
                console.log(`Total tools found: ${actualToolNames.length}`);
                console.log(`Tools with correct titles: ${correctTitles}`);
                
                if (missingTitles.length > 0) {
                  console.log(`Tools missing titles: ${missingTitles.join(', ')}`);
                }
                
                if (incorrectTitles.length > 0) {
                  console.log('Tools with incorrect titles:');
                  incorrectTitles.forEach(tool => {
                    console.log(`  ${tool.name}: expected "${tool.expected}", got "${tool.actual}"`);
                  });
                }
                
                if (unexpectedTools.length > 0) {
                  console.log(`Unexpected tools found: ${unexpectedTools.join(', ')}`);
                }
                
                if (allToolsHaveTitles && correctTitles === expectedToolNames.length && unexpectedTools.length === 0) {
                  console.log('✅ All tools have correct titles!');
                  testPassed = true;
                } else {
                  console.log('❌ Some tools have missing or incorrect titles');
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
        console.log('❌ Tool titles test failed');
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
  testToolTitles()
    .then(() => {
      console.log('🎉 Tool titles test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Tool titles test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testToolTitles };
