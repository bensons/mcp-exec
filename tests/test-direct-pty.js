#!/usr/bin/env node

/**
 * Test node-pty directly to see if exit works
 */

const pty = require('node-pty');

function testDirectPty() {
  return new Promise((resolve, reject) => {
    console.log('🔍 Testing node-pty directly...');
    
    // Get the shell
    const shell = process.env.SHELL || '/bin/bash';
    console.log(`Using shell: ${shell}`);
    
    // Create PTY process
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    });
    
    let output = '';
    let exitLogged = false;
    
    // Handle data
    ptyProcess.onData((data) => {
      output += data;
      console.log('PTY DATA:', JSON.stringify(data));
    });
    
    // Handle exit
    ptyProcess.onExit((exitCode, signal) => {
      console.log(`🚨 PTY EXITED: exitCode=${exitCode}, signal=${signal}`);
      exitLogged = true;
      resolve();
    });
    
    // Wait a bit for shell to start, then send exit
    setTimeout(() => {
      console.log('📝 Sending exit command...');
      ptyProcess.write('exit\r');
    }, 1000);
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (!exitLogged) {
        console.log('❌ PTY did not exit within 5 seconds');
        console.log('Final output:', JSON.stringify(output));
        ptyProcess.kill();
        reject(new Error('PTY did not exit'));
      }
    }, 5000);
  });
}

// Run the test
if (require.main === module) {
  testDirectPty()
    .then(() => {
      console.log('🎉 Direct PTY test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Direct PTY test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testDirectPty };
