# Infected MCP Streaming - How It Works

## ⚠️ Important: How Streaming Actually Works

You're right to question this! Here's the **actual flow**:

### The Problem
Most agents:
1. Run command → Wait for completion → Get all output at once
2. **Never use the streaming endpoint**
3. The `output_id` is returned but ignored

### The Solution
For **real-time streaming**, the agent must:

```
1. Execute command → Get output_id (returns immediately!)
2. Poll /streaming/sse/{output_id} (while command runs)
3. Get output events AS THEY HAPPEN
4. Stop when 'complete' event received
```

## 📡 Complete Flow

```
Agent                          Server
  │                              │
  │──POST /mcp (ShellExecute)──▶│
  │                              │ Execute in background
  │◀─{output_id: "abc"}─────────│ Return immediately!
  │                              │
  │──GET /streaming/sse/abc────▶│
  │◀─{output: "Line 1"}─────────│ Stream as it happens
  │◀─{output: "Line 2"}─────────│
  │◀─{output: "Line 3"}─────────│
  │◀─{complete, exit: 0}────────│ Command finished
```

## 🧪 Test Real-time Streaming

```bash
# Start server
npm start

# Run streaming client (demonstrates the correct flow)
npx tsx clients/streaming-client.ts "for i in \$(seq 1 20); do echo \$i; sleep 0.5; done"
```

You'll see:
1. Command executes (returns immediately)
2. Client polls `/streaming/sse/{output_id}`
3. Numbers 1-20 appear in real-time (one every 0.5s)

## 📁 Files

| File | Purpose |
|------|---------|
| `streaming-client.ts` | Demo client that shows the correct polling flow |
| `test-client.ts` | Simple test client |
| `gemini-cli.config.json` | Gemini CLI configuration |
| `HOW-STREAMING-WORKS.md` | Detailed explanation |

## 🔧 Gemini CLI Config

```json
{
  "mcpServers": {
    "infected": {
      "command": "node",
      "args": ["/root/sandbox/infected/dist/index.js"],
      "cwd": "/root/sandbox/infected"
    }
  }
}
```

Copy to `~/.gemini/mcp.json`

## 📊 Server Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/mcp` | MCP HTTP Stream (execute commands) |
| `/sse` | MCP SSE Transport |
| `/streaming/sse/{outputId}` | **Real-time output streaming** |
| `/health` | Health check |

---

**Key insight: Agent must poll `/streaming/sse/{output_id}` WHILE command runs, not wait for completion!**
