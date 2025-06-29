#!/usr/bin/env node

/**
 * Setup script for configuring mcp-exec with Claude Desktop
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getClaudeConfigPath() {
  const platform = os.platform();
  
  switch (platform) {
    case 'darwin': // macOS
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32': // Windows
      return path.join(process.env.APPDATA || os.homedir(), 'Claude', 'claude_desktop_config.json');
    default: // Linux and others
      return path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json');
  }
}

function createClaudeConfig() {
  const configPath = getClaudeConfigPath();
  const configDir = path.dirname(configPath);
  const mcpExecPath = path.resolve(__dirname, '..', 'dist', 'index.js');
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    console.log(`Created directory: ${configDir}`);
  }
  
  // Read existing config or create new one
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      const existingConfig = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(existingConfig);
      console.log('Found existing Claude Desktop configuration');
    } catch (error) {
      console.warn('Warning: Could not parse existing config, creating new one');
    }
  }
  
  // Ensure mcpServers section exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  
  // Add mcp-exec configuration
  config.mcpServers['mcp-exec'] = {
    command: 'node',
    args: [mcpExecPath],
    env: {
      MCP_EXEC_SECURITY_LEVEL: 'moderate',
      MCP_EXEC_CONFIRM_DANGEROUS: 'true',
      MCP_EXEC_AI_OPTIMIZATIONS: 'true'
    }
  };
  
  // Write updated config
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`✅ Updated Claude Desktop configuration: ${configPath}`);
  console.log('\nConfiguration added:');
  console.log(JSON.stringify(config.mcpServers['mcp-exec'], null, 2));
  
  return configPath;
}

function verifySetup() {
  const distPath = path.resolve(__dirname, '..', 'dist', 'index.js');

  if (!fs.existsSync(distPath)) {
    console.error('❌ Error: dist/index.js not found. Please run "npm run build" first.');
    process.exit(1);
  }

  console.log('✅ Built server found at:', distPath);
  return true;
}

function main() {
  console.log('🚀 Setting up mcp-exec for Claude Desktop...\n');
  
  // Verify the build exists
  verifySetup();
  
  // Create/update Claude Desktop configuration
  const configPath = createClaudeConfig();
  
  console.log('\n📋 Next steps:');
  console.log('1. Restart Claude Desktop application');
  console.log('2. The mcp-exec tools should now be available in Claude Desktop');
  console.log('3. Try asking Claude to "execute a simple command like ls or dir"');
  
  console.log('\n🔧 Configuration file location:');
  console.log(`   ${configPath}`);
  
  console.log('\n🛡️  Security settings:');
  console.log('   - Security level: moderate');
  console.log('   - Dangerous command confirmation: enabled');
  console.log('   - AI optimizations: enabled');
  
  console.log('\n📖 For more configuration options, see README.md');
}

if (require.main === module) {
  main();
}

module.exports = { getClaudeConfigPath, createClaudeConfig, verifySetup };
