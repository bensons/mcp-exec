# MCP-Exec

A secure, context-aware Model Context Protocol (MCP) server for shell command execution with AI optimizations.

## Overview

**MCP-Exec** is a TypeScript-based MCP server that provides intelligent shell command execution capabilities for AI assistants like Claude Desktop, Claude Code, and Augment Code. It combines multi-layered security, context preservation, and enhanced output formatting to create a powerful tool for AI-assisted development and system administration.

The server implements the Model Context Protocol specification with STDIO transport, providing 19 comprehensive tools for secure shell interaction while maintaining session state and providing AI-optimized output formatting.

## ✨ Key Features

### 🔄 Interactive Sessions
- **Long-running processes** - Start and maintain interactive shells, REPLs, and other persistent processes
- **Session management** - Support for up to 10 concurrent interactive sessions (configurable)
- **Bidirectional communication** - Send commands and receive output from active sessions
- **Session persistence** - Sessions remain active until explicitly terminated or timeout
- **Command history tracking** - All session interactions are logged and tracked

### 🔒 Multi-layered Security

- **Configurable Security Levels**: Strict, moderate, and permissive modes
- **Command Validation**: Pattern-based dangerous command detection and blocking
- **Interactive Confirmation**: Approval prompts for high-risk operations
- **Resource Limits**: Memory, file size, and process restrictions
- **Directory Controls**: Configurable allowed/blocked directory access
- **Sandboxing**: Isolated execution environments with restricted permissions

### 🧠 Context Preservation

- **Session Management**: Maintains state across multiple AI interactions
- **Working Directory Tracking**: Preserves directory changes between commands
- **Environment Variables**: Persistent environment state management
- **Command History**: Detailed history with relationships and AI context
- **File System Monitoring**: Tracks changes and side effects

### 🎨 Enhanced Output Formatting

- **Rich Markdown Display**: Beautiful formatting optimized for Claude Desktop
- **Structured Data Parsing**: Automatic detection of JSON, YAML, CSV formats
- **Visual Indicators**: Icons, emojis, and color coding for quick recognition
- **AI-Optimized Summaries**: Intelligent output summarization and suggestions
- **Error Categorization**: Clear error messages with actionable suggestions

### 🌍 Cross-platform Support

- **Windows, macOS, Linux**: Full cross-platform compatibility
- **Shell Detection**: Automatic platform-specific shell selection
- **Path Handling**: Proper path resolution across operating systems

### 📋 Comprehensive Audit System

- **Immutable Logging**: Cryptographically signed audit trails
- **Real-time Monitoring**: Live monitoring with configurable alerts
- **Multiple Export Formats**: JSON, CSV, XML export capabilities
- **Compliance Reporting**: Detailed audit reports for security compliance
- **Privacy Controls**: Configurable sensitive data redaction

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/bensons/mcp-exec.git
cd mcp-exec

# Install dependencies
npm install

# Build the project
npm run build
```

### Configure Claude Desktop

The automated setup script will configure Claude Desktop for you:

```bash
npm run setup-claude
```

This script:

- Detects your operating system (macOS, Linux, Windows)
- Locates the Claude Desktop configuration file
- Adds the MCP-Exec server configuration
- Sets up default security settings

### Manual Configuration

If you prefer manual setup, add this to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "mcp-exec": {
      "command": "node",
      "args": ["/path/to/mcp-exec/dist/index.js"],
      "env": {
        "MCP_EXEC_SECURITY_LEVEL": "moderate",
        "MCP_EXEC_CONFIRM_DANGEROUS": "true",
        "MCP_EXEC_AUDIT_ENABLED": "true"
      }
    }
  }
}
```

### Start Using

1. **Restart Claude Desktop** to load the MCP server
2. **Test the integration** by asking Claude to execute a simple command
3. **Explore the tools** - try asking Claude to show command history or change directories

## 🛠️ Available Tools

The server provides 19 comprehensive MCP tools organized into categories:

### Core Execution Tools

- **`execute_command`** - Execute shell commands with full security validation and interactive session support
- **`confirm_command`** - Interactive confirmation system for dangerous operations

### Interactive Session Tools

- **`list_sessions`** - List all active interactive sessions with status information
- **`kill_session`** - Terminate a specific interactive session
- **`read_session_output`** - Read buffered output from an interactive session

### Context Management Tools

- **`get_context`** - Retrieve current execution context and environment details
- **`get_history`** - View formatted command execution history with AI context
- **`set_working_directory`** - Change and persist working directory across sessions

### Security Management Tools

- **`update_security_config`** - Modify security settings and policies
- **`get_security_status`** - View current security configuration and restrictions

### AI Assistance Tools

