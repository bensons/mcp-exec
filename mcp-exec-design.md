# Claude Code Instructions: Building an MCP Shell Command Execution Server

## Project Overview

You will be creating a new MCP (Model Context Protocol) server for shell command execution that improves upon existing implementations. This document analyzes three reference projects and provides specific implementation guidance based on their strengths and weaknesses.

## Reference Project Analysis

### Existing MCP Shell Servers Comparison

Three open-source projects serve as references:
- **hdresearch/mcp-shell**: Security-focused, Unix-only, simple implementation
- **jakenuts/mcp-cli-exec**: Feature-rich, cross-platform, flexible execution
- **g0t4/mcp-server-commands**: Unrestricted access, TypeScript, minimal features

### Key Technical Decisions

**Language**: Use TypeScript (following g0t4's approach) for type safety and modern features
**Architecture**: MCP protocol compliance with STDIO transport
**Platform Support**: Cross-platform (Windows, macOS, Linux) like jakenuts/mcp-cli-exec

## Core Implementation Requirements

### 1. Context Preservation System (Critical Priority)

Implement a robust context preservation mechanism that maintains state across AI interactions:

```typescript
interface ContextManager {
  // Preserve working directory between commands
  currentDirectory: string;
  
  // Track environment variables across session
  environmentVariables: Map<string, string>;
  
  // Maintain command history with relationships
  commandHistory: CommandHistoryEntry[];
  
  // Store output from previous commands for reference
  outputCache: Map<string, CommandOutput>;
  
  // Track file system changes
  fileSystemChanges: FileSystemDiff[];
}

interface CommandHistoryEntry {
  id: string;
  command: string;
  timestamp: Date;
  workingDirectory: string;
  environment: Record<string, string>;
  output: CommandOutput;
  relatedCommands: string[]; // IDs of related commands
  aiContext?: string; // The AI's intent/reason for the command
}
```

**Implementation Details**:
- Store context in memory with optional persistence to disk
- Implement session management with unique session IDs
- Provide context retrieval methods for the AI to understand previous operations
- Track dependencies between commands (e.g., "cd" affects subsequent commands)

### 2. Security Sandboxing Architecture (Critical Priority)

Build a multi-layered security system that protects users while maintaining flexibility:

```typescript
interface SecurityProvider {
  // Configure security levels
  securityLevel: 'strict' | 'moderate' | 'permissive';
  
  // Command validation before execution
  validateCommand(command: string): ValidationResult;
  
  // Resource limits
  resourceLimits: {
    maxExecutionTime: number;
    maxMemoryUsage: number;
    maxFileSize: number;
    allowedDirectories: string[];
    blockedDirectories: string[];
  };
  
  // Sandboxing options
  sandboxConfig: {
    useContainer: boolean;
    networkAccess: boolean;
    fileSystemAccess: 'read-only' | 'restricted' | 'full';
    environmentIsolation: boolean;
  };
}

interface ValidationResult {
  allowed: boolean;
  reason?: string;
  suggestions?: string[];
  riskLevel: 'low' | 'medium' | 'high';
}
```

**Security Implementation Guidelines**:
- Start with hdresearch's blacklist approach but make it configurable
- Add whitelist capability for known-safe commands
- Implement directory-based restrictions (prevent access to system directories)
- Add confirmation prompts for high-risk operations
- Create isolated execution environments using Node.js child processes with restricted permissions

### 3. Structured Output Management (Essential)

Design output formatting specifically for AI consumption:

```typescript
interface CommandOutput {
  // Standard streams
  stdout: string;
  stderr: string;
  exitCode: number;
  
  // Structured data when available
  structuredOutput?: {
    format: 'json' | 'yaml' | 'csv' | 'table';
    data: any;
    schema?: object;
  };
  
  // Metadata for AI understanding
  metadata: {
    executionTime: number;
    commandType: string; // 'file-operation', 'process-management', etc.
    affectedResources: string[];
    warnings: string[];
    suggestions: string[];
  };
  
  // AI-friendly summary
  summary: {
    success: boolean;
    mainResult: string;
    sideEffects: string[];
    nextSteps?: string[];
  };
}
```

**Output Processing Features**:
- Automatic detection of structured output (JSON, YAML, CSV)
- ANSI color code stripping with optional preservation
- Error message parsing and categorization
- Pattern recognition for common command outputs
- Automatic summarization of verbose outputs

### 4. Command Building and Validation

Implement intelligent command construction based on jakenuts/mcp-cli-exec features:

```typescript
interface CommandBuilder {
  // Single command execution with full options
  executeCommand(options: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    shell?: boolean | string;
  }): Promise<CommandOutput>;
  
  // Multiple command execution with dependencies
  executeCommandSequence(commands: Command[]): Promise<CommandOutput[]>;
  
  // Command template system
  executeTemplate(templateName: string, variables: Record<string, any>): Promise<CommandOutput>;
}
```

### 5. Comprehensive Audit Logging (Critical Priority)

Implement detailed logging for debugging, security, and compliance:

```typescript
interface AuditLogger {
  // Log levels
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  
  // Log entry structure
  logEntry: {
    timestamp: Date;
    sessionId: string;
    userId?: string;
    command: string;
    context: CommandContext;
    result: CommandOutput;
    securityCheck: ValidationResult;
    aiIntent?: string;
  };
  
  // Storage options
  storage: {
    type: 'file' | 'database' | 'remote';
    retention: number; // days
    encryption: boolean;
  };
  
  // Query interface
  queryLogs(filters: LogFilters): Promise<LogEntry[]>;
  
  // Analytics
  generateReport(timeRange: TimeRange): Promise<AuditReport>;
}
```

**Audit Features to Implement**:
- Immutable log storage with cryptographic signing
- Real-time streaming of logs to monitoring systems
- Configurable log retention policies
- Privacy-aware logging (redact sensitive information)
- Integration with external SIEM systems
- Command pattern analysis and anomaly detection

## Implementation Checklist

### Phase 1: Core Foundation
- [ ] Set up TypeScript project with modern tooling
- [ ] Implement basic MCP server with STDIO transport
- [ ] Create command execution engine with cross-platform support
- [ ] Add basic security validation (command blacklisting)

### Phase 2: Context and State Management
- [ ] Implement ContextManager with session support
- [ ] Add working directory tracking
- [ ] Create environment variable management
- [ ] Build command history with relationships

### Phase 3: Security Enhancements
- [ ] Implement configurable security levels
- [ ] Add sandboxing with resource limits
- [ ] Create directory-based access controls
- [ ] Implement confirmation prompts for dangerous operations

### Phase 4: AI Optimizations
- [ ] Build structured output parser
- [ ] Implement automatic output summarization
- [ ] Add error categorization and suggestions
- [ ] Create command intent tracking

### Phase 5: Audit and Compliance
- [ ] Implement comprehensive audit logging
- [ ] Add log querying and analytics
- [ ] Create compliance report generation
- [ ] Integrate with monitoring systems

## Configuration Example

```json
{
  "mcpServers": {
    "enhanced-shell": {
      "command": "npx",
      "args": ["-y", "enhanced-mcp-shell"],
      "config": {
        "security": {
          "level": "moderate",
          "confirmDangerous": true,
          "allowedDirectories": ["~/projects", "/tmp"],
          "blockedCommands": ["rm -rf /", "format"],
          "timeout": 300000
        },
        "context": {
          "preserveWorkingDirectory": true,
          "sessionPersistence": true,
          "maxHistorySize": 1000
        },
        "output": {
          "formatStructured": true,
          "stripAnsi": true,
          "summarizeVerbose": true
        },
        "audit": {
          "enabled": true,
          "logLevel": "info",
          "retention": 30
        }
      }
    }
  }
}
```

## Best Practices

1. **Error Handling**: Always provide clear, actionable error messages
2. **Performance**: Implement caching for repeated operations
3. **Security**: Default to restrictive settings with opt-in for more permissions
4. **Documentation**: Include inline help and examples for all commands
5. **Testing**: Create comprehensive test suites for security and functionality

## Success Criteria

Your implementation should:
- Maintain state across multiple AI interactions
- Provide multiple layers of configurable security
- Format output optimally for AI consumption
- Work seamlessly across Windows, macOS, and Linux
- Generate detailed audit logs for all operations
- Integrate smoothly with Claude Desktop, Claude Code, and Augment Code

Focus on building a tool that enhances AI-assisted development while protecting users from unintended consequences. The goal is to create an MCP server that acts as an intelligent intermediary between AI models and system commands, providing safety, context, and enhanced functionality.