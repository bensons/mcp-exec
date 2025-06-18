# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MCP-Exec** is a Model Context Protocol (MCP) server that provides secure, context-aware shell command execution with AI optimizations. It's built with TypeScript and designed to enhance AI-assisted development by intelligently processing command outputs and maintaining session context.

## Common Development Commands

### Build and Development
- `npm run build` - Compile TypeScript to JavaScript (outputs to `/dist`)
- `npm run dev` - Run the server in development mode with tsx
- `npm run watch` - Auto-reload development server using nodemon
- `npm start` - Run the compiled server from dist/
- `npm run clean` - Remove the dist directory

### Testing and Quality
- No test framework is currently configured (test script exits with error)
- No linting or formatting tools are configured

## Architecture Overview

The codebase follows a modular architecture with clear separation of concerns:

### Core Structure
```
src/
├── index.ts           # MCP server entry point - handles all tool registrations and request routing
├── core/
│   └── executor.ts    # Command execution engine with cross-platform support
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

3. **Context Preservation**: The `context/manager.ts` maintains:
   - Working directory state across commands
   - Environment variables
   - Command history with relationships
   - File system change tracking

4. **AI Optimizations**: The output processor in `utils/output-processor.ts` intelligently:
   - Detects and parses structured data (JSON, YAML, CSV)
   - Removes noise from outputs (progress bars, ANSI codes)
   - Provides command-specific formatting

5. **Audit System**: Comprehensive logging in `audit/` with:
   - Immutable append-only logs
   - Real-time monitoring with configurable alert rules
   - Multiple export formats (JSON, CSV, XML)

### MCP Protocol Implementation

The server uses STDIO transport and implements 16 MCP tools:
- Command execution tools: `execute_command`, `confirm_command`
- Context tools: `get_context`, `get_history`, `set_working_directory`
- Security tools: `update_security_config`, `get_security_status`
- AI tools: `get_intent_summary`, `suggest_next_commands`
- Audit tools: `generate_audit_report`, `export_logs`, `get_alerts`

### Important Implementation Details

1. **Cross-Platform Support**: Commands are executed using Node.js's `child_process.spawn()` with platform-specific shell detection.

2. **State Persistence**: Context is saved to `.mcp-exec-session.json` in the user's home directory.

3. **Security Configuration**: Default security level is "strict" - many operations require explicit configuration changes.

4. **Output Limits**: Default max output length is 10,000 characters to prevent overwhelming the AI context.

5. **Async Operations**: All tool handlers are async and use proper error handling with try-catch blocks.

### Configuration

The server accepts configuration through:
- Environment variables
- Runtime configuration updates via `update_security_config` tool
- Session persistence file

Key configuration areas:
- Security policies and restrictions
- Output processing preferences
- Context preservation settings
- Audit and monitoring rules