# MCP-Exec: Enhanced Shell Command Execution Server

A sophisticated Model Context Protocol (MCP) server that provides secure, context-aware shell command execution with advanced AI optimizations, comprehensive audit logging, and intelligent monitoring.

## Features

### 🔒 Advanced Security
- **Multi-level security policies**: Strict, moderate, and permissive modes
- **Command validation**: Pattern-based dangerous command detection
- **Sandboxing**: Configurable network and file system access controls
- **Resource limits**: Memory, file size, and process count restrictions
- **Confirmation system**: Interactive approval for high-risk operations

### 🧠 AI Optimizations
- **Intelligent output processing**: Automatic detection and parsing of JSON, YAML, CSV
- **Command intent tracking**: Understands the purpose and context of commands
- **Smart suggestions**: AI-powered next command recommendations
- **Output enhancement**: Command-specific formatting for better readability
- **Noise reduction**: Removes progress indicators and unnecessary output

### 📊 Context Preservation
- **Session persistence**: Maintains state across server restarts
- **Working directory tracking**: Intelligent cd command handling
- **Environment variables**: Persistent environment state management
- **Command history**: Relationship tracking between commands
- **File system monitoring**: Tracks changes made by commands

### 📋 Comprehensive Audit & Compliance
- **Immutable audit logs**: Detailed logging of all operations
- **Real-time monitoring**: Configurable alert rules and notifications
- **Compliance reporting**: Automated security and usage reports
- **Log export**: Multiple formats (JSON, CSV, XML)
- **Alert management**: Acknowledgment and tracking system

## Installation

```bash
npm install -g mcp-exec
```

Or clone and build from source:

```bash
git clone https://github.com/bensons/mcp-exec.git
cd mcp-exec
npm install
npm run build
npm run setup-claude  # Automatically configure Claude Desktop
```

### Automated Setup

For the easiest setup experience:

```bash
# Clone and build
git clone https://github.com/bensons/mcp-exec.git
cd mcp-exec
npm install
npm run build

# Automatically configure Claude Desktop
npm run setup-claude

# Test the server (optional)
npm run test-server
```

This will automatically:
1. Build the TypeScript project
2. Create the appropriate Claude Desktop configuration file
3. Set up reasonable default security settings
4. Verify the server works correctly

## Quick Start

### Claude Desktop Integration

To use this MCP server with Claude Desktop, add the following configuration to your Claude Desktop settings:

#### macOS/Linux Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "mcp-exec": {
      "command": "node",
      "args": ["/path/to/mcp-exec/dist/index.js"],
      "env": {
        "MCP_EXEC_SECURITY_LEVEL": "moderate"
      }
    }
  }
}
```

#### Windows Configuration

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-exec": {
      "command": "node",
      "args": ["C:\\path\\to\\mcp-exec\\dist\\index.js"],
      "env": {
        "MCP_EXEC_SECURITY_LEVEL": "moderate"
      }
    }
  }
}
```

#### Using Global Installation

If you installed globally with `npm install -g mcp-exec`:

```json
{
  "mcpServers": {
    "mcp-exec": {
      "command": "mcp-exec"
    }
  }
}
```

### Basic Usage

Start the MCP server directly (for testing):

```bash
node dist/index.js
```

The server communicates via STDIO and implements the Model Context Protocol specification.

### Configuration

Create a configuration file or set environment variables:

```typescript
const config = {
  security: {
    level: 'moderate',
    confirmDangerous: true,
    allowedDirectories: ['/home/user/projects'],
    timeout: 300000
  },
  context: {
    preserveWorkingDirectory: true,
    sessionPersistence: true,
    maxHistorySize: 1000
  },
  output: {
    enableAiOptimizations: true,
    maxOutputLength: 10000
  }
};
```

## Available Tools

Once configured with Claude Desktop, you'll have access to these MCP tools:

### Core Execution Tools
- **`execute_command`** - Execute shell commands with security validation
- **`confirm_command`** - Confirm execution of dangerous commands
- **`get_context`** - Get current execution context and environment
- **`set_working_directory`** - Change the working directory for subsequent commands

### History and Context Tools
- **`get_history`** - View command execution history with filtering
- **`clear_history`** - Clear command history and session data
- **`get_filesystem_changes`** - Track file system changes from commands

### Security Tools
- **`update_security_config`** - Modify security settings and policies
- **`get_security_status`** - View current security configuration
- **`get_pending_confirmations`** - List commands awaiting confirmation

### AI Enhancement Tools
- **`get_intent_summary`** - Get AI insights about command patterns
- **`suggest_next_commands`** - Get AI-suggested follow-up commands

### Audit and Monitoring Tools
- **`generate_audit_report`** - Create comprehensive audit reports
- **`export_logs`** - Export audit logs in various formats
- **`get_alerts`** - View security and monitoring alerts
- **`acknowledge_alert`** - Acknowledge security alerts

## Security Levels

The server supports three security levels:

### Strict Mode
- Blocks all potentially dangerous commands
- Requires explicit confirmation for file operations
- Restricts directory access to configured paths
- Maximum security with minimal convenience

### Moderate Mode (Default)
- Allows most commands with confirmation for dangerous ones
- Balanced security and usability
- Suitable for most development workflows

### Permissive Mode
- Minimal restrictions on command execution
- Only blocks extremely dangerous operations
- Maximum convenience with basic safety nets

## Environment Variables

Configure the server behavior using environment variables:

```bash
# Security level (strict, moderate, permissive)
MCP_EXEC_SECURITY_LEVEL=moderate

# Enable/disable dangerous command confirmation
MCP_EXEC_CONFIRM_DANGEROUS=true

# Maximum command timeout in milliseconds
MCP_EXEC_TIMEOUT=300000

# Maximum output length in characters
MCP_EXEC_MAX_OUTPUT=10000

# Enable AI optimizations
MCP_EXEC_AI_OPTIMIZATIONS=true
```

## Troubleshooting

### Claude Desktop Not Detecting the Server

1. **Check configuration file location**:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Linux: `~/.config/claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. **Verify the configuration format**:
   ```bash
   npm run setup-claude  # Re-run setup to fix configuration
   ```

3. **Test the server manually**:
   ```bash
   npm run test-server  # Verify server functionality
   ```

4. **Restart Claude Desktop** after making configuration changes

### Permission Errors

If you encounter permission errors:

```bash
# Make sure the built file is executable
chmod +x dist/index.js

# Or rebuild with automatic permissions
npm run build
```

### Server Not Starting

1. **Check Node.js version**: Requires Node.js 16 or higher
2. **Verify dependencies**: Run `npm install` to ensure all dependencies are installed
3. **Check build output**: Run `npm run build` and verify `dist/index.js` exists
4. **Test manually**: Run `node dist/index.js` and check for error messages

### Security Warnings

The server includes comprehensive security features. If commands are being blocked:

1. **Check security level**: Default is "moderate" - you can adjust via environment variables
2. **Review blocked commands**: Check the audit logs for security violations
3. **Use confirmation system**: Dangerous commands require explicit confirmation

For more help, check the [GitHub Issues](https://github.com/bensons/mcp-exec/issues) or create a new issue.