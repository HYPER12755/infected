# How MCP Streaming Works - Explained

## The Problem You Identified

You're absolutely right! Most agents:
1. Run a command
2. **Wait** for it to complete
3. Get all output at once

This means **no real-time streaming** happens!

## The Solution: Output ID + Polling

### Correct Flow

```
┌──────────────┐                          ┌──────────────┐
│    Agent     │                          │  MCP Server  │
└──────┬───────┘                          └──────┬───────┘
       │                                         │
       │ 1. POST /mcp                            │
       │    {                                    │
       │      method: "tools/call",              │
       │      params: {                          │
       │        name: "ShellExecute",            │
       │        arguments: {                     │
       │          command: "npm run build",      │
       │          output_id: "abc123"            │
       │        }                                │
       │      }                                  │
       │    }                                    │
       │────────────────────────────────────────▶│
       │                                         │
       │                                         │ Executes command
       │                                         │ in background
       │                                         │
       │ 2. Return IMMEDIATELY with output_id    │
       │    {                                    │
       │      output_id: "abc123",               │
       │      execution_id: "exec-456"           │
       │    }                                    │
       │◀────────────────────────────────────────│
       │                                         │
       │ 3. GET /streaming/sse/abc123            │
       │    (Poll for output)                    │
       │────────────────────────────────────────▶│
       │                                         │
       │ 4. Stream events AS THEY HAPPEN:        │
       │    event: output                        │
       │    data: "Building...\n"                │
       │                                         │
       │    event: output                        │
       │    data: "Compiling file1.ts\n"         │
       │                                         │
       │    event: output                        │
       │    data: "Compiling file2.ts\n"         │
       │◀────────────────────────────────────────│
       │                                         │
       │ 5. Continue polling...                  │
       │    event: complete                      │
       │    data: {"exit_code": 0}               │
       │◀────────────────────────────────────────│
       │                                         │
       │ ✅ Command done! Got real-time output   │
```

## Key Points

### 1. Execute Returns Immediately
The server should return `output_id` **without waiting** for command completion.

### 2. Agent Polls Streaming Endpoint
Agent continuously polls `/streaming/sse/{output_id}` to get output as it happens.

### 3. Streaming Events
- `output` - Real-time stdout/stderr
- `heartbeat` - Keep connection alive
- `complete` - Command finished with exit code

## Why Your Observation is Correct

Most MCP clients/agents:
- ❌ Call `ShellExecute` and **wait** for full response
- ❌ Don't poll the streaming endpoint
- ❌ Only get output after command completes

To get **real-time streaming**, the agent must:
- ✅ Execute command (get output_id)
- ✅ **Immediately** start polling `/streaming/sse/{output_id}`
- ✅ Process output events as they arrive
- ✅ Stop when `complete` event received

## Example: Agent That Streams

```typescript
// Step 1: Execute command
const { output_id } = await mcp.call('ShellExecute', {
  command: 'npm run build',
  output_id: 'stream-123'
});

// Step 2: Poll for streaming output (doesn't wait!)
const stream = await fetch(`/streaming/sse/${output_id}`);

for await (const event of parseSSE(stream)) {
  if (event.type === 'output') {
    console.log(event.data); // Real-time output!
  }
  if (event.type === 'complete') {
    console.log(`Exit code: ${event.data.exit_code}`);
    break;
  }
}
```

## The Server's Role

Server must:
1. ✅ Start command in **background**
2. ✅ Return `output_id` **immediately**
3. ✅ Buffer output to `RealtimeStreamSubscriber`
4. ✅ Serve buffered output via `/streaming/sse/{output_id}`

## Current Server Status

Our server:
- ✅ Has `/streaming/sse/{output_id}` endpoint
- ✅ Buffers output in real-time
- ✅ Streams via SSE events

What's needed:
- ⚠️ Agent must poll streaming endpoint
- ⚠️ Agent must NOT wait for command to complete

## Test It Yourself

```bash
# Start server
npm start

# Run streaming client (polls correctly)
npx tsx clients/streaming-client.ts "seq 1 10"

# You'll see:
# 1. Execute command (returns immediately)
# 2. Poll streaming endpoint
# 3. Get numbers 1-10 as they're printed
```

---

**The key insight: Agent must poll `/streaming/sse/{output_id}` while command runs, not wait for completion!**
