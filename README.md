# MCP-Exec

A secure, context-aware Model Context Protocol (MCP) server for shell command execution with comprehensive logging and AI optimizations.

## Overview

**MCP-Exec** is a TypeScript-based MCP server that provides intelligent shell command execution capabilities for AI assistants like Claude Desktop, Claude Code, and Augment Code. It combines multi-layered security, context preservation, RFC 5424 compliant logging, and enhanced output formatting to create a powerful tool for AI-assisted development and system administration.

The server implements the Model Context Protocol specification with STDIO transport, providing comprehensive tools for secure shell interaction while maintaining session state and providing AI-optimized output formatting with real-time logging capabilities.

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

### 📊 RFC 5424 Compliant Logging

- **Industry Standard**: Full RFC 5424 (Syslog Protocol) compliance with 8 severity levels
- **MCP Logging Capability**: Real-time log streaming to MCP clients via `notifications/message`
- **Dynamic Log Control**: Clients can set minimum log level using `logging/setLevel`
- **Comprehensive Coverage**: Detailed logging throughout all system components
- **Rate Limiting**: Configurable rate limiting to prevent message flooding
- **Context-Rich**: Detailed context information for enhanced debugging

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
      "args": ["/path/to/mcp-exec/dist/index.js"]
    }
  }
}
```

The server uses sensible defaults and can be customized with environment variables if needed. For custom configuration, add an `env` section:

```json
{
  "mcpServers": {
    "mcp-exec": {
      "command": "node",
      "args": ["/path/to/mcp-exec/dist/index.js"],
      "env": {
        "MCP_EXEC_SECURITY_LEVEL": "strict",
        "MCP_EXEC_CONFIRM_DANGEROUS": "true",
        "MCP_EXEC_MCP_LOG_LEVEL": "warning"
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

The server provides comprehensive MCP tools organized into categories:

### Core Execution Tools

- **`execute_command`** - Execute one-shot shell commands with full security validation and enhanced output formatting
- **`confirm_command`** - Interactive confirmation system for dangerous operations

### Interactive Session Tools

- **`start_interactive_session`** - Start new interactive shell sessions for persistent processes
- **`start_terminal_session`** - Start PTY-based terminal sessions with browser viewing capability
- **`send_to_session`** - Send commands to existing interactive sessions
- **`read_session_output`** - Read buffered output from interactive sessions
- **`list_sessions`** - List all active sessions with status information
- **`kill_session`** - Terminate specific sessions
- **`get_session_status`** - Get detailed status of a specific session

### Terminal Viewer Tools

- **`toggle_terminal_viewer`** - Enable/disable browser-based terminal viewing
- **`get_terminal_viewer_status`** - Check terminal viewer configuration and status

### Context Management Tools

- **`get_context`** - Retrieve current execution context and environment details
- **`get_history`** - View formatted command execution history with AI context
- **`set_working_directory`** - Change and persist working directory across sessions

### Security Management Tools

- **`update_security_config`** - Modify security settings and policies (legacy)
- **`get_security_status`** - View current security configuration and restrictions
- **`get_pending_confirmations`** - View pending dangerous command confirmations
- **`manage_blocked_commands`** - Add, remove, or list blocked commands
- **`manage_allowed_directories`** - Add, remove, or list allowed directories
- **`update_resource_limits`** - Modify memory, file size, and process limits

### AI Assistance Tools

- **`get_intent_summary`** - Analyze command patterns and user intent
- **`suggest_next_commands`** - AI-powered suggestions for follow-up commands

### Audit and Monitoring Tools

- **`generate_audit_report`** - Create detailed audit reports with filtering
- **`export_logs`** - Export audit logs in multiple formats (JSON, CSV, XML)
- **`get_alerts`** - View security alerts and operational warnings
- **`acknowledge_alert`** - Acknowledge and dismiss security alerts
- **`get_audit_config`** - View current audit configuration
- **`update_audit_config`** - Modify audit settings and log levels (legacy)
- **`update_mcp_logging`** - Configure MCP client notification settings
- **`update_audit_logging`** - Modify audit logging and monitoring settings

### Dynamic Configuration Tools

- **`get_configuration`** - Retrieve current configuration for any section
- **`update_configuration`** - Update configuration settings for any section
- **`reset_configuration`** - Reset configuration to default values
- **`get_configuration_history`** - View history of configuration changes
- **`rollback_configuration`** - Rollback to a previous configuration state
- **`update_session_limits`** - Adjust session limits and timeouts
- **`update_terminal_viewer`** - Configure terminal viewer service settings
- **`update_output_formatting`** - Modify output processing and formatting
- **`update_display_options`** - Adjust display and presentation settings
- **`update_context_config`** - Configure context preservation settings
- **`update_lifecycle_config`** - Modify server lifecycle behavior

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

The server supports comprehensive configuration through environment variables with the `MCP_EXEC_` prefix:

#### 🔒 Security Configuration

```bash
MCP_EXEC_SECURITY_LEVEL=permissive        # strict|moderate|permissive
MCP_EXEC_CONFIRM_DANGEROUS=false          # Require confirmation for dangerous commands
MCP_EXEC_ALLOWED_DIRECTORIES="cwd,/tmp"   # Comma-separated allowed directories
MCP_EXEC_BLOCKED_COMMANDS="rm -rf /,format" # Comma-separated blocked commands
MCP_EXEC_TIMEOUT=300000                    # Command timeout in milliseconds
MCP_EXEC_MAX_MEMORY=1024                   # Maximum memory usage in MB
MCP_EXEC_MAX_FILE_SIZE=100                 # Maximum file size in MB
MCP_EXEC_MAX_PROCESSES=10                  # Maximum number of processes
MCP_EXEC_SANDBOXING_ENABLED=false         # Enable sandboxing
MCP_EXEC_NETWORK_ACCESS=true              # Allow network access
MCP_EXEC_FILESYSTEM_ACCESS=full           # read-only|restricted|full
```

#### 📊 Logging Configuration

```bash
# Audit Logging (RFC 5424 compliant)
MCP_EXEC_AUDIT_ENABLED=true               # Enable audit logging
MCP_EXEC_AUDIT_LOG_LEVEL=debug            # emergency|alert|critical|error|warning|notice|info|debug
MCP_EXEC_AUDIT_RETENTION=30               # Days to retain logs

# MCP Client Logging
MCP_EXEC_MCP_LOGGING_ENABLED=true         # Enable MCP client notifications
MCP_EXEC_MCP_LOG_LEVEL=info               # Minimum level for notifications
MCP_EXEC_MCP_RATE_LIMIT=60                # Max messages per minute
MCP_EXEC_MCP_QUEUE_SIZE=100               # Max queued messages
MCP_EXEC_MCP_INCLUDE_CONTEXT=true         # Include context data
```

#### 🖥️ Session & Output Configuration

```bash
# Interactive Sessions
MCP_EXEC_MAX_SESSIONS=10                  # Maximum concurrent sessions
MCP_EXEC_SESSION_TIMEOUT=1800000          # Session timeout (30 minutes)
MCP_EXEC_SESSION_BUFFER_SIZE=1000         # Session output buffer size

# Server Lifecycle
MCP_EXEC_INACTIVITY_TIMEOUT=0             # Inactivity timeout in ms (0 = disabled, recommended for MCP)
MCP_EXEC_SHUTDOWN_TIMEOUT=5000            # Graceful shutdown timeout (5 seconds)
MCP_EXEC_ENABLE_HEARTBEAT=true            # Enable connection monitoring

# Output Formatting
MCP_EXEC_FORMAT_STRUCTURED=true           # Format output in structured format
MCP_EXEC_STRIP_ANSI=true                  # Strip ANSI escape codes
MCP_EXEC_SUMMARIZE_VERBOSE=true           # Summarize verbose output
MCP_EXEC_ENABLE_AI_OPTIMIZATIONS=true     # Enable AI-powered optimizations
MCP_EXEC_MAX_OUTPUT_LENGTH=10000          # Maximum output length in bytes
MCP_EXEC_USE_MARKDOWN=true                # Use Markdown formatting
```

### Dynamic Configuration Tools

The server provides comprehensive runtime configuration management through MCP tools, allowing you to modify settings without restarting the server:

#### 🔧 Configuration Management

- **`get_configuration`** - Retrieve current configuration for any section
- **`update_configuration`** - Update configuration settings for any section
- **`reset_configuration`** - Reset configuration to default values
- **`get_configuration_history`** - View history of configuration changes
- **`rollback_configuration`** - Rollback to a previous configuration state

#### 🔒 Security Management

- **`manage_blocked_commands`** - Add, remove, or list blocked commands
- **`manage_allowed_directories`** - Add, remove, or list allowed directories
- **`update_resource_limits`** - Modify memory, file size, and process limits

#### 📊 Logging Configuration

- **`update_mcp_logging`** - Configure MCP client notification settings
- **`update_audit_logging`** - Modify audit logging and monitoring settings

#### 🖥️ Session & Terminal Management

- **`update_session_limits`** - Adjust session limits and timeouts
- **`update_terminal_viewer`** - Configure terminal viewer service settings

#### 🎨 Output & Display Configuration

- **`update_output_formatting`** - Modify output processing and formatting
- **`update_display_options`** - Adjust display and presentation settings

#### 🔄 Context & Lifecycle Management

- **`update_context_config`** - Configure context preservation settings
- **`update_lifecycle_config`** - Modify server lifecycle behavior

### Runtime Configuration Examples

#### Update Security Settings

```javascript
// Change security level to strict
{
  "tool": "update_configuration",
  "arguments": {
    "section": "security",
    "settings": {
      "level": "strict",
      "confirmDangerous": true
    }
  }
}

// Add blocked commands
{
  "tool": "manage_blocked_commands",
  "arguments": {
    "action": "add",
    "commands": ["rm -rf /", "format", "dd if=/dev/zero"]
  }
}

// Update resource limits
{
  "tool": "update_resource_limits",
  "arguments": {
    "maxMemoryUsage": 2048,
    "maxFileSize": 200,
    "maxProcesses": 20
  }
}
```

#### Configure Logging

```javascript
// Update MCP logging settings
{
  "tool": "update_mcp_logging",
  "arguments": {
    "minLevel": "debug",
    "rateLimitPerMinute": 120,
    "maxQueueSize": 200,
    "includeContext": true
  }
}

// Update audit logging
{
  "tool": "update_audit_logging",
  "arguments": {
    "retention": 60,
    "monitoringEnabled": true,
    "desktopNotifications": true,
    "alertRetention": 14,
    "maxAlertsPerHour": 200
  }
}
```

#### Adjust Session Settings

```javascript
// Update session limits
{
  "tool": "update_session_limits",
  "arguments": {
    "maxInteractiveSessions": 20,
    "sessionTimeout": 3600000,
    "outputBufferSize": 2000
  }
}

// Configure terminal viewer
{
  "tool": "update_terminal_viewer",
  "arguments": {
    "port": 4000,
    "host": "0.0.0.0",
    "enableAuth": true,
    "authToken": "your-secure-token",
    "maxSessions": 20,
    "sessionTimeout": 3600000,
    "bufferSize": 20000
  }
}
```

#### Customize Output Formatting

```javascript
// Update output formatting
{
  "tool": "update_output_formatting",
  "arguments": {
    "formatStructured": false,
    "stripAnsi": false,
    "enableAiOptimizations": false,
    "maxOutputLength": 20000,
    "summarizeVerbose": false
  }
}

// Update display options
{
  "tool": "update_display_options",
  "arguments": {
    "showCommandHeader": false,
    "showExecutionTime": false,
    "showExitCode": false,
    "formatCodeBlocks": false,
    "includeMetadata": false,
    "includeSuggestions": false,
    "useMarkdown": false,
    "colorizeOutput": true
  }
}
```

#### Manage Context and Lifecycle

```javascript
// Update context configuration
{
  "tool": "update_context_config",
  "arguments": {
    "preserveWorkingDirectory": false,
    "sessionPersistence": false,
    "maxHistorySize": 2000
  }
}

// Update lifecycle settings
{
  "tool": "update_lifecycle_config",
  "arguments": {
    "inactivityTimeout": 600000,
    "gracefulShutdownTimeout": 10000,
    "enableHeartbeat": false
  }
}
```

### Configuration History and Rollback

The server maintains a history of all configuration changes, allowing you to:

```javascript
// View configuration history
{
  "tool": "get_configuration_history",
  "arguments": {
    "limit": 10
  }
}

// Rollback to a previous configuration
{
  "tool": "rollback_configuration",
  "arguments": {
    "changeId": "uuid-of-previous-change"
  }
}
```

### Legacy Runtime Configuration

You can also modify settings at runtime using the legacy `update_security_config` tool:

```javascript
// Example: Update security level
{
  "securityLevel": "strict",
  "confirmDangerous": true,
  "blockedCommands": ["rm -rf", "format", "dd if="],
  "allowedDirectories": ["/home/user/safe", "/tmp"]
}
```

## 📊 Enhanced Logging System

The server implements a comprehensive logging system that complies with RFC 5424 (Syslog Protocol) and supports the MCP logging specification for real-time client notifications.

### RFC 5424 Severity Levels

The logging system supports all 8 RFC 5424 severity levels:

| Level | Numeric | Name | Description | Use Cases |
|-------|---------|------|-------------|-----------|
| 0 | `emergency` | System is unusable | Complete system failures | Critical security breaches, system corruption |
| 1 | `alert` | Action must be taken immediately | Data corruption, security violations | Resource exhaustion, immediate intervention needed |
| 2 | `critical` | Critical conditions | Component failures affecting functionality | Database failures, critical security validations |
| 3 | `error` | Error conditions | Command execution failures, network errors | Configuration errors, execution failures |
| 4 | `warning` | Warning conditions | Deprecated features, resource limits approaching | Recoverable errors, potential issues |
| 5 | `notice` | Normal but significant condition | Configuration changes, session events | Security policy changes, important state changes |
| 6 | `info` | Informational messages | Operation progress, status updates | Command execution success, general information |
| 7 | `debug` | Debug-level messages | Function entry/exit, detailed execution flow | Variable values, detailed debugging information |

### MCP Logging Capability

The server implements the MCP logging specification, enabling real-time log streaming to MCP clients:

#### Features

- **Client Notifications**: Sends log messages to MCP clients via `notifications/message`
- **Dynamic Log Levels**: Clients can set minimum log level using `logging/setLevel`
- **Rate Limiting**: Configurable rate limiting to prevent message flooding (60 messages/minute default)
- **Message Queuing**: Queues messages when client is not connected (100 message buffer)
- **Context Inclusion**: Optional context data for enhanced debugging

#### MCP Logging Handler

Set the minimum log level for client notifications:

```json
{
  "method": "logging/setLevel",
  "params": {
    "level": "warning"
  }
}
```

Valid levels: `emergency`, `alert`, `critical`, `error`, `warning`, `notice`, `info`, `debug`

### Log Categories

- **`mcp-server`**: Server lifecycle and configuration events
- **`security-validator`**: Security policy enforcement and violations
- **`command-executor`**: Command execution, success, and failures
- **`context-manager`**: State management and session changes
- **`connection-monitor`**: Client connection and transport events

## 🔄 Interactive Sessions Usage

### Starting Interactive Sessions

Use dedicated session tools to start interactive processes:

#### Regular Interactive Session

```javascript
{
  "tool": "start_interactive_session",
  "command": "python3",
  "args": ["-i"],
  "aiContext": "Starting Python REPL for data analysis"
}
```

#### Terminal Session with Browser Viewing

```javascript
{
  "tool": "start_terminal_session",
  "command": "bash",
  "enableViewer": true,
  "terminalSize": {"cols": 120, "rows": 30}
}
```

Both return a session ID for subsequent interactions.

### Sending Commands to Sessions

Use the session ID to send commands to the interactive process:

```javascript
{
  "tool": "send_to_session",
  "sessionId": "your-session-id-here",
  "input": "print('Hello from Python!')"
}
```

### Managing Sessions

```javascript
// List all active sessions
{ "tool": "list_sessions" }

// Read buffered output from a session
{ "tool": "read_session_output", "sessionId": "your-session-id" }

// Get detailed session status
{ "tool": "get_session_status", "sessionId": "your-session-id" }

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
node tests/test-enhanced-logging.js     # RFC 5424 logging and MCP notifications
node tests/test-execute-command-no-session.js # One-shot command execution
node tests/test-session-separation.js   # Session functionality separation
node tests/test-mcp-annotations.js      # MCP tool annotations structure compliance
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
│   ├── logger.ts      # RFC 5424 compliant audit logging system
│   ├── mcp-logger.ts  # MCP client notification logging
│   └── monitoring.ts  # Real-time monitoring and alert management
├── terminal/
│   ├── session-manager.ts # PTY-based terminal session management
│   ├── viewer-service.ts  # Browser-based terminal viewing
│   └── static/        # Static assets for terminal viewer
├── utils/
│   ├── output-processor.ts # AI-optimized output parsing and formatting
│   └── intent-tracker.ts   # Command intent analysis and suggestions
└── types/
    └── index.ts       # Shared TypeScript type definitions with RFC 5424 log levels
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

The server uses STDIO transport and implements comprehensive MCP tools with logging capability:

- **Core execution**: `execute_command`, `confirm_command`
- **Interactive sessions**: `start_interactive_session`, `start_terminal_session`, `send_to_session`, `read_session_output`, `list_sessions`, `kill_session`, `get_session_status`
- **Terminal viewer**: `toggle_terminal_viewer`, `get_terminal_viewer_status`
- **Context management**: `get_context`, `get_history`, `set_working_directory`
- **Security management**: `update_security_config`, `get_security_status`, `get_pending_confirmations`
- **AI assistance**: `get_intent_summary`, `suggest_next_commands`
- **Audit and monitoring**: `generate_audit_report`, `export_logs`, `get_alerts`, `acknowledge_alert`, `get_audit_config`, `update_audit_config`
- **MCP logging**: `logging/setLevel` handler for dynamic log level control

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

### Server Shutting Down Prematurely

If the MCP server is shutting down unexpectedly:

1. **Inactivity timeout disabled by default**: The server now disables inactivity timeout by default (v1.0.0+) to prevent premature shutdowns
2. **Check for explicit timeout**: If you've set `MCP_EXEC_INACTIVITY_TIMEOUT` to a value > 0, the server will shut down after that period of inactivity
3. **Monitor connection**: The server will only shut down when the client actually disconnects or on explicit timeout
4. **Check logs**: Look for messages like "No activity for Xs, shutting down" in the server output

To completely disable inactivity timeout:
```bash
export MCP_EXEC_INACTIVITY_TIMEOUT=0  # 0 = disabled (default)
```

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