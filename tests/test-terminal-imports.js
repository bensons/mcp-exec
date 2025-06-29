#!/usr/bin/env node

/**
 * Test script to check if terminal imports are working
 */

console.log('Testing terminal imports...');

try {
  console.log('1. Testing TerminalViewerService import...');
  const { TerminalViewerService } = require('../dist/terminal/viewer-service.js');
  console.log('✅ TerminalViewerService imported successfully');
  
  console.log('2. Testing TerminalSessionManager import...');
  const { TerminalSessionManager } = require('../dist/terminal/terminal-session-manager.js');
  console.log('✅ TerminalSessionManager imported successfully');
  
  console.log('3. Testing terminal types import...');
  const terminalTypes = require('../dist/terminal/types.js');
  console.log('✅ Terminal types imported successfully');
  
  console.log('4. Testing main server import...');
  const { MCPShellServer } = require('../dist/index.js');
  console.log('✅ MCPShellServer imported successfully');
  
  console.log('✅ All terminal imports working correctly');
  process.exit(0);
  
} catch (error) {
  console.error('❌ Error testing imports:', error.message);
  console.error('Stack trace:', error.stack);
  
  if (error.message.includes('Cannot find module')) {
    console.error('\n💡 Suggestion: Make sure the project is built:');
    console.error('   npm run build');
  }
  
  process.exit(1);
}
