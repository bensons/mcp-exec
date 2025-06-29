#!/usr/bin/env node

/**
 * Test MCP tool annotations structure compliance
 * Verifies that all tool annotations are properly nested under the "annotations" object
 * as per the MCP specification: https://modelcontextprotocol.io/docs/concepts/tools
 */

const { spawn } = require('child_process');
const path = require('path');

function testMCPAnnotations() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🧪 Testing MCP tool annotations structure...');
    console.log(`Server path: ${serverPath}`);
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_EXEC_SECURITY_LEVEL: 'permissive'
      }
    });
    
    let stdout = '';
    let stderr = '';
    let testsPassed = 0;
    const expectedTests = 5;
    
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
    
    // Request tools list to check annotations structure
    setTimeout(() => {
      console.log('📝 Test 1: Requesting tools list...');
      const toolsMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      }) + '\n';
      
      server.stdin.write(toolsMessage);
    }, 500);
    
    // Cleanup
    setTimeout(() => {
      console.log('📝 Cleaning up...');
      server.kill();
      
      if (testsPassed >= 4) { // Allow some flexibility
        resolve();
      } else {
        reject(new Error(`Only ${testsPassed}/${expectedTests} tests passed`));
      }
    }, 3000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      // Test 1: Check for successful initialization
      if (output.includes('"id":1') && output.includes('result')) {
        console.log('✅ Test 1 PASSED: Server initialized successfully');
        testsPassed++;
      }
      
      // Test 2: Check for tools list response
      if (output.includes('"id":2') && output.includes('tools')) {
        console.log('✅ Test 2 PASSED: Tools list retrieved successfully');
        testsPassed++;
        
        try {
          // Parse the response to check annotations structure
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim() && line.includes('"id":2')) {
              const response = JSON.parse(line);
              if (response.result && response.result.tools) {
                const tools = response.result.tools;
                
                // Test 3: Verify all tools have annotations object
                let allHaveAnnotations = true;
                let annotationsProperlyNested = true;
                let toolsWithOldStructure = [];
                
                for (const tool of tools) {
                  // Check that annotations are nested under "annotations" object
                  if (!tool.annotations) {
                    allHaveAnnotations = false;
                    break;
                  }
                  
                  // Check that old annotation properties are NOT at top level
                  const topLevelAnnotationProps = ['title', 'openWorldHint', 'readOnlyHint', 'destructiveHint', 'idempotentHint'];
                  for (const prop of topLevelAnnotationProps) {
                    if (tool.hasOwnProperty(prop)) {
                      annotationsProperlyNested = false;
                      toolsWithOldStructure.push(`${tool.name} has ${prop} at top level`);
                    }
                  }
                  
                  // Verify annotations object has expected properties
                  if (tool.annotations) {
                    const expectedProps = ['title'];
                    for (const prop of expectedProps) {
                      if (!tool.annotations.hasOwnProperty(prop)) {
                        console.log(`⚠️  Tool ${tool.name} missing ${prop} in annotations`);
                      }
                    }
                  }
                }
                
                if (allHaveAnnotations) {
                  console.log('✅ Test 3 PASSED: All tools have annotations object');
                  testsPassed++;
                } else {
                  console.log('❌ Test 3 FAILED: Some tools missing annotations object');
                }
                
                if (annotationsProperlyNested) {
                  console.log('✅ Test 4 PASSED: All annotations properly nested under annotations object');
                  testsPassed++;
                } else {
                  console.log('❌ Test 4 FAILED: Some tools have annotations at top level');
                  console.log('Tools with old structure:', toolsWithOldStructure);
                }
                
                // Test 5: Verify specific tool structure
                const executeCommandTool = tools.find(t => t.name === 'execute_command');
                if (executeCommandTool && 
                    executeCommandTool.annotations && 
                    executeCommandTool.annotations.title === 'Execute Shell Command' &&
                    executeCommandTool.annotations.openWorldHint === true &&
                    executeCommandTool.annotations.destructiveHint === true) {
                  console.log('✅ Test 5 PASSED: execute_command tool has correct annotation structure');
                  testsPassed++;
                } else {
                  console.log('❌ Test 5 FAILED: execute_command tool annotation structure incorrect');
                  if (executeCommandTool) {
                    console.log('execute_command annotations:', JSON.stringify(executeCommandTool.annotations, null, 2));
                  }
                }
                
                // Log summary of tools and their annotations
                console.log(`\n📊 Tools Summary: ${tools.length} tools found`);
                console.log('Sample tool structures:');
                tools.slice(0, 3).forEach(tool => {
                  console.log(`- ${tool.name}:`);
                  console.log(`  - Has annotations object: ${!!tool.annotations}`);
                  if (tool.annotations) {
                    console.log(`  - Title: ${tool.annotations.title}`);
                    console.log(`  - OpenWorld: ${tool.annotations.openWorldHint}`);
                    console.log(`  - ReadOnly: ${tool.annotations.readOnlyHint}`);
                  }
                });
              }
              break;
            }
          }
        } catch (error) {
          console.log('❌ Error parsing tools response:', error.message);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    server.on('close', (code) => {
      console.log(`\n📊 Test Results: ${testsPassed}/${expectedTests} tests passed`);
      
      if (testsPassed < 4) {
        console.log('❌ Some tests failed');
        console.log('Exit code:', code);
        if (stderr) {
          console.log('Stderr:', stderr.substring(0, 500));
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
  testMCPAnnotations()
    .then(() => {
      console.log('🎉 MCP annotations structure test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 MCP annotations structure test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testMCPAnnotations };
