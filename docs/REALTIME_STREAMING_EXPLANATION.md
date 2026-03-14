# Real-Time Output Streaming in Infected MCP Server

## Overview

**Real-time output streaming** means that long-running commands (shell, SSH, build processes, etc.) can send their output **as it happens** in real-time, rather than waiting for the entire process to complete and then returning all output at once.

### Simple Analogy

Think of it like watching a live log file:

```
WITHOUT Real-Time Streaming:
┌─────────────────────────────────┐
│ Command: npm install            │
│ [Waiting...]                    │
│ [Waiting...]                    │
│ [Process completes in 30 sec]    │
│ [Return all output at once]      │
└─────────────────────────────────┘

WITH Real-Time Streaming:
┌─────────────────────────────────┐
│ Command: npm install            │
│ ✓ Added 1 package (0.5s)        │
│ ✓ Added 2 more packages (1s)    │
│ ✓ Resolved dependencies (5s)    │
│ ✓ Building... (8s)              │
│ ✓ Compiling... (15s)            │
│ ✓ Done! (30s)                   │
└─────────────────────────────────┘
```

## Architecture

### 1. **StreamPublisher** (Pub/Sub Model)

Located in `src/core/stream-publisher.ts`

```typescript
// Publisher notifies all subscribers of events
StreamPublisher:
├── notifyProcessStart(executionId, command)
├── notifyOutputData(executionId, data, isStderr)
├── notifyProcessEnd(executionId, exitCode)
└── notifyError(executionId, error)
```

**How it works:**

1. **Publisher** = ProcessManager (executes the command)
2. **Subscribers** = Listeners interested in the output
3. **Event-driven**: Each time output data comes, subscribers are notified

### 2. **Subscribers** (Multiple Types)

There are two main subscriber types:

#### A. **FileStorageSubscriber**
```
├─ Saves output to files
├─ Stores stdout and stderr separately
├─ Location: /tmp/mcp-shell-outputs/
└─ Used for later retrieval
```

Located in `src/core/file-storage-subscriber.ts`

When you execute a command with `output_id`:
```
Command output → FileStorageSubscriber → Saved to disk
                                       → Can be retrieved later
```

#### B. **RealtimeStreamSubscriber**
```
├─ Streams output in real-time
├─ Pushes data to connected clients
├─ Used for HTTP/SSE/WebSocket transports
└─ Live log view for web clients
```

Located in `src/core/realtime-stream-subscriber.ts`

### 3. **Flow Diagram**

```
┌──────────────────────────────────────────────────────────┐
│                  User/Client                              │
└──────────────────┬───────────────────────────────────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │  Shell Command:     │
         │  $ npm install      │
         │  $ docker build     │
         │  $ pytest tests/    │
         └────────┬────────────┘
                  │
        ┌─────────▼──────────┐
        │  ProcessManager    │
        │  (executes cmd)    │
        └────────┬───────────┘
                 │
        ┌────────▼─────────────────┐
        │  StreamPublisher (PUB)   │
        │  (broadcasts events)     │
        └────────┬─────────────────┘
                 │
        ┌────────┴─────────────────────┬──────────────────┐
        │                              │                  │
        ▼                              ▼                  ▼
  ┌──────────────┐          ┌──────────────────┐  ┌─────────────────┐
  │ FileStorage  │          │ RealtimeStream   │  │ Other Custom    │
  │ Subscriber   │          │ Subscriber       │  │ Subscribers     │
  │              │          │                  │  │                 │
  │ Save to disk │          │ Push to clients  │  │ (Custom logic)  │
  │ /tmp/outputs │          │ via HTTP/SSE/WS  │  │                 │
  └──────────────┘          └──────────────────┘  └─────────────────┘
        │                             │
        ▼                             ▼
  ┌──────────────┐          ┌──────────────────┐
  │ Output Files │          │ Connected        │
  │ on Disk      │          │ Web Browsers     │
  │              │          │ (Live view)      │
  └──────────────┘          └──────────────────┘
```

