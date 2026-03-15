# Real-Time Output in MCP

Based on the search results, here's how to get real-time output from long-running commands in MCP:

---

## Real-Time Output in MCP

### Transport Options for Streaming

| Transport | Use Case | Streaming Support |
|-----------|----------|-------------------|
| **Stdio** (default) | Local servers | ✅ Yes (via JSON-RPC notifications) |
| **SSE** (Server-Sent Events) | Remote servers | ✅ Yes |
| **Streamable HTTP** | Remote servers (modern) | ✅ Yes |

---

### Server-Side Requirements

To enable real-time streaming, the server needs:

1. **Use Streamable HTTP Transport** (recommended):
```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

await transport.connect();
await server.run(transport);
```

2. **Send Progress Notifications** during execution:
```typescript
// Server sends incremental updates via notifications
await transport.send({
  jsonrpc: "2.0",
  method: "notifications/progress",
  params: {
    progressToken: "req-001",  // From client's request
    progress: 100,
    total: 1000,
    message: "Processing row 100/1000"
  }
});
```

3. **For SSE Transport** (older approach):
```typescript
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

app.get("/mcp/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  const transport = new SSEServerTransport("/mcp/messages", res);
  // Stream events to client
});
```

---

### Client-Side Requirements

The client must:

1. **Include a `progressToken`** in the tool call request:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "long_running_command",
    "arguments": { "command": "npm run build" },
    "progressToken": "req-001"  // Enables streaming
  }
}
```

2. **Listen for progress notifications**:
```
event: message
data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"req-001","progress":100,"total":1000}}

event: message  
data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"req-001","progress":200,"total":1000}}
```

---

### How It Works

```
Client Request (with progressToken)
         ↓
    Server starts processing
         ↓
    Server sends progress notifications
    (JSON-RPC notifications/progress)
         ↓
    Client receives SSE stream in real-time
         ↓
    Server sends final result
```

---

### For Shell Command Streaming (Your Use Case)

For real-time shell output streaming, the server should:

1. **Spawn the child process** and capture stdout/stderr streams
2. **Stream output chunks** to the client via progress notifications:
```typescript
childProcess.stdout.on('data', (chunk) => {
  await transport.send({
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: {
      progressToken,
      progress: currentBytes,
      total: estimatedTotal,
      message: chunk.toString()  // Or use custom field
    }
  });
});
```

3. **Send final result** with the complete output

---

### Summary

| Side | What's Needed |
|------|--------------|
| **Server** | Streamable HTTP or SSE transport, send `notifications/progress` messages |
| **Client** | Include `progressToken` in request, listen for progress events |

The current shell module uses **stdio transport** and returns output only after completion. To get real-time streaming, you would need to switch to **Streamable HTTP transport** and implement progress notification streaming.

---

## Existing MCP Servers with Real-Time Output

Here are 5 MCP servers that actually implement real-time output streaming:

### 1. Shell-Stream-MCP (Python)
**Repository:** https://github.com/kilgor/Shell-Stream-MCP

A Python-based MCP server that supports real-time output streaming for shell commands. 

**Key Features:**
- Real-time output streaming via `read(session_id, offset, max_bytes)`
- Session management for long-running commands
- Security filtering (blocks dangerous operations)
- Cross-platform (Windows, Linux, macOS)

**How it works:**
1. `start(command)` - Starts command, returns session_id
2. `read(session_id, offset, max_bytes)` - Polls for output chunks in real-time
3. `status(session_id)` - Check if still running
4. `stop(session_id)` - Kill process

---

### 2. run-command-mcp (JavaScript/Node.js)
**Repository:** https://github.com/stilllovee/run-command-mcp

A Node.js MCP server with both synchronous and asynchronous streaming support.

**Key Features:**
- Synchronous: `run_command` - blocks until complete
- Asynchronous: `start_command` - returns process_id immediately
- Real-time: `get_command_output(process_id)` - poll for output while running
- HTTP Transport with SSE for true streaming
- Process management (list, kill, clear)

**How it works:**
```javascript
// Start long-running command
{ "command": "npm run dev", "timeout": 0 }  // timeout 0 = no limit

// Get output while running
{ "process_id": "550e8400...", "tail": 10 }

