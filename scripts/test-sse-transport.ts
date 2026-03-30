import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function testSSETransport() {
  console.log('=== SSE Transport Test ===\n');
  
  const client = new Client({
    name: 'sse-test-client',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  const transport = new SSEClientTransport(new URL('http://localhost:3001/sse'));
  
  try {
    console.log('1. Connecting via SSE...');
    await client.connect(transport);
    console.log('   ✓ Connected via SSE\n');

    console.log('2. Listing tools...');
    const tools = await client.listTools();
    console.log(`   ✓ Found ${tools.tools.length} tools\n`);

    console.log('3. Testing get_system_info...');
    const sysInfo = await client.callTool({ name: 'get_system_info', arguments: {} });
    console.log('   ✓ System info retrieved\n');

    console.log('4. Testing shell_execute...');
    const shellResult = await client.callTool({ 
      name: 'shell_execute', 
      arguments: { command: 'echo "Hello via SSE"' } 
    });
    console.log('   ✓ Shell command executed\n');

    console.log('5. Testing memory...');
    await client.callTool({ 
      name: 'write_memory', 
      arguments: { content: 'Test via SSE transport' } 
    });
    console.log('   ✓ Memory write successful\n');

    await client.close();
    console.log('✓ Client closed\n');

    console.log('=== SSE TRANSPORT TESTS PASSED ===');
    
  } catch (error) {
    console.error('TEST FAILED:', error);
    process.exit(1);
  }
}

testSSETransport();