- **`get_intent_summary`** - Analyze command patterns and user intent
- **`suggest_next_commands`** - AI-powered suggestions for follow-up commands

### Audit and Monitoring Tools

- **`generate_audit_report`** - Create detailed audit reports with filtering
- **`export_logs`** - Export audit logs in multiple formats (JSON, CSV, XML)
- **`get_alerts`** - View security alerts and operational warnings

### Additional Tools

- **`get_environment`** - View environment variables and system information
- **`monitor_resources`** - Real-time resource usage monitoring
- **`validate_command`** - Pre-validate commands without execution
- **`get_suggestions`** - Context-aware command suggestions

## ⚙️ Configuration

### Security Levels

Choose the appropriate security level for your use case:

#### 🔒 Strict Mode

- **Use Case**: Production environments, shared systems
- **Behavior**: Blocks most dangerous operations, requires explicit approval
- **Commands Blocked**: File deletions, system modifications, network operations
- **Confirmation**: Required for all medium and high-risk commands

#### ⚖️ Moderate Mode (Default)

- **Use Case**: Development environments, personal systems
- **Behavior**: Balanced security with confirmation prompts
- **Commands Blocked**: Only highly dangerous operations (rm -rf /, format, etc.)
- **Confirmation**: Required for high-risk commands only

#### 🔓 Permissive Mode

- **Use Case**: Advanced users, isolated environments
- **Behavior**: Minimal restrictions, maximum flexibility
- **Commands Blocked**: Only system-destroying operations
- **Confirmation**: Optional, can be disabled

### Environment Variables

Configure the server behavior using environment variables:

```bash
# Security Configuration
MCP_EXEC_SECURITY_LEVEL=moderate          # strict|moderate|permissive
MCP_EXEC_CONFIRM_DANGEROUS=true           # Enable confirmation prompts
MCP_EXEC_BLOCKED_COMMANDS="rm -rf /,format" # Custom blocked commands
MCP_EXEC_ALLOWED_DIRECTORIES="~/projects,/tmp" # Allowed directories

# Output Configuration
MCP_EXEC_MAX_OUTPUT_LENGTH=10000          # Maximum output length
MCP_EXEC_FORMAT_OUTPUT=true               # Enable enhanced formatting
MCP_EXEC_STRIP_ANSI=true                  # Remove ANSI color codes

# Audit Configuration
MCP_EXEC_AUDIT_ENABLED=true               # Enable audit logging
MCP_EXEC_AUDIT_LEVEL=info                 # debug|info|warn|error
MCP_EXEC_AUDIT_RETENTION=30               # Days to retain logs

# Performance Configuration
MCP_EXEC_COMMAND_TIMEOUT=300000           # Command timeout (ms)
MCP_EXEC_MAX_MEMORY=1024                  # Memory limit (MB)
MCP_EXEC_MAX_PROCESSES=10                 # Process limit
```

### Runtime Configuration

You can also modify settings at runtime using the `update_security_config` tool:

```javascript
// Example: Update security level
{
  "securityLevel": "strict",
  "confirmDangerous": true,
  "blockedCommands": ["rm -rf", "format", "dd if="],
  "allowedDirectories": ["/home/user/safe", "/tmp"]
}
```

## 🔄 Interactive Sessions Usage

### Starting an Interactive Session

Use the `execute_command` tool with `session: "new"` to start an interactive process:

```javascript
{
  "command": "python3",
  "args": ["-i"],
  "session": "new",
  "aiContext": "Starting Python REPL for data analysis"
}
```

This returns a session ID that you can use for subsequent interactions.

### Sending Commands to a Session

Use the session ID to send commands to the interactive process:

```javascript
{
  "command": "print('Hello from Python!')",
  "session": "your-session-id-here"
}
```

### Managing Sessions

```javascript
// List all active sessions
{ "tool": "list_sessions" }

// Read buffered output from a session
{ "tool": "read_session_output", "sessionId": "your-session-id" }

// Terminate a session
{ "tool": "kill_session", "sessionId": "your-session-id" }
```

### Session Configuration

Configure session limits and timeouts in your environment:

```bash
# Maximum concurrent sessions (default: 10)
MCP_EXEC_MAX_SESSIONS=10

# Session timeout in milliseconds (default: 30 minutes)
MCP_EXEC_SESSION_TIMEOUT=1800000

# Output buffer size per session (default: 1000 lines)
MCP_EXEC_SESSION_BUFFER_SIZE=1000
```

## 🏗️ Development

### Build Commands

```bash
npm run build        # Compile TypeScript to JavaScript
npm run dev          # Run in development mode with tsx
npm run watch        # Auto-reload development server with nodemon
npm run start        # Run the compiled server from dist/
npm run clean        # Remove the dist directory
```

### Testing

