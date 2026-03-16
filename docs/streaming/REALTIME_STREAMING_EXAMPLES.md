# Real-Time Output Streaming - Practical Examples

## Example 1: npm install (Classic Long-Running Task)

### WITHOUT Real-Time Streaming
```
Client: npm install
Server: Processing...
[5 seconds pass]
[10 seconds pass]
[15 seconds pass]
[20 seconds pass]
Client: Is it still running? 😕
[25 seconds pass]
Server: ✓ Done! 1024 packages installed
```

**Problem:** User has no feedback. Appears frozen.

### WITH Real-Time Streaming
```
Time 0s:   Client: npm install
Time 0.1s: Server → "npm WARN optional dep skipped"
Time 1.2s: Server → "npm notice created a lockfile"
Time 3.5s: Server → "added 523 packages"
Time 5.8s: Server → "added 234 more packages"
Time 8.1s: Server → "found 12 vulnerabilities"
Time 10s:  Server → ✓ Done! 1024 packages installed

Client sees progress the ENTIRE time! 🎉
```

**Benefit:** Immediate, continuous feedback. User knows it's working.

---

## Example 2: Docker Build

### Execution Timeline

```typescript
// Command: docker build -t myapp:latest .

// Real-time streaming output:

0s   │ Step 1/5 : FROM ubuntu:22.04
1s   │ ---> Pulling from library/ubuntu
2s   │ Pulling fs layer
3s   │ Pulling fs layer  
4s   │ Download complete
5s   │ ---> Pull complete
6s   │ Digest: sha256:abcd1234...
7s   │ 
8s   │ Step 2/5 : RUN apt-get update && apt-get install -y nodejs
9s   │ Reading package lists...
12s  │ Building dependency tree...
15s  │ Setting up nodejs (16.0.0-1)...
16s  │ Processing triggers...
17s  │
18s  │ Step 3/5 : WORKDIR /app
19s  │
20s  │ Step 4/5 : COPY . /app
21s  │
22s  │ Step 5/5 : RUN npm install
23s  │ npm WARN optional dependencies...
28s  │ added 234 packages in 5.23s
29s  │
30s  │ ---> Using cache
31s  │ ---> Built successfully
32s  │ ---> Successfully tagged myapp:latest

Total time: 32 seconds
User saw EVERY step as it happened!
```

### Comparison

| Aspect | Without Streaming | With Streaming |
|--------|-------------------|----------------|
| **Wait time** | 32 seconds of nothing | See progress every 100ms |
| **Debugging** | Can't see where build failed | See exact step that failed |
| **Network** | 10MB received at once (lag spike) | 10MB streamed gradually |
| **UX** | "Is it stuck?" | "Oh nice, Step 4 complete!" |

---

## Example 3: Python Test Execution

### Real Test Run with Real-Time Streaming

```
Command: pytest tests/ -v

0s    Collecting ... 
1s    Collected 45 items
2s    
3s    tests/test_auth.py::test_login PASSED                    [  2%]
4s    tests/test_auth.py::test_logout PASSED                   [  4%]
5s    tests/test_auth.py::test_token_refresh PASSED            [  6%]
6s    tests/test_api.py::test_get_user PASSED                  [ 13%]
7s    tests/test_api.py::test_create_user PASSED               [ 15%]
8s    tests/test_api.py::test_update_user PASSED               [ 17%]
9s    tests/test_api.py::test_delete_user PASSED               [ 19%]
10s   tests/test_db.py::test_connection PASSED                 [ 24%]
11s   tests/test_db.py::test_query PASSED                      [ 26%]
12s   tests/test_db.py::test_transaction FAILED                [ 28%]
13s   
14s   ===== FAILURES =====
15s   _____ test_transaction _____
16s   
17s   ConnectionTimeout: Database connection timed out
18s   
19s   tests/test_db.py:156: in test_transaction
20s     cursor.execute("BEGIN")
21s   
22s   === 9 passed, 1 failed in 19.234s ===

KEY INSIGHT: User saw IMMEDIATELY that test_transaction failed!
Without streaming, they'd wait 22s then see all failures at once.
```

---

## Example 4: SSH Deployment

### Real Production Deploy with Real-Time Feedback

```typescript
// Command: Deploy to production servers

await sshModule.execute({
  session_id: 'prod-001',
  command: './deploy.sh',
  get_output: true
});

Output in real-time:

0s   │ ✓ Connected to prod-001
1s   │ ✓ Checking disk space... 85% used
2s   │ ✓ Backing up database...
3s   │ ✓ Downloading new version...
4s   │ ✓ Stopping old service...
5s   │ ✓ Starting new version...
6s   │ ✓ Waiting for health check...
7s   │ ⚠ Health check: 2/5 services OK
8s   │ ⚠ Health check: 4/5 services OK
9s   │ ✓ Health check: 5/5 services OK
10s  │ ✓ Deployment complete in 10.23s

CRITICAL: At 7s, DevOps sees that only 2/5 services are healthy
Can monitor or take action if needed, instead of waiting 10s then seeing failure!
```

---

## Example 5: File Processing Pipeline

### Processing 1000 Images

