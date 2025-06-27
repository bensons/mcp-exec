#!/usr/bin/env node

/**
 * Test script to verify MCP server process lifecycle improvements
 */

const { spawn } = require('child_process');
const path = require('path');

class LifecycleTest {
  constructor() {
    this.serverPath = path.join(__dirname, 'dist', 'index.js');
    this.tests = [];
    this.results = [];
  }

  async runTests() {
    console.log('🧪 Testing MCP Server Process Lifecycle Improvements\n');

    // Test 1: Normal startup and graceful shutdown via SIGTERM
    await this.testGracefulShutdown('SIGTERM');

    // Test 2: Normal startup and graceful shutdown via SIGINT
    await this.testGracefulShutdown('SIGINT');

    // Test 3: Client disconnection simulation (stdin close)
    await this.testClientDisconnection();

    // Test 4: Inactivity timeout (if enabled)
    await this.testInactivityTimeout();

    // Test 5: Broken pipe simulation
    await this.testBrokenPipe();

    this.printResults();
  }

  async testGracefulShutdown(signal) {
    console.log(`📡 Test: Graceful shutdown with ${signal}`);
    
    return new Promise((resolve) => {
      const server = spawn('node', [this.serverPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let startTime = Date.now();

      server.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      server.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Send initialization message
      setTimeout(() => {
        const initMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'lifecycle-test', version: '1.0.0' }
          }
        }) + '\n';
        
        server.stdin.write(initMessage);
      }, 100);

      // Send signal after server is initialized
      setTimeout(() => {
        server.kill(signal);
      }, 1000);

      server.on('close', (code, signal) => {
        const duration = Date.now() - startTime;
        const success = code === 0 && duration < 10000; // Should exit gracefully within 10s
        
        console.log(`   Exit code: ${code}, Signal: ${signal}, Duration: ${duration}ms`);
        console.log(`   Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
        
        if (!success) {
          console.log(`   Stderr: ${stderr}`);
        }
        
        this.results.push({
          test: `Graceful shutdown (${signal})`,
          success,
          duration,
          details: { code, signal, stderr: stderr.slice(-200) }
        });
        
        console.log('');
        resolve();
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!server.killed) {
          server.kill('SIGKILL');
          console.log('   Result: ❌ FAIL (timeout)');
          this.results.push({
            test: `Graceful shutdown (${signal})`,
            success: false,
            duration: 15000,
            details: { error: 'timeout' }
          });
          console.log('');
          resolve();
        }
      }, 15000);
    });
  }

  async testClientDisconnection() {
    console.log('📡 Test: Client disconnection (stdin close)');
    
    return new Promise((resolve) => {
      const server = spawn('node', [this.serverPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';
      let startTime = Date.now();

      server.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Send initialization message
      setTimeout(() => {
        const initMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'lifecycle-test', version: '1.0.0' }
          }
        }) + '\n';
        
        server.stdin.write(initMessage);
      }, 100);

      // Close stdin to simulate client disconnection
      setTimeout(() => {
        server.stdin.end();
      }, 1000);

      server.on('close', (code) => {
        const duration = Date.now() - startTime;
        const success = code === 0 && duration < 10000;
        
        console.log(`   Exit code: ${code}, Duration: ${duration}ms`);
        console.log(`   Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
        
        if (!success) {
          console.log(`   Stderr: ${stderr}`);
        }
        
        this.results.push({
          test: 'Client disconnection',
          success,
          duration,
          details: { code, stderr: stderr.slice(-200) }
        });
        
        console.log('');
        resolve();
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!server.killed) {
          server.kill('SIGKILL');
          console.log('   Result: ❌ FAIL (timeout)');
          this.results.push({
            test: 'Client disconnection',
            success: false,
            duration: 15000,
            details: { error: 'timeout' }
          });
          console.log('');
          resolve();
        }
      }, 15000);
    });
  }

  async testInactivityTimeout() {
    console.log('📡 Test: Inactivity timeout (shortened for testing)');
    
    return new Promise((resolve) => {
      // Start server with shortened inactivity timeout
      const server = spawn('node', [this.serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { 
          ...process.env, 
          MCP_EXEC_INACTIVITY_TIMEOUT: '3000' // 3 seconds for testing
        }
      });

      let stderr = '';
      let startTime = Date.now();

      server.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Send initialization message but then no activity
      setTimeout(() => {
        const initMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'lifecycle-test', version: '1.0.0' }
          }
        }) + '\n';
        
        server.stdin.write(initMessage);
      }, 100);

      server.on('close', (code) => {
        const duration = Date.now() - startTime;
        // Should timeout after ~3 seconds of inactivity
        const success = code === 0 && duration >= 3000 && duration < 10000;
        
        console.log(`   Exit code: ${code}, Duration: ${duration}ms`);
        console.log(`   Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
        
        if (!success) {
          console.log(`   Stderr: ${stderr}`);
        }
        
        this.results.push({
          test: 'Inactivity timeout',
          success,
          duration,
          details: { code, stderr: stderr.slice(-200) }
        });
        
        console.log('');
        resolve();
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!server.killed) {
          server.kill('SIGKILL');
          console.log('   Result: ❌ FAIL (timeout)');
          this.results.push({
            test: 'Inactivity timeout',
            success: false,
            duration: 15000,
            details: { error: 'timeout' }
          });
          console.log('');
          resolve();
        }
      }, 15000);
    });
  }

  async testBrokenPipe() {
    console.log('📡 Test: Broken pipe handling');
    
    return new Promise((resolve) => {
      const server = spawn('node', [this.serverPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';
      let startTime = Date.now();

      server.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Send initialization message
      setTimeout(() => {
        const initMessage = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'lifecycle-test', version: '1.0.0' }
          }
        }) + '\n';
        
        server.stdin.write(initMessage);
      }, 100);

      // Destroy stdout to simulate broken pipe
      setTimeout(() => {
        server.stdout.destroy();
      }, 1000);

      server.on('close', (code) => {
        const duration = Date.now() - startTime;
        const success = duration < 10000; // Should handle broken pipe gracefully
        
        console.log(`   Exit code: ${code}, Duration: ${duration}ms`);
        console.log(`   Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
        
        this.results.push({
          test: 'Broken pipe',
          success,
          duration,
          details: { code, stderr: stderr.slice(-200) }
        });
        
        console.log('');
        resolve();
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!server.killed) {
          server.kill('SIGKILL');
          console.log('   Result: ❌ FAIL (timeout)');
          this.results.push({
            test: 'Broken pipe',
            success: false,
            duration: 15000,
            details: { error: 'timeout' }
          });
          console.log('');
          resolve();
        }
      }, 15000);
    });
  }

  printResults() {
    console.log('📊 Test Results Summary:');
    console.log('========================');
    
    const passed = this.results.filter(r => r.success).length;
    const total = this.results.length;
    
    this.results.forEach(result => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${result.test} (${result.duration}ms)`);
    });
    
    console.log(`\n🎯 Overall: ${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log('🎉 All process lifecycle improvements are working correctly!');
      process.exit(0);
    } else {
      console.log('⚠️  Some tests failed. Check the implementation.');
      process.exit(1);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const test = new LifecycleTest();
  test.runTests().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = { LifecycleTest };
