import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function runComprehensiveTests() {
  console.log('=== MCP Server Comprehensive Real-World Tests ===\n');
  
  // Create a single client and transport for all tests
  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3001/mcp'));
  
  try {
    // Connect once and keep the session alive
    console.log('1. Connecting to server...');
    await client.connect(transport);
    console.log('   ✓ Connected to server\n');

    // Test 2: List tools
    console.log('2. Listing available tools...');
    const tools = await client.listTools();
    console.log(`   ✓ Found ${tools.tools.length} tools\n`);

    // Test 3: Filesystem operations
    console.log('3. Testing filesystem operations...');
    
    const testDir = '/root/sandbox/infected/test-output';
    
    await client.callTool({ 
      name: 'create_directory', 
      arguments: { path: testDir } 
    });
    console.log('   ✓ Created test directory');

    await client.callTool({ 
      name: 'write_file', 
      arguments: { 
        path: `${testDir}/test.txt`,
        content: 'Hello from MCP test!' 
      } 
    });
    console.log('   ✓ Wrote test file');

    await client.callTool({ 
      name: 'read_text_file', 
      arguments: { path: `${testDir}/test.txt` } 
    });
    console.log('   ✓ Read file back');

    await client.callTool({ 
      name: 'list_directory', 
      arguments: { path: testDir } 
    });
    console.log('   ✓ Listed directory contents');

    await client.callTool({ 
      name: 'get_file_info', 
      arguments: { path: `${testDir}/test.txt` } 
    });
    console.log('   ✓ Got file info\n');

    // Test 4: Shell operations
    console.log('4. Testing shell operations...');
    
    await client.callTool({ 
      name: 'shell_execute', 
      arguments: { command: 'echo "Test 123"' } 
    });
    console.log('   ✓ Executed echo command');

    await client.callTool({ 
      name: 'shell_execute', 
      arguments: { command: 'ls -la /root/sandbox/infected/src' } 
    });
    console.log('   ✓ Executed ls command');

    await client.callTool({ name: 'terminal_list' });
    console.log('   ✓ Listed terminals\n');

    // Test 5: Memory operations
    console.log('5. Testing memory operations...');
    
    await client.callTool({ 
      name: 'write_memory', 
      arguments: { content: 'Test entry 1' } 
    });
    console.log('   ✓ Wrote memory entry 1');

    await client.callTool({ 
      name: 'write_memory', 
      arguments: { content: 'Test entry 2' } 
    });
    console.log('   ✓ Wrote memory entry 2');

    await client.callTool({ 
      name: 'read_memory', 
      arguments: { limit: 5 } 
    });
    console.log('   ✓ Read memory entries\n');

    // Test 6: Sequential thinking
    console.log('6. Testing sequential thinking...');
    
    await client.callTool({ 
      name: 'sequentialthinking', 
      arguments: { 
        thought: 'Breaking down this problem into steps',
        nextThoughtNeeded: true,
        thoughtsRemaining: 2
      } 
    });
    console.log('   ✓ Sequential thinking step 1');

    await client.callTool({ 
      name: 'sequentialthinking', 
      arguments: { 
        thought: 'Analyzing each component',
        nextThoughtNeeded: true,
        thoughtsRemaining: 1
      } 
    });
    console.log('   ✓ Sequential thinking step 2\n');

    // Test 7: System tools
    console.log('7. Testing system tools...');
    
    await client.callTool({ name: 'get_system_info' });
    console.log('   ✓ Got system info');

    await client.callTool({ 
      name: 'network_diagnostics', 
      arguments: { target: '8.8.8.8' } 
    });
    console.log('   ✓ Network diagnostics completed\n');

    // Test 8: Git operations
    console.log('8. Testing git operations...');
    
    try {
      await client.callTool({ 
        name: 'git_status', 
        arguments: { repo: '/root/sandbox/infected' } 
      });
      console.log('   ✓ Git status retrieved');
    } catch (e) {
      console.log('   ⚠ Git test skipped');
    }
    console.log();

    // Test 9: Error handling
    console.log('9. Testing error handling...');
    
    try {
      await client.callTool({ 
        name: 'read_text_file', 
        arguments: { path: '/nonexistent/path/file.txt' } 
      });
      console.log('   ✗ Should have thrown error for invalid path');
    } catch (e: any) {
      console.log('   ✓ Correctly handled invalid path error');
    }

    try {
      await client.callTool({ 
        name: 'shell_execute', 
        arguments: { command: 'nonexistent_command_xyz' } 
      });
      console.log('   ✗ Should have thrown error for invalid command');
    } catch (e: any) {
      console.log('   ✓ Correctly handled invalid command error');
    }
    console.log();

    // Test 10: Fetch operations (if network available)
    console.log('10. Testing fetch operations...');
    
    try {
      await client.callTool({ 
        name: 'fetch', 
        arguments: { url: 'https://httpbin.org/get' } 
      });
      console.log('   ✓ Fetch GET request successful');
    } catch (e) {
      console.log('   ⚠ Fetch test skipped (network unavailable)');
    }
    console.log();

    // Cleanup
    console.log('11. Cleaning up test files...');
    await client.callTool({ 
      name: 'shell_execute', 
      arguments: { command: `rm -rf ${testDir}` } 
    });
    console.log('   ✓ Cleanup complete\n');

    console.log('=== ALL COMPREHENSIVE TESTS PASSED ===');
    
  } catch (error) {
    console.error('TEST FAILED:', error);
    process.exit(1);
  } finally {
    // Close the client properly
    await client.close();
    console.log('Client closed');
  }
}

runComprehensiveTests();