## Real-World Examples

### Example 1: Long-Running Build Command

```bash
# User executes: npm install with 1000 packages

Time 0s:  Output: "npm WARN optional dep skipped: node-sass@^7.0.0"
Time 2s:  Output: "npm WARN optional dep skipped: optional-dep@1.0.0"
Time 5s:  Output: "added 523 packages, and audited 1024 packages in 5.23s"
Time 10s: Output: "69 packages have security vulnerabilities"
Time 10s: EXIT_CODE: 0 ✓ Complete
```

**With Real-Time Streaming:**
- Client sees each line as it appears (2s, 5s, 10s)
- User gets immediate feedback
- No waiting for all 1000 packages to be processed

**Without Real-Time Streaming:**
- Client waits 10 seconds
- Gets all output at once
- Feels like the process is hanging

### Example 2: Docker Build

```bash
# User: docker build -t myapp:1.0 .

Streaming output as it happens:
┌─────────────────────────────────────────────┐
│ Time 0s:  Step 1/5 : FROM ubuntu:22.04     │
│ Time 1s:  Pulling from library/ubuntu       │
│ Time 5s:  Digest: sha256:abc123...          │
│ Time 6s:  Status: Downloaded                │
│ Time 7s:  Step 2/5 : RUN apt-get update    │
│ Time 8s:  Reading package lists...          │
│ Time 15s: Step 3/5 : COPY . /app           │
│ Time 16s: Step 4/5 : RUN npm install       │
│ Time 40s: Step 5/5 : CMD ["npm", "start"]  │
│ Time 41s: Successfully tagged myapp:1.0    │
└─────────────────────────────────────────────┘

User sees progress in REAL-TIME!
(Not waiting 41 seconds, then seeing output all at once)
```

### Example 3: SSH Commands

```typescript
// SSH Session with real-time streaming
await sshModule.execute({
  session_id: 'prod-deploy',
  command: './deploy.sh',
  get_output: true,  // Enable real-time output
  output_delay_ms: 100  // Send updates every 100ms
});

// Real-time output events:
Time 0.1s:  "Uploading code to servers..."
Time 1.2s:  "Stopping old services..."
Time 3.5s:  "Starting new version..."
Time 4.0s:  "Health check: 3/5 servers OK"
Time 5.5s:  "Health check: 5/5 servers OK"
Time 6.0s:  "✓ Deployment successful!"
```

## Implementation Details

### How Output is Captured

```typescript
// In ProcessManager when command is executed:

const child = spawn(shell, ['-c', command]);

// Capture stdout in real-time
child.stdout?.on('data', (data: Buffer) => {
  const output = data.toString();
  
  // Notify all subscribers immediately
  await streamPublisher.notifyOutputData(executionId, output, false);
  
  // Subscribe 1: Save to file
  // Subscribe 2: Send to web client
  // Subscribe 3: Log to monitoring system
});

// Same for stderr
child.stderr?.on('data', (data: Buffer) => {
  const error = data.toString();
  await streamPublisher.notifyOutputData(executionId, error, true);
});
```

### Configuration

Real-time streaming can be enabled/disabled:

```typescript
// In ProcessManager constructor:
const enableStreaming = process.env['MCP_SHELL_ENABLE_STREAMING'] !== 'false';

if (enableStreaming) {
  this.initializeStreamingComponents();
}
```

**Environment Variable:**
```bash
MCP_SHELL_ENABLE_STREAMING=true   # Enable real-time streaming
MCP_SHELL_ENABLE_STREAMING=false  # Disable (wait for completion)
```

## Benefits of Real-Time Streaming

| Benefit | Without | With |
|---------|---------|------|
| **User Feedback** | Feels frozen for 30+ sec | Immediate feedback every 100ms |
| **Debugging** | See error at the very end | See exactly where it failed |
| **Monitoring** | No visibility | Live progress tracking |
| **Network** | Send 100MB at once | Stream small chunks continuously |
| **Memory** | Buffer entire output | Process incrementally |
| **UX** | Poor (looks hung) | Excellent (progress visible) |

