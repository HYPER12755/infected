import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function runTests() {
  console.log('=== MCP Server Real-World Tests ===\n');
  
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
    // Connect to server
    console.log('1. Connecting to server...');
    await client.connect(transport);
    console.log('   ✓ Connected successfully\n');

    // List available tools
    console.log('2. Listing available tools...');
    const tools = await client.listTools();
    console.log(`   ✓ Found ${tools.tools.length} tools:`);
    tools.tools.forEach(t => console.log(`      - ${t.name}`));
    console.log();

    // Test 1: System info
    console.log('3. Testing get_system_info...');
    const sysInfo = await client.callTool({ name: 'get_system_info', arguments: {} });
    console.log('   ✓ System info retrieved\n');

    // Test 2: Filesystem - read a file
    console.log('4. Testing filesystem - read_text_file...');
    const fileResult = await client.callTool({ 
      name: 'read_text_file', 
      arguments: { path: '/root/sandbox/infected/package.json' } 
    });
    console.log('   ✓ File read successfully\n');

    // Test 3: Shell command
    console.log('5. Testing shell_execute...');
    const shellResult = await client.callTool({ 
      name: 'shell_execute', 
      arguments: { command: 'echo "Hello from MCP"' } 
    });
    console.log('   ✓ Shell command executed\n');

    // Test 4: Memory module
    console.log('6. Testing memory - write_memory...');
    await client.callTool({ 
      name: 'write_memory', 
      arguments: { content: 'Test memory entry from automated test' } 
    });
    console.log('   ✓ Memory written\n');

    // Test 5: Sequential thinking
    console.log('7. Testing sequentialthinking...');
    await client.callTool({ 
      name: 'sequentialthinking', 
      arguments: { thought: 'Testing sequential thinking module' } 
    });
    console.log('   ✓ Sequential thinking works\n');

    console.log('=== ALL TESTS PASSED ===');
    
  } catch (error) {
    console.error('TEST FAILED:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

runTests();
