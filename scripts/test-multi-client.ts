import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function testClient(clientId: string, delayMs: number, abortMidway: boolean = false) {
  console.log(`[${clientId}] Starting...`);
  
  const client = new Client({
    name: `test-client-${clientId}`,
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3001/mcp'));
  
  try {
    await client.connect(transport);
    console.log(`[${clientId}] ✓ Connected`);

    await new Promise(r => setTimeout(r, delayMs));

    const tools = await client.listTools();
    console.log(`[${clientId}] ✓ Listed ${tools.tools.length} tools`);

    if (abortMidway) {
      console.log(`[${clientId}] ! Aborting midway...`);
      // Simulate abrupt disconnect by not closing properly
      return;
    }

    await client.callTool({ name: 'get_system_info', arguments: {} });
    console.log(`[${clientId}] ✓ Called get_system_info`);

    await client.callTool({ 
      name: 'shell_execute', 
      arguments: { command: `echo "Hello from ${clientId}"` } 
    });
    console.log(`[${clientId}] ✓ Called shell_execute`);

    await client.close();
    console.log(`[${clientId}] ✓ Closed properly`);
    
  } catch (error) {
    console.error(`[${clientId}] ✗ Error:`, (error as Error).message);
    throw error;
  }
}

async function runMultiClientTest() {
  console.log('=== Multi-Client Concurrent Test ===\n');
  
  try {
    // Test 1: Two clients connecting simultaneously
    console.log('Test 1: Two clients connecting simultaneously...\n');
    await Promise.all([
      testClient('Client-A', 100),
      testClient('Client-B', 150)
    ]);
    console.log('\n✓ Test 1 passed\n');

    // Wait a bit
    await new Promise(r => setTimeout(r, 1000));

    // Test 2: Three clients, one aborts midway
    console.log('Test 2: Three clients (one aborts midway)...\n');
    await Promise.allSettled([
      testClient('Client-C', 50),
      testClient('Client-D', 200, true), // Will abort midway
      testClient('Client-E', 100)
    ]);
    console.log('\n✓ Test 2 completed\n');

    // Wait a bit
    await new Promise(r => setTimeout(r, 1000));

    // Test 3: Rapid reconnection test
    console.log('Test 3: Rapid reconnection test...\n');
    for (let i = 0; i < 3; i++) {
      await testClient(`Rapid-${i}`, 50);
      await new Promise(r => setTimeout(r, 200));
    }
    console.log('\n✓ Test 3 passed\n');

    console.log('=== ALL MULTI-CLIENT TESTS COMPLETED ===');
    
  } catch (error) {
    console.error('TEST FAILED:', error);
  }
}

runMultiClientTest();
