#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🔧 MCP-Exec Build and Functionality Test\n');

let exitCode = 0;

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶️  Running: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`❌ Command failed with exit code ${code}`);
        reject(new Error(`Command failed: ${command} ${args.join(' ')}`));
      } else {
        console.log(`✅ Command succeeded`);
        resolve();
      }
    });

    child.on('error', (err) => {
      console.error(`❌ Error running command: ${err.message}`);
      reject(err);
    });
  });
}

async function checkFileExists(filePath, description) {
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${description} exists: ${filePath}`);
    return true;
  } else {
    console.error(`❌ ${description} not found: ${filePath}`);
    return false;
  }
}

async function testBuildOutput() {
  console.log('\n📦 Checking build output...');
  
  const expectedFiles = [
    { path: 'dist/index.js', desc: 'Main entry point' },
    { path: 'dist/index.d.ts', desc: 'TypeScript declarations' },
    { path: 'dist/core/executor.js', desc: 'Core executor module' },
    { path: 'dist/security/manager.js', desc: 'Security manager module' },
    { path: 'dist/context/manager.js', desc: 'Context manager module' },
    { path: 'dist/audit/logger.js', desc: 'Audit logger module' },
    { path: 'dist/utils/output-processor.js', desc: 'Output processor module' }
  ];

  let allExist = true;
  for (const file of expectedFiles) {
    const exists = await checkFileExists(file.path, file.desc);
    if (!exists) allExist = false;
  }

  return allExist;
}

async function testServerStartup() {
  console.log('\n🚀 Testing server startup...');
  
  return new Promise((resolve, reject) => {
    const serverProcess = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let output = '';
    let errorOutput = '';
    let timeout;
    let receivedResponse = false;

    // Parse JSON-RPC responses
    const parseOutput = (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          if (response.result && (response.result.capabilities || response.result.protocolVersion)) {
            console.log('✅ Server started successfully and responding to MCP protocol');
            console.log('   Protocol version:', response.result.protocolVersion);
            console.log('   Server name:', response.result.serverInfo?.name);
            receivedResponse = true;
            clearTimeout(timeout);
            serverProcess.kill('SIGTERM');
            resolve(true);
          }
        } catch (e) {
          // Not JSON, might be a log message
          if (line.includes('MCP Shell Server started')) {
            console.log('✅ Server startup log detected');
          }
        }
      }
    };

    serverProcess.stdout.on('data', parseOutput);

    serverProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      // Also try to parse stderr in case server logs there
      parseOutput(data);
    });

    serverProcess.on('error', (err) => {
      console.error(`❌ Failed to start server: ${err.message}`);
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      clearTimeout(timeout);
      if (!receivedResponse && code !== null && code !== 0 && code !== 143) { // 143 is SIGTERM
        console.error(`❌ Server exited with code ${code}`);
        if (errorOutput) {
          console.error('Error output:', errorOutput);
        }
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Send a test MCP initialize request with proper formatting
    setTimeout(() => {
      const initRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          capabilities: {},
          clientInfo: {
            name: 'mcp-exec-test',
            version: '1.0.0'
          }
        },
        id: 1
      };
      
      // MCP protocol expects one JSON object per line
      serverProcess.stdin.write(JSON.stringify(initRequest) + '\n');
    }, 1000); // Give server more time to initialize

    // Timeout after 10 seconds
    timeout = setTimeout(() => {
      console.error('❌ Server startup timeout - no MCP response received');
      console.error('Output received:', output);
      if (errorOutput) {
        console.error('Error output:', errorOutput);
      }
      serverProcess.kill('SIGTERM');
      reject(new Error('Server startup timeout'));
    }, 10000);
  });
}

async function runTests() {
  try {
    // Install dependencies
    console.log('📦 Installing dependencies...');
    await runCommand('npm', ['install']);

    // Clean previous build
    console.log('\n🧹 Cleaning previous build...');
    await runCommand('npm', ['run', 'clean']);

    // Build the project
    console.log('\n🔨 Building project...');
    await runCommand('npm', ['run', 'build']);

    // Verify build output
    const buildValid = await testBuildOutput();
    if (!buildValid) {
      throw new Error('Build output validation failed');
    }

    // Test server startup
    await testServerStartup();

    console.log('\n✅ All tests passed! The project builds and runs successfully.\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    exitCode = 1;
  }

  process.exit(exitCode);
}

// Run the tests
runTests();