## File Operations Related to Streaming

### Output Files Structure
```
/tmp/mcp-shell-outputs/
├── execution-id-1/
│   ├── stdout.txt        ← stdout data
│   ├── stderr.txt        ← stderr data
│   └── metadata.json     ← execution info
├── execution-id-2/
│   ├── stdout.txt
│   ├── stderr.txt
│   └── metadata.json
└── ...
```

### File Storage Subscriber

```typescript
// When output data arrives:
FileStorageSubscriber.onOutputData(executionId, data, isStderr) {
  // Append to appropriate file
  if (isStderr) {
    fs.appendFile(`/tmp/outputs/${executionId}/stderr.txt`, data)
  } else {
    fs.appendFile(`/tmp/outputs/${executionId}/stdout.txt`, data)
  }
}
```

## Transports Supporting Real-Time Streaming

### 1. **HTTP with Streaming**
```
GET /execute?command=npm+install&output_id=exec-123
↓
Returns immediately with execution ID
↓
Client polls for updates
GET /get-execution?id=exec-123
↓
Returns latest output
```

### 2. **Server-Sent Events (SSE)**
```
Client: GET /stream/exec-123
Server: 
  data: {"type": "output", "data": "npm WARN..."}
  data: {"type": "output", "data": "added 523 packages..."}
  data: {"type": "complete", "exitCode": 0}
```

### 3. **WebSocket**
```
Client connects to /ws
Server pushes updates:
  {type: "process_start", command: "npm install"}
  {type: "output_data", data: "npm WARN...", stderr: false}
  {type: "output_data", data: "added 523...", stderr: false}
  {type: "process_end", exitCode: 0}
```

### 4. **STDIO (Command Line)**
```
Command: infected shell_execute '{"command": "npm install"}'
Output (streamed):
{"status": "running", "data": "npm WARN..."}
{"status": "running", "data": "added 523 packages..."}
{"status": "completed", "exitCode": 0}
```

## Use Cases in Infected MCP

### 1. **Shell Module** (Most Common)
- Long-running commands like `npm install`, `docker build`, `pytest tests/`
- Users see progress immediately
- Critical for debugging (see error as it happens)

### 2. **SSH Module**
- Remote deployments and maintenance scripts
- Monitor progress on remote servers
- See exactly when/where failures occur

### 3. **Build Tools**
- Docker builds
- Compilation processes
- Test suites running

### 4. **Data Processing**
- Large file transformations
- Database migrations
- ETL pipelines

## Key Components

### StreamPublisher
```typescript
// Manages all subscriptions
publisher.subscribe(subscriber)
publisher.subscribeToExecution(executionId, subscriberId)
publisher.notifyOutputData(executionId, data, isStderr)
```

### FileStorageSubscriber
```typescript
// Saves to disk
onOutputData(executionId, data, isStderr) {
  // Appends to file
}
```

### RealtimeStreamSubscriber
```typescript
// Pushes to clients
onOutputData(executionId, data, isStderr) {
  // Broadcasts to connected clients
}
```

### StreamingPipelineReader
```typescript
// Reads from files as they're being written
// Used to pipe output between processes
```

## Summary

Real-time streaming in Infected MCP Server means:

✅ **Output as it happens** - Not waiting for process to complete  
✅ **Multiple subscribers** - Can save to file AND send to web client simultaneously  
✅ **Publisher/Subscriber pattern** - Decoupled components  
✅ **Scalable** - Can add new subscribers without changing ProcessManager  
✅ **Non-blocking** - Processes don't wait for subscribers  
✅ **Flexible** - Works with all transport types (HTTP, SSE, WebSocket, STDIO)  

### Real-World Analogy

**Log streaming is like watching a live concert vs. a recording:**
- **Without streaming**: Wait for concert to end (30min), then watch recording (boring)
- **With streaming**: Watch live (exciting, see mistakes happen)

In development, real-time output streaming provides the same "live" experience instead of "wait and see everything after completion."
