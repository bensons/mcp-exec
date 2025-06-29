#!/usr/bin/env node

/**
 * Test the terminal prompt suggestion
 */

const { spawn } = require('child_process');
const path = require('path');

function testPromptSuggestion() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing terminal prompt suggestion...');
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
    
    // Test 1: List prompts
    setTimeout(() => {
      console.log('📝 Testing prompts/list...');
      const listPromptsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'prompts/list',
        params: {}
      }) + '\n';
      
      server.stdin.write(listPromptsMessage);
    }, 500);
    
    // Test 2: Get terminal prompt
    setTimeout(() => {
      console.log('📝 Testing prompts/get for terminal...');
      const getPromptMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'prompts/get',
        params: {
          name: 'terminal',
          arguments: {
            command: 'bash',
            cwd: '/tmp'
          }
        }
      }) + '\n';
      
      server.stdin.write(getPromptMessage);
    }, 1000);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      if (testPassed) {
        resolve();
      } else {
        reject(new Error('Prompt suggestion test failed'));
      }
    }, 2000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Check prompts/list response
      if (output.includes('"id":2') && output.includes('prompts')) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":2')) {
              const response = JSON.parse(line);
              if (response.result && response.result.prompts) {
                console.log('✅ prompts/list response received');
                const terminalPrompt = response.result.prompts.find(p => p.name === 'terminal');
                if (terminalPrompt) {
                  console.log('✅ Terminal prompt found in list');
                  console.log(`   Description: ${terminalPrompt.description}`);
                } else {
                  console.log('❌ Terminal prompt not found in list');
                }
              }
            }
          }
        } catch (e) {
          console.error('Error parsing prompts/list response:', e);
        }
      }
      
      // Check prompts/get response
      if (output.includes('"id":3') && output.includes('terminal')) {
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":3')) {
              const response = JSON.parse(line);
              if (response.result && response.result.messages) {
                console.log('✅ prompts/get response received');
                const message = response.result.messages[0];
                if (message && message.content && message.content.text) {
                  console.log('✅ Terminal prompt content generated');
                  const content = message.content.text;
                  
                  // Check if the content includes the arguments
                  if (content.includes('bash') && content.includes('/tmp')) {
                    console.log('✅ Prompt includes provided arguments');
                    testPassed = true;
                  } else {
                    console.log('❌ Prompt does not include provided arguments');
                  }
                  
                  // Show a snippet of the content
                  console.log('📋 Prompt content preview:');
                  console.log(content.substring(0, 200) + '...');
                } else {
                  console.log('❌ No content in prompt response');
                }
              }
            }
          }
        } catch (e) {
          console.error('Error parsing prompts/get response:', e);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('close', (code) => {
      if (!testPassed) {
        console.log('❌ Prompt suggestion test failed');
        console.log('Exit code:', code);
        console.log('Stdout:', stdout);
        console.log('Stderr:', stderr);
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
  testPromptSuggestion()
    .then(() => {
      console.log('🎉 Prompt suggestion test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Prompt suggestion test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testPromptSuggestion };