The project includes comprehensive test suites organized in the `tests/` directory:

```bash
# Core Tests
npm test             # Build verification test
npm run test:server  # MCP server functionality test
npm run test:lifecycle # Server lifecycle management test

# Feature Tests
npm run test:ssh     # SSH command execution test
npm run test:all     # Run all test suites

# Individual Tests
node tests/test-mcp-server.js           # Basic server functionality
node tests/test-enhanced-output.js      # Output formatting
node tests/test-ssh-comprehensive.js    # SSH command testing
```

## 🏛️ Architecture

The codebase follows a modular architecture with clear separation of concerns:

### Core Structure

```text
src/
├── index.ts           # MCP server entry point - handles all tool registrations and request routing
├── core/
│   ├── executor.ts    # Command execution engine with cross-platform support
│   └── interactive-session-manager.ts # Interactive session management for long-running processes
├── security/
│   ├── manager.ts     # Security validation, sandboxing, and policy enforcement
│   └── confirmation.ts # Interactive confirmation system for dangerous commands
├── context/
│   └── manager.ts     # Session persistence and state management
├── audit/
│   ├── logger.ts      # Immutable audit logging system
│   └── monitoring.ts  # Real-time monitoring and alert management
├── utils/
│   ├── output-processor.ts # AI-optimized output parsing and formatting
│   └── intent-tracker.ts   # Command intent analysis and suggestions
└── types/
    └── index.ts       # Shared TypeScript type definitions
```

### Key Design Patterns

1. **MCP Tool Registration**: All tools are registered in `index.ts` using the MCP SDK's server.tool() method. Each tool has schema validation using Zod.

2. **Security Layers**: The security system uses a multi-tier approach:
   - Pattern matching for dangerous commands in `security/manager.ts`
   - Configurable security levels (strict/moderate/permissive)
   - Optional confirmation system for high-risk operations

3. **Interactive Sessions**: The `core/interactive-session-manager.ts` provides:
   - Long-running process management with configurable limits
   - Bidirectional communication with active sessions
   - Output buffering and session lifecycle management
   - Automatic cleanup of expired sessions

4. **Context Preservation**: The `context/manager.ts` maintains:
   - Working directory state across commands
   - Environment variables
   - Command history with relationships (including session interactions)
   - File system change tracking

5. **AI Optimizations**: The output processor in `utils/output-processor.ts` intelligently:
   - Detects and parses structured data (JSON, YAML, CSV)
   - Removes noise from outputs (progress bars, ANSI codes)
   - Provides command-specific formatting

6. **Audit System**: Comprehensive logging in `audit/` with:
   - Immutable append-only logs
   - Real-time monitoring with configurable alert rules
   - Multiple export formats (JSON, CSV, XML)

### MCP Protocol Implementation

The server uses STDIO transport and implements 19 MCP tools:

- Command execution tools: `execute_command`, `confirm_command`
- Interactive session tools: `list_sessions`, `kill_session`, `read_session_output`
- Context tools: `get_context`, `get_history`, `set_working_directory`
- Security tools: `update_security_config`, `get_security_status`
- AI tools: `get_intent_summary`, `suggest_next_commands`
- Audit tools: `generate_audit_report`, `export_logs`, `get_alerts`

## 🎨 Enhanced Output Formatting

The MCP server includes sophisticated output formatting that transforms raw command execution results into beautifully formatted, easy-to-read displays optimized for Claude Desktop's interface.

### Key Features

#### 🎨 Rich Markdown Formatting

- **Headers and Sections**: Clear organization with markdown headers
- **Code Blocks**: Syntax-highlighted command input and output
- **Visual Icons**: Emojis and symbols for quick visual recognition
- **Structured Layout**: Logical flow from command to results

#### 📋 Enhanced Command Output

Every command execution now includes:

```markdown
## Command Execution
**Command:** `your-command-here`
**Context:** AI context description
**Details:** ⏱️ 123ms | ✅ Exit code: 0 | 📂 Type: file-operation

### Input
```bash
your-command-here
```

### 📄 Output
```text
Command output here
```

### 📋 Summary
✅ **Result:** Command completed successfully
🔄 **Side Effects:** Modified 3 file(s)

### 💡 Suggestions
**Next Steps:**
• Suggested follow-up command
• Another helpful suggestion
```

## 🔧 Troubleshooting

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
   npm run test:server  # Verify server functionality
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

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- Check the documentation for detailed information
- Run `npm run test:server` to verify functionality
- Check [GitHub Issues](https://github.com/bensons/mcp-exec/issues) for common problems
- The server includes comprehensive error handling and logging

---

🎉 **Your MCP-Exec server is ready to enhance your Claude Desktop experience with powerful shell execution capabilities!**