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
```

## Quick Start

### Basic Usage

Start the MCP server:

```bash
mcp-exec
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