// Poll periodically for real-time updates
```

---

### 3. mcp-shell (Go)
**Repository:** https://github.com/sonirico/mcp-shell

A Go-based MCP server (60 stars) with security-focused shell execution.

**Key Features:**
- Executable allowlist (no shell injection)
- Configurable max execution time
- Max output size limits
- Audit logging
- YAML-based security config

**Security Modes:**
- **Secure mode**: Executable allowlist only, no shell interpretation
- **Legacy mode**: Shell execution with command blocklist

---

### 4. mcp-shell-server (TypeScript)
**Repository:** https://github.com/mkusaka/mcp-shell-server

A TypeScript MCP server for shell command execution.

**Key Features:**
- Multi-line command support (heredoc)
- Multiple shell support (bash, zsh, fish, powershell, cmd)
- Working directory control
- Detailed error handling

**Tools:**
- `shell_exec(command, workingDir)` - Execute command

---

### 5. Desktop Commander MCP (TypeScript)
**Repository:** https://github.com/wonderwhy-er/DesktopCommanderMCP

**Stars:** 5.6k - The most popular MCP shell server!

**Key Features:**
- **Interactive process control** - `start_process`, `interact_with_process`, `read_process_output`
- **Session management** - Maintain persistent terminal sessions
- **Process output pagination** - Read output with offset/length controls
- Long-running command support with real-time monitoring
- Extensive file operations (read, write, search, Excel, PDF, DOCX)
- Docker isolation support

**How it works:**
```javascript
// Start interactive process
{ "command": "npm run dev" }  // Returns session_id

// Read output while running
{ "session_id": "xxx", "offset": 0, "limit": 100 }

// Send input to running process
{ "session_id": "xxx", "input": "test\n" }

// Force terminate
{ "session_id": "xxx" }
```

---

## Comparison

| Server | Language | True Streaming | Session Management | Security |
|--------|----------|----------------|-------------------|----------|
| Shell-Stream-MCP | Python | Polling | ✅ | ✅ |
| run-command-mcp | Node.js | Polling + SSE | ✅ | Basic |
| mcp-shell | Go | Blocking | ❌ | ✅ |
| mcp-shell-server | TypeScript | Blocking | ❌ | Basic |
| Desktop Commander | TypeScript | Polling | ✅ | ✅ |

---

## Implementation Approaches

### Approach 1: Polling (Most Common)
Client repeatedly calls `get_output(process_id)` to check for new output:
```
Client: start_command("npm run build")
Server: Returns process_id="abc123"

Client: get_output(process_id="abc123")
Server: Returns output so far...

Client: get_output(process_id="abc123")  // poll again
Server: Returns more output...

Client: get_output(process_id="abc123")
Server: { status: "completed", output: "..." }
```

### Approach 2: SSE Streaming (True Real-Time)
Server pushes output chunks via Server-Sent Events:
```
Client: start_command("npm run build", { stream: true })
Server: Opens SSE connection
Server: Sends output chunk 1
Server: Sends output chunk 2
Server: Sends output chunk 3
Server: { status: "completed", final_output: "..." }
```

### Approach 3: Progress Notifications (MCP Standard)
Server sends `notifications/progress` via transport:
```
Server: await transport.send({
  method: "notifications/progress",
  params: { progressToken, progress: bytes, message: chunk }
})
```

---

## Sources

### MCP Servers with Real-Time Output
- [Shell-Stream-MCP - GitHub](https://github.com/kilgor/Shell-Stream-MCP)
- [run-command-mcp - GitHub](https://github.com/stilllovee/run-command-mcp)
- [mcp-shell (Go) - GitHub](https://github.com/sonirico/mcp-shell)
- [mcp-shell-server - GitHub](https://github.com/mkusaka/mcp-shell-server)
- [Desktop Commander MCP - GitHub](https://github.com/wonderwhy-er/DesktopCommanderMCP)

### MCP Specification & Implementation
- [MCP Specification - Streamable HTTP Transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)
- [MCP Specification - HTTP with SSE Transport](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports#http-with-sse)
- [How MCP Uses Streamable HTTP for Real-Time AI Tool Interaction](https://thenewstack.io/how-mcp-uses-streamable-http-for-real-time-ai-tool-interaction/)
- [MCP Server and Client with SSE & The New Streamable HTTP](https://levelup.gitconnected.com/mcp-server-and-client-with-sse-the-new-streamable-http-d860850d9d9d)
- [Streaming Responses in MCP Servers - Grizzly Peak Software](https://grizzlypeaksoftware.com/library/streaming-responses-in-mcp-servers-9eyk2gx2)
- [Building MCP Servers with Express.js](https://grizzlypeaksoftware.com/library/building-mcp-servers-with-expressjs-pw8vhhf4)
- [Remote MCP: SDIO, SSE, Streamable HTTP](https://4sysops.com/archives/remote-mcp-streamable-data-input-output-sdio-server-sent-events-sse-streamable-http/)
- [express-mcp-handler - GitHub](https://github.com/jhgaylor/express-mcp-handler)
- [mcp-template - GitHub](https://github.com/pshaddel/mcp-template)
