#!/usr/bin/env node

/**
 * Test to fix session ID extraction
 */

const { spawn } = require('child_process');
const path = require('path');

function testSessionIdExtraction() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    
    console.log('🔍 Testing session ID extraction...');
    
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    
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
    
    // Create terminal session
    setTimeout(() => {
      console.log('📝 Creating terminal session...');
      const startTerminalMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'start_terminal_session',
          arguments: {}
        }
      }) + '\n';
      
      server.stdin.write(startTerminalMessage);
    }, 500);
    
    setTimeout(() => {
      server.kill();
      resolve();
    }, 3000);
    
    server.stdout.on('data', (data) => {
      stdout += data.toString();
      const output = data.toString();
      
      if (output.includes('"id":2')) {
        console.log('📋 RAW RESPONSE:');
        console.log('=' * 80);
        console.log(output);
        console.log('=' * 80);
        
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{') && line.includes('"id":2')) {
              const response = JSON.parse(line);
              console.log('📋 PARSED RESPONSE:');
              console.log(JSON.stringify(response, null, 2));
              
              if (response.result && response.result.content) {
                const content = response.result.content[0].text;
                console.log('📋 CONTENT TEXT:');
                console.log(content);
                
                // Try different extraction patterns
                console.log('📋 EXTRACTION ATTEMPTS:');
                
                // Pattern 1: Session ID: `id`
                const pattern1 = content.match(/Session ID.*?`([^`]+)`/);
                console.log('Pattern 1 (Session ID: `id`):', pattern1 ? pattern1[1] : 'not found');
                
                // Pattern 2: sessionId in URL
                const pattern2 = content.match(/terminal\/([^\/]+)\/view/);
                console.log('Pattern 2 (URL sessionId):', pattern2 ? pattern2[1] : 'not found');
                
                // Pattern 3: Any UUID-like string
                const pattern3 = content.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
                console.log('Pattern 3 (UUID):', pattern3 ? pattern3[1] : 'not found');
              }
            }
          }
        } catch (e) {
          console.error('Error parsing response:', e);
        }
      }
    });
    
    server.stderr.on('data', (data) => {
      // Ignore stderr for this test
    });
    
    server.on('error', (error) => {
      console.error('❌ Error:', error);
      reject(error);
    });
  });
}

// Run the test
if (require.main === module) {
  testSessionIdExtraction()
    .then(() => {
      console.log('🎉 Session ID extraction test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Session ID extraction test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testSessionIdExtraction };
