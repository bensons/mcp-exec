# Environment Variables Configuration

The mcp-exec server supports comprehensive configuration through environment variables. Every configuration option can be customized using environment variables with the `MCP_EXEC_` prefix.

## 🔒 Security Configuration

| Environment Variable | Type | Default | Description |
|---------------------|------|---------|-------------|
| `MCP_EXEC_SECURITY_LEVEL` | `strict` \| `moderate` \| `permissive` | `permissive` | Overall security level |
| `MCP_EXEC_CONFIRM_DANGEROUS` | `boolean` | `false` | Require confirmation for dangerous commands |
| `MCP_EXEC_ALLOWED_DIRECTORIES` | `string` | `cwd,/tmp` | Comma-separated list of allowed directories |
| `MCP_EXEC_BLOCKED_COMMANDS` | `string` | See defaults | Comma-separated list of blocked commands |
| `MCP_EXEC_TIMEOUT` | `number` | `300000` | Command timeout in milliseconds (5 minutes) |
| `MCP_EXEC_MAX_MEMORY` | `number` | `1024` | Maximum memory usage in MB |
| `MCP_EXEC_MAX_FILE_SIZE` | `number` | `100` | Maximum file size in MB |
| `MCP_EXEC_MAX_PROCESSES` | `number` | `10` | Maximum number of processes |
| `MCP_EXEC_SANDBOXING_ENABLED` | `boolean` | `false` | Enable sandboxing (disabled for compatibility) |
| `MCP_EXEC_NETWORK_ACCESS` | `boolean` | `true` | Allow network access |
| `MCP_EXEC_FILESYSTEM_ACCESS` | `read-only` \| `restricted` \| `full` | `full` | File system access level |

## 📁 Context Configuration

| Environment Variable | Type | Default | Description |
|---------------------|------|---------|-------------|
| `MCP_EXEC_PRESERVE_WORKING_DIR` | `boolean` | `true` | Preserve working directory between commands |
| `MCP_EXEC_SESSION_PERSISTENCE` | `boolean` | `true` | Enable session persistence |
| `MCP_EXEC_MAX_HISTORY_SIZE` | `number` | `1000` | Maximum command history size |

## 🖥️ Session Configuration

| Environment Variable | Type | Default | Description |
|---------------------|------|---------|-------------|
| `MCP_EXEC_MAX_SESSIONS` | `number` | `10` | Maximum number of interactive sessions |
| `MCP_EXEC_SESSION_TIMEOUT` | `number` | `1800000` | Session timeout in milliseconds (30 minutes) |
| `MCP_EXEC_SESSION_BUFFER_SIZE` | `number` | `1000` | Session output buffer size |

## 📊 Output Configuration

| Environment Variable | Type | Default | Description |
|---------------------|------|---------|-------------|
| `MCP_EXEC_FORMAT_STRUCTURED` | `boolean` | `true` | Format output in structured format |
| `MCP_EXEC_STRIP_ANSI` | `boolean` | `true` | Strip ANSI escape codes from output |
| `MCP_EXEC_SUMMARIZE_VERBOSE` | `boolean` | `true` | Summarize verbose output |
| `MCP_EXEC_ENABLE_AI_OPTIMIZATIONS` | `boolean` | `true` | Enable AI-powered optimizations |
| `MCP_EXEC_MAX_OUTPUT_LENGTH` | `number` | `10000` | Maximum output length in bytes (10KB) |

## 🎨 Display Configuration

| Environment Variable | Type | Default | Description |
|---------------------|------|---------|-------------|
| `MCP_EXEC_SHOW_COMMAND_HEADER` | `boolean` | `true` | Show command header in output |
| `MCP_EXEC_SHOW_EXECUTION_TIME` | `boolean` | `true` | Show command execution time |
| `MCP_EXEC_SHOW_EXIT_CODE` | `boolean` | `true` | Show command exit code |
| `MCP_EXEC_FORMAT_CODE_BLOCKS` | `boolean` | `true` | Format output as code blocks |
| `MCP_EXEC_INCLUDE_METADATA` | `boolean` | `true` | Include metadata in output |
| `MCP_EXEC_INCLUDE_SUGGESTIONS` | `boolean` | `true` | Include AI suggestions |
| `MCP_EXEC_USE_MARKDOWN` | `boolean` | `true` | Use Markdown formatting |
| `MCP_EXEC_COLORIZE_OUTPUT` | `boolean` | `false` | Colorize terminal output |

## 📋 Audit Configuration

| Environment Variable | Type | Default | Description |
|---------------------|------|---------|-------------|
| `MCP_EXEC_AUDIT_ENABLED` | `boolean` | `true` | Enable audit logging |
| `MCP_EXEC_AUDIT_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `debug` | Audit log level |
| `MCP_EXEC_AUDIT_RETENTION` | `number` | `30` | Audit log retention in days |
| `MCP_EXEC_MONITORING_ENABLED` | `boolean` | `true` | Enable monitoring and alerts |
| `MCP_EXEC_ALERT_RETENTION` | `number` | `7` | Alert retention in days |
| `MCP_EXEC_MAX_ALERTS_PER_HOUR` | `number` | `100` | Maximum alerts per hour |

## 📝 Usage Examples

### Basic Security Configuration
```bash
export MCP_EXEC_SECURITY_LEVEL=strict
export MCP_EXEC_CONFIRM_DANGEROUS=true
export MCP_EXEC_TIMEOUT=600000
```

### Development Environment
```bash
export MCP_EXEC_SECURITY_LEVEL=permissive
export MCP_EXEC_CONFIRM_DANGEROUS=false
export MCP_EXEC_COLORIZE_OUTPUT=true
export MCP_EXEC_AUDIT_LOG_LEVEL=info
```

### Production Environment
```bash
export MCP_EXEC_SECURITY_LEVEL=strict
export MCP_EXEC_CONFIRM_DANGEROUS=true
export MCP_EXEC_SANDBOXING_ENABLED=true
export MCP_EXEC_NETWORK_ACCESS=false
export MCP_EXEC_FILESYSTEM_ACCESS=restricted
export MCP_EXEC_AUDIT_ENABLED=true
export MCP_EXEC_AUDIT_LOG_LEVEL=warn
```

### Docker Configuration
```dockerfile
ENV MCP_EXEC_SECURITY_LEVEL=moderate
ENV MCP_EXEC_MAX_MEMORY=512
ENV MCP_EXEC_MAX_PROCESSES=5
ENV MCP_EXEC_SESSION_TIMEOUT=900000
ENV MCP_EXEC_AUDIT_LOG_LEVEL=info
```

## 🔧 Configuration Validation

The server validates all environment variables at startup:
- **Type checking**: Boolean, number, and enum values are validated
- **Range checking**: Numeric values are checked for reasonable ranges
- **Default fallback**: Invalid values fall back to safe defaults
- **Startup logging**: Configuration is logged at startup for verification

## 🚀 Quick Start

1. **Set environment variables** before starting the server
2. **Verify configuration** by checking the startup logs
3. **Test settings** using the `get_security_status` tool
4. **Adjust as needed** and restart the server

## 📚 Related Documentation

- [Security Configuration](./docs/security.md)
- [Session Management](./docs/sessions.md)
- [Audit Logging](./docs/audit.md)
- [Terminal Viewer](./docs/terminal-viewer.md)
