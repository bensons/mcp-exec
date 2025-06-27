# MCP-Exec Tests

This directory contains all test files and demo scripts for the MCP-Exec project.

## Test Files

### Core Functionality Tests
- **`test-mcp-server.js`** - Basic MCP server functionality test
- **`test-build.js`** - Build system verification test
- **`test-lifecycle.js`** - Server lifecycle management test
- **`test-simple-lifecycle.js`** - Simplified lifecycle test

### Output and Display Tests
- **`test-enhanced-output.js`** - Enhanced output formatting test
- **`demo-enhanced-output.js`** - Demo of enhanced output features

### SSH-Specific Tests
- **`test-ssh-comprehensive.js`** - Comprehensive SSH command testing
- **`test-ssh-final.js`** - Final SSH functionality verification
- **`test-ssh-improved.js`** - Improved SSH command handling test
- **`test-ssh-interactive.js`** - Interactive SSH session test
- **`test-ssh-summary.js`** - SSH test summary and results

### Setup and Configuration
- **`setup-claude-desktop.js`** - Claude Desktop integration setup script

## Running Tests

### Individual Tests
```bash
# Run from project root
node tests/test-mcp-server.js
node tests/test-ssh-comprehensive.js
# etc.
```

### Build and Test
```bash
# Build first, then test
npm run build
node tests/test-build.js
```

## Test Development Guidelines

When developing new tests:

1. **Create tests in this `tests/` folder**
2. **Use descriptive filenames** with `test-` prefix for test files
3. **Use `demo-` prefix** for demonstration scripts
4. **Include error handling** and proper cleanup
5. **Add documentation** to this README when adding new tests

### Test File Template
```javascript
#!/usr/bin/env node

/**
 * Description of what this test does
 */

async function runTest() {
  console.log('🧪 Test Name\n');
  
  try {
    // Test implementation
    console.log('✅ Test passed');
    return true;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

if (require.main === module) {
  runTest().then(success => {
    process.exit(success ? 0 : 1);
  });
}
```

## Test Categories

### Unit Tests
Tests that verify individual components or functions.

### Integration Tests
Tests that verify multiple components working together.

### End-to-End Tests
Tests that verify complete workflows from start to finish.

### Performance Tests
Tests that measure performance characteristics.

### Regression Tests
Tests that verify previously fixed bugs don't reoccur.

## Notes

- All tests should be self-contained and not depend on external services when possible
- Use timeouts appropriately to prevent hanging tests
- Clean up any temporary files or resources created during testing
- Include both positive and negative test cases
- Document any special requirements or setup needed for specific tests