```
Command: ./batch-process-images.sh input/ output/

WITHOUT Real-Time Streaming:
├─ User: "How long is this taking?"
├─ [Waiting 5 min]
├─ User: "Is it running?"
├─ [Waiting 5 min]
├─ User: "I'll come back later..."
└─ [After 15 min, gets result]

WITH Real-Time Streaming:
Time 0s:    Starting batch processing...
Time 2s:    Processing image 1-10... (10% complete)
Time 4s:    Processing image 11-20... (20% complete)
Time 6s:    Processing image 21-30... (30% complete)
Time 8s:    Processing image 31-40... (40% complete)
Time 10s:   Processing image 41-50... (50% complete)
Time 12s:   Processing image 51-60... (60% complete)
Time 14s:   Processing image 61-70... (70% complete)
Time 16s:   Processing image 71-80... (80% complete)
Time 18s:   Processing image 81-90... (90% complete)
Time 20s:   Processing image 91-100... (100% complete)
Time 21s:   ✓ All 1000 images processed!

User sees it's 50% done at 10 seconds, can estimate 20s total!
```

---

## Example 6: System Resource Monitoring

### Real-Time System Output

```
Command: top | head -50

Every 100ms, real-time streaming updates:

PID  COMMAND      %CPU  %MEM   Status
1234 npm          45.2  128M   Running (npm install)
5678 node         12.3  256M   Running (server)
9012 python       8.5   64M    Running (analytics)
3456 docker       2.1   512M   Running (container)

User can see:
✓ Which process is using most CPU right now
✓ Memory trends over time
✓ Spot resource leaks instantly
```

---

## Real-Time Streaming Implementation Flow

```
┌─────────────────────────────────────────────────────────┐
│                   User's Browser                        │
│  Or CLI Client, or HTTP Client                          │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ 1. Sends command: npm install
                   ▼
        ┌──────────────────────────────┐
        │   Infected MCP Server        │
        │   (HTTP/SSE/WebSocket)       │
        └──────────────┬───────────────┘
                       │
                       │ 2. Executes command
                       ▼
        ┌──────────────────────────────┐
        │   ProcessManager             │
        │   (Spawns child process)     │
        └──────────────┬───────────────┘
                       │
    ┌──────────────────┼──────────────────┐
    │                  │                  │
    │ 3a. Capture      │ 3b. Broadcast   │ 3c. Store
    │     output       │     to client   │     to file
    ▼                  ▼                  ▼
┌────────────┐  ┌─────────────┐  ┌──────────────┐
│ stdout     │  │ WebSocket   │  │ /tmp/outputs │
│ data       │  │ SSE stream  │  │ /{exec-id}/  │
│ received   │  │ HTTP poll   │  │ stdout.txt   │
│            │  │             │  │ stderr.txt   │
└────────────┘  └─────────────┘  └──────────────┘
    │                  │                │
    │ Loop until end   │ Loop until end │ Loop until end
    └──────────────────┴────────────────┘

RESULT: User sees live output instantly on all channels!
```

---

## Code Example: How to Use

### Using Shell Module with Streaming

```typescript
// Execute command and stream output
const result = await shellTools.executeShell({
  command: 'npm install --legacy-peer-deps',
  working_directory: '/app',
  execution_mode: 'foreground',
  output_id: 'exec-npm-123',  // Enable real-time output
  timeout_seconds: 600
});

// With HTTP/SSE transport, output streams in real-time:
// Stream 1 (100ms): {"status": "running", "stdout": "npm WARN..."}
// Stream 2 (200ms): {"status": "running", "stdout": "added 10 packages..."}
// Stream 3 (300ms): {"status": "running", "stdout": "added 20 packages..."}
// ...
// Final (10s): {"status": "completed", "exit_code": 0, "total_output": "1024 packages"}
```

### Using SSH with Real-Time Output

```typescript
// Deploy with live output
const deployment = await sshModule.sshOperate({
  session_id: 'deploy-prod',
  target: {
    host: 'prod.example.com',
    port: 22,
    user: 'deploy'
  },
  command: './deploy.sh',
  get_output: true,      // Enable real-time output
  output_delay_ms: 100   // Update every 100ms
});

// Output streams:
// 100ms: "✓ Downloaded version..."
// 200ms: "✓ Stopping services..."
// 300ms: "✓ Starting new version..."
// 400ms: "✓ Health check 1/5..."
// 500ms: "✓ Health check 2/5..."
// ...
```

---

## Benefits Summary

### For End Users
- ✅ See progress immediately
- ✅ Know it's not hung (shows activity)
- ✅ Can spot errors as they happen
- ✅ Better debugging experience

### For DevOps/SREs
- ✅ Monitor production deployments live
- ✅ Spot issues before they become critical
- ✅ Debug infrastructure problems in real-time
- ✅ See performance metrics as tests run

### For Developers
- ✅ See test results as they pass/fail
- ✅ Watch build progress
- ✅ Monitor CI/CD pipelines live
- ✅ Get instant feedback on long operations

### For System Performance
- ✅ Stream large outputs (no memory spike)
- ✅ Process data incrementally
- ✅ Reduce network latency
- ✅ Better scalability

---

## Technical Details

### Output Update Frequency
```typescript
// Default: Every 100ms
notificationInterval: 100,  // milliseconds

// Configurable per execution
output_delay_ms: 500  // Custom delay for SSH
```

### Buffer Size
```typescript
// Default: 8KB chunks
bufferSize: 8192,  // bytes

// Large output is streamed incrementally
// Not accumulated in memory
```

### Subscriber Types
```typescript
1. FileStorageSubscriber   → Saves to /tmp/outputs/{id}/stdout.txt
2. RealtimeStreamSubscriber → Pushes to WebSocket/SSE clients
3. Custom Subscribers       → Can implement own logic
```

---

## Conclusion

**Real-time output streaming** transforms the user experience from:
- ❌ "Click button, wait 30 seconds, see all output at once"

To:
- ✅ "Click button, watch progress unfold, see completion in real-time"

It's the difference between watching a live concert and watching a recording. For development, testing, and DevOps workflows, real-time feedback is **critical** for productivity and debugging.
