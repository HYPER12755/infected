#!/usr/bin/env tsx
/**
 * Infected MCP Streaming Client
 * 
 * This client shows how an agent should:
 * 1. Execute a command (gets output_id immediately)
 * 2. Poll /streaming/sse/{output_id} for real-time output
 * 3. Continue polling until 'complete' event
 */

const SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';
const API_KEY = process.env.MCP_API_KEY || '';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║  Infected MCP Streaming Client                        ║
║  Demonstrates: Execute → Poll Stream → Get Output     ║
╠═══════════════════════════════════════════════════════╣
║  Usage: npx tsx clients/streaming-client.ts <cmd>     ║
║                                                       ║
║  Example:                                             ║
║    npx tsx clients/streaming-client.ts "npm run build"║
╚═══════════════════════════════════════════════════════╝
`);
    process.exit(1);
  }

  const command = args.join(' ');
  await runWithStreaming(command);
}

/**
 * Main flow:
 * 1. Execute command via MCP (returns output_id immediately)
 * 2. Poll streaming endpoint for real-time output
 * 3. Wait for complete event
 */
async function runWithStreaming(command: string): Promise<void> {
  console.error('\n🚀 Step 1: Execute command via MCP');
  console.error('─'.repeat(50));
  
  // Step 1: Execute command and get output_id
  const { output_id, execution_id } = await executeCommand(command);
  
  console.error(`✅ Got output_id: ${output_id}`);
  console.error(`✅ Got execution_id: ${execution_id}`);
  
  console.error('\n🚀 Step 2: Poll streaming endpoint for real-time output');
  console.error('─'.repeat(50));
  console.error('📺 Real-time output:\n');
  
  // Step 2: Poll streaming endpoint until complete
  const exitCode = await pollStreaming(output_id);
  
  console.error('\n' + '─'.repeat(50));
  console.error(`✅ Command completed with exit code: ${exitCode}`);
}

/**
 * Step 1: Execute command via MCP
 * Returns immediately with output_id (doesn't wait for completion)
 */
async function executeCommand(command: string): Promise<{ output_id: string; execution_id: string }> {
  const outputId = `stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  const response = await fetch(`${SERVER_URL}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'ShellExecute',
        arguments: {
          command: command,
          working_directory: process.cwd(),
          timeout_seconds: 300,
          capture_stderr: true,
          execution_mode: 'foreground', // or 'background' for async
          output_id: outputId,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP server responded with ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  
  if (result.error) {
    throw new Error(result.error.message || 'MCP execution failed');
  }

  return {
    output_id: result.result?.structuredContent?.output_id || outputId,
    execution_id: result.result?.structuredContent?.execution_id,
  };
}

/**
 * Step 2: Poll streaming endpoint for real-time output
 * Uses HTTP polling (works in any environment)
 */
async function pollStreaming(outputId: string): Promise<number> {
  let lastSequence = -1;
  let exitCode: number | null = null;
  let isComplete = false;

  while (!isComplete) {
    try {
      // Poll the streaming endpoint
      const response = await fetch(`${SERVER_URL}/streaming/sse/${outputId}`, {
        headers: {
          'Accept': 'text/event-stream',
          ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.error('⚠️  Stream not found (may have expired)');
          return 1;
        }
        throw new Error(`Stream responded with ${response.status}`);
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // Parse SSE events
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          const lines = event.split('\n');
          let eventType = 'message';
          let data = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7);
            } else if (line.startsWith('data: ')) {
              data = line.slice(6);
            }
          }

          // Handle different event types
          if (data) {
            try {
              const parsed = JSON.parse(data);
              
              if (eventType === 'output') {
                // Real-time output!
                if (parsed.is_stderr) {
                  process.stderr.write(parsed.data);
                } else {
                  process.stdout.write(parsed.data);
                }
                lastSequence = parsed.sequence;
              } else if (eventType === 'complete') {
                // Command finished!
                exitCode = parsed.exit_code;
                isComplete = true;
              } else if (eventType === 'heartbeat') {
                // Keep-alive, ignore
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }

      reader.releaseLock();
    } catch (error) {
      if (!isComplete) {
        console.error('Stream error:', error instanceof Error ? error.message : String(error));
      }
      break;
    }

    // Small delay before reconnecting if not complete
    if (!isComplete) {
      await sleep(100);
    }
  }

  return exitCode ?? 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run main
main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});
