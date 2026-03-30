import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

async function testWebSocketTransport() {
  console.log('=== WebSocket Transport Test ===\n');
  
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:3002');
    let messageId = 0;
    let initialized = false;
    let testsPassed = 0;

    const sendMessage = (message: JsonRpcMessage): Promise<JsonRpcMessage> => {
      return new Promise((sendResolve, sendReject) => {
        const timeout = setTimeout(() => {
          sendReject(new Error('Request timeout'));
        }, 10000);

        const handler = (data: Buffer) => {
          const response = JSON.parse(data.toString()) as JsonRpcMessage;
          if (response.id === message.id) {
            clearTimeout(timeout);
            ws.removeListener('message', handler);
            if (response.error) {
              sendReject(new Error(response.error.message));
            } else {
              sendResolve(response);
            }
          }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify(message));
      });
    };

    ws.on('open', async () => {
      console.log('1. ✓ WebSocket connected\n');

      try {
        // Wait for initialized notification
        await new Promise<void>((initResolve) => {
          const initHandler = (data: Buffer) => {
            const msg = JSON.parse(data.toString()) as JsonRpcMessage;
            if (msg.method === 'notifications/initialized') {
              console.log('2. ✓ Received initialized notification\n');
              initialized = true;
              ws.removeListener('message', initHandler);
              initResolve();
            }
          };
          ws.on('message', initHandler);
        });

        // Test 1: List tools
        console.log('3. Listing tools...');
        const toolsResponse = await sendMessage({
          jsonrpc: '2.0',
          id: ++messageId,
          method: 'tools/list',
          params: {}
        });
        const tools = (toolsResponse.result as any)?.tools || [];
        console.log(`   ✓ Found ${tools.length} tools\n`);
        testsPassed++;

        // Test 2: Get system info
        console.log('4. Testing get_system_info...');
        await sendMessage({
          jsonrpc: '2.0',
          id: ++messageId,
          method: 'tools/call',
          params: { name: 'get_system_info', arguments: {} }
        });
        console.log('   ✓ System info retrieved\n');
        testsPassed++;

        // Test 3: Shell execute
        console.log('5. Testing shell_execute...');
        await sendMessage({
          jsonrpc: '2.0',
          id: ++messageId,
          method: 'tools/call',
          params: { name: 'shell_execute', arguments: { command: 'echo "Hello via WebSocket"' } }
        });
        console.log('   ✓ Shell command executed\n');
        testsPassed++;

        // Test 4: Memory write
        console.log('6. Testing memory...');
        await sendMessage({
          jsonrpc: '2.0',
          id: ++messageId,
          method: 'tools/call',
          params: { name: 'write_memory', arguments: { content: 'Test via WebSocket transport' } }
        });
        console.log('   ✓ Memory write successful\n');
        testsPassed++;

        ws.close();
        console.log('✓ WebSocket closed\n');
        console.log(`=== WebSocket TRANSPORT TESTS PASSED (${testsPassed}/4) ===`);
        resolve();

      } catch (error) {
        console.error('TEST FAILED:', error);
        ws.close();
        reject(error);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });

    ws.on('unexpected-response', (req, res) => {
      console.error('Unexpected response:', res.statusCode);
      reject(new Error(`Unexpected response: ${res.statusCode}`));
    });
  });
}

testWebSocketTransport().catch(() => process.exit(1));
