#!/usr/bin/env node

/**
 * Test script to check if node-pty is working
 */

console.log('Testing node-pty dependency...');

try {
  const pty = require('node-pty');
  console.log('✅ node-pty imported successfully');
  
  // Try to create a simple PTY
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  console.log(`Attempting to spawn shell: ${shell}`);
  
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env
  });
  
  console.log('✅ PTY process created successfully');
  console.log(`PTY PID: ${ptyProcess.pid}`);
  
  // Test writing to PTY
  ptyProcess.write('echo "Hello from PTY"\r');
  
  // Listen for data
  ptyProcess.onData((data) => {
    console.log('PTY output:', data.trim());
  });
  
  // Clean up after 2 seconds
  setTimeout(() => {
    ptyProcess.kill();
    console.log('✅ PTY test completed successfully');
    process.exit(0);
  }, 2000);
  
} catch (error) {
  console.error('❌ Error testing node-pty:', error.message);
  console.error('Stack trace:', error.stack);
  
  if (error.message.includes('Cannot find module')) {
    console.error('\n💡 Suggestion: Try reinstalling node-pty:');
    console.error('   npm uninstall node-pty');
    console.error('   npm install node-pty');
  } else if (error.message.includes('binding')) {
    console.error('\n💡 Suggestion: node-pty may need to be rebuilt:');
    console.error('   npm rebuild node-pty');
  }
  
  process.exit(1);
}
