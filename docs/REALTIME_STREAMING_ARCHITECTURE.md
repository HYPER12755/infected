# 🔄 REAL-TIME STREAMING ARCHITECTURE & CLIENT IMPLEMENTATION GUIDE

**Version**: 1.0  
**Date**: 2026-03-14  
**Status**: Production Ready

---

## 📋 TABLE OF CONTENTS

1. [How Real-Time Streaming Works](#how-real-time-streaming-works)
2. [Architecture Overview](#architecture-overview)
3. [Client-Side Implementation](#client-side-implementation)
4. [WebSocket vs SSE](#websocket-vs-sse)
5. [Complete Examples](#complete-examples)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## 🔄 HOW REAL-TIME STREAMING WORKS

### **The Flow:**

```
1. Client requests execution with output_id
2. Server starts command execution
3. Server emits REAL-TIME output chunks (as they happen!)
4. Client receives updates INSTANTLY
5. When done, server sends completion event
6. Client processes final result
```

### **Key Points:**

- **NOT polling** - Client doesn't ask repeatedly "is it done?"
- **PUSH model** - Server PUSHES data to client
- **Real-time** - Output appears as command executes
- **Bidirectional** (WebSocket) or unidirectional (SSE)
- **Low latency** - <50ms for WebSocket, 50-100ms for SSE

---

## 🏗️ ARCHITECTURE OVERVIEW

### **Server-Side Architecture:**

```
┌─────────────────────────────────────────────────────┐
│                 Infected MCP Server                  │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │   Shell Module / SSH Module                   │   │
│  │   (Executing long-running commands)           │   │
│  └──────────────────────────────────────────────┘   │
│                      │                                │
│                      ▼                                │
│  ┌──────────────────────────────────────────────┐   │
│  │  StreamErrorHandler                          │   │
│  │  • Tracks execution metrics                  │   │
│  │  • Manages timeouts (30 seconds)             │   │
│  │  • Records errors                            │   │
│  │  • Handles backpressure                      │   │
│  └──────────────────────────────────────────────┘   │
│                      │                                │
│                      ▼                                │
│  ┌──────────────────────────────────────────────┐   │
│  │  Transport Layer (WebSocket or SSE)          │   │
│  │  • Maintains client connections              │   │
│  │  • Routes messages to subscribers            │   │
│  │  • Handles subscriptions                     │   │
│  │  • Broadcasts output chunks                  │   │
│  └──────────────────────────────────────────────┘   │
│                      │                                │
└──────────────────────┼────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
   WebSocket        WebSocket      WebSocket
   Client 1        Client 2       Client 3
```

### **Data Flow:**

```
Execution Request
     │
     ▼
{
  command: "npm build",
  output_id: "exec-123"    ← Key for streaming!
}
     │
     ▼
Server starts execution
     │
     ▼
Output chunk arrives:
{
  type: "output",
  executionId: "exec-123",
  data: "Building...\n",
  isStderr: false,
  timestamp: 1710384000000
}
     │
     ▼
StreamErrorHandler processes
     │
     ▼
Transport broadcasts to all subscribers
     │
     ▼
Clients receive instantly!

... (more chunks) ...

     ▼
Command finishes:
{
  type: "complete",
  executionId: "exec-123",
  exitCode: 0,
  duration: 5234
}
     │
     ▼
Clients know it's done!
```

---

## 💻 CLIENT-SIDE IMPLEMENTATION

### **What Client-Side Should Have:**

#### **1. Connection Management**
- ✅ Connect to WebSocket/SSE server
- ✅ Handle reconnection on disconnect
- ✅ Manage connection state (connecting, connected, disconnected)
- ✅ Implement heartbeat/ping-pong

#### **2. Subscription Management**
- ✅ Subscribe to execution stream when command starts
- ✅ Track which executions you're subscribed to
- ✅ Unsubscribe when done
- ✅ Handle multiple simultaneous streams

#### **3. Message Handling**
- ✅ Parse incoming messages
- ✅ Route by type (output, complete, error, heartbeat)
- ✅ Accumulate output in buffer
- ✅ Handle errors gracefully

#### **4. UI Updates**
- ✅ Display output in real-time (line by line)
- ✅ Show stderr differently (red/different color)
- ✅ Handle very long outputs (virtualizing, pagination)
- ✅ Show progress/status

#### **5. Error Handling**
- ✅ Handle network disconnections
- ✅ Retry on timeout
- ✅ Show error messages to user
- ✅ Fallback to polling if needed

---

## 🔌 WEBSOCKET VS SSE

### **WebSocket Transport (Recommended)**

**Pros:**
- ✅ Bidirectional (client can send, server can send)
- ✅ Low latency (<50ms)
- ✅ Full-duplex communication
- ✅ Better for interactive applications
- ✅ Can send commands while streaming

**Cons:**
- ❌ Requires WebSocket server support
- ❌ Slightly more complex setup
- ❌ More resource intensive

**Best For:**
- Real-time applications
- Interactive command execution
- Two-way communication needed

### **Server-Sent Events (SSE) Transport (Fallback)**

**Pros:**
- ✅ Simple HTTP (no special protocol)
- ✅ Works with any HTTP server
- ✅ Automatic reconnection
- ✅ Simple EventSource API
- ✅ Great fallback option

**Cons:**
- ❌ Unidirectional (server → client only)
- ❌ Slightly higher latency (50-100ms)
- ❌ Max 6 concurrent connections per domain
- ❌ Limited by browser's EventSource limit

**Best For:**
- Simple server → client streaming
- Monitoring/logging
- Fallback when WebSocket unavailable
- Simple implementations

### **Comparison Table:**

| Feature | WebSocket | SSE |
|---------|-----------|-----|
| Latency | <50ms | 50-100ms |
| Bidirectional | ✅ Yes | ❌ No |
| Setup Complexity | Medium | Simple |
| Server Support | Need WS server | Any HTTP |
| Browser Support | Modern | All |
| Concurrent Limit | Unlimited | 6 per domain |
| Reconnection | Manual | Automatic |
| Best Use Case | Interactive | Monitoring |

---

## 📝 COMPLETE EXAMPLES

### **Example 1: WebSocket Client (JavaScript/Browser)**

```javascript
class StreamingClient {
  constructor(wsUrl = 'ws://localhost:3000/api/stream') {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.subscriptions = new Map(); // execution_id -> callbacks
    this.outputBuffers = new Map();  // execution_id -> output
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  // ===== Connection Management =====
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('✅ Connected to streaming server');
          this.reconnectAttempts = 0;
          this.showStatus('Connected', 'success');
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };

        this.ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          this.showStatus('Connection error', 'error');
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('⚠️ Disconnected from server');
          this.showStatus('Disconnected', 'warning');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  // ===== Auto-Reconnect =====
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached');
      this.showStatus('Connection lost', 'error');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff
    console.log(`⏳ Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => this.connect().catch(() => {}), delay);
  }

  // ===== Subscription Management =====
  subscribeToStream(executionId, callbacks) {
    // callbacks = { onOutput, onError, onComplete }
    this.subscriptions.set(executionId, callbacks);
    this.outputBuffers.set(executionId, '');

    // Send subscription message
    this.send({
      type: 'subscribe',
      executionId: executionId
    });

    console.log(`✅ Subscribed to stream: ${executionId}`);
  }

  unsubscribeFromStream(executionId) {
    this.send({
      type: 'unsubscribe',
      executionId: executionId
    });

    this.subscriptions.delete(executionId);
    this.outputBuffers.delete(executionId);

    console.log(`✅ Unsubscribed from stream: ${executionId}`);
  }

  // ===== Message Handling =====
  handleMessage(message) {
    const { type, executionId, data, isStderr, exitCode, error } = message;

    const callbacks = this.subscriptions.get(executionId);
    if (!callbacks) return; // Not subscribed to this stream

    switch (type) {
      case 'output':
        this.handleOutput(executionId, data, isStderr, callbacks);
        break;

      case 'complete':
        this.handleComplete(executionId, exitCode, callbacks);
        break;

      case 'error':
        this.handleError(executionId, error, callbacks);
        break;

      case 'heartbeat':
        // Server is alive, do nothing
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  }

  handleOutput(executionId, data, isStderr, callbacks) {
    // Accumulate output
    const buffer = this.outputBuffers.get(executionId) || '';
    this.outputBuffers.set(executionId, buffer + data);

    // Call user callback
    if (callbacks.onOutput) {
      callbacks.onOutput({
        data,
        isStderr,
        fullOutput: this.outputBuffers.get(executionId),
        timestamp: Date.now()
      });
    }

    // Log for debugging
    if (isStderr) {
      console.error('STDERR:', data);
    } else {
      console.log('STDOUT:', data);
    }
  }

  handleError(executionId, error, callbacks) {
    console.error('Stream error:', error);

    if (callbacks.onError) {
      callbacks.onError({
        error,
        timestamp: Date.now()
      });
    }

    this.showStatus(`Error: ${error}`, 'error');
  }

  handleComplete(executionId, exitCode, callbacks) {
    const fullOutput = this.outputBuffers.get(executionId);

    console.log(`✅ Stream complete. Exit code: ${exitCode}`);

    if (callbacks.onComplete) {
      callbacks.onComplete({
        exitCode,
        fullOutput,
        timestamp: Date.now()
      });
    }

    // Keep buffer for reference
    setTimeout(() => {
      this.outputBuffers.delete(executionId);
    }, 5000);
  }

  // ===== Send Message =====
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ WebSocket not connected');
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  // ===== UI Helpers =====
  showStatus(message, type = 'info') {
    const statusEl = document.getElementById('connection-status');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
  }
}

// ===== USAGE EXAMPLE =====
const client = new StreamingClient('ws://localhost:3000/api/stream');

// Connect
client.connect();

// When you start a command execution, subscribe to it
async function executeCommand(command) {
  const executionId = `exec-${Date.now()}`;

  // 1. Call the server API to execute (with output_id)
  const response = await fetch('/api/shell/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command,
      output_id: executionId  // ← Enable streaming!
    })
  });

  // 2. Subscribe to real-time updates
  client.subscribeToStream(executionId, {
    onOutput: (event) => {
      // Display output in UI
      const outputEl = document.getElementById('output');
      outputEl.textContent += event.data;

      // Auto-scroll
      outputEl.scrollTop = outputEl.scrollHeight;

      // Change color for stderr
      if (event.isStderr) {
        outputEl.style.color = 'red';
      } else {
        outputEl.style.color = 'white';
      }
    },

    onError: (event) => {
      console.error('Error:', event.error);
      const outputEl = document.getElementById('output');
      outputEl.innerHTML += `<span style="color:red">❌ Error: ${event.error}</span>\n`;
    },

    onComplete: (event) => {
      console.log(`✅ Done! Exit code: ${event.exitCode}`);
      const outputEl = document.getElementById('output');
      outputEl.innerHTML += `<span style="color:green">✅ Exit code: ${event.exitCode}</span>`;

      // Show completion time
      document.getElementById('duration').textContent = `Completed in ${new Date().getTime()}ms`;
    }
  });

  return executionId;
}

// Usage
document.getElementById('execute-btn').addEventListener('click', () => {
  const cmd = document.getElementById('command-input').value;
  executeCommand(cmd);
});
```

### **Example 2: SSE Client (JavaScript/Browser)**

```javascript
class SSEStreamingClient {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.eventSources = new Map(); // executionId -> EventSource
    this.callbacks = new Map();     // executionId -> callbacks
    this.outputBuffers = new Map();
    this.clientId = this.generateClientId();
  }

  generateClientId() {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ===== Subscribe to Stream =====
  subscribeToStream(executionId, callbacks) {
    this.callbacks.set(executionId, callbacks);
    this.outputBuffers.set(executionId, '');

    // Create EventSource connection
    const url = `${this.baseUrl}/api/stream/sse/${this.clientId}?execution_id=${executionId}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(executionId, message);
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      if (eventSource.readyState === EventSource.CLOSED) {
        console.error('Connection closed');
        this.eventSources.delete(executionId);
      }
    };

    this.eventSources.set(executionId, eventSource);
    console.log(`✅ Subscribed to SSE stream: ${executionId}`);
  }

  // ===== Handle Messages =====
  handleMessage(executionId, message) {
    const { type, data, isStderr, exitCode, error } = message;
    const callbacks = this.callbacks.get(executionId);

    if (!callbacks) return;

    switch (type) {
      case 'output':
        const buffer = (this.outputBuffers.get(executionId) || '') + data;
        this.outputBuffers.set(executionId, buffer);

        if (callbacks.onOutput) {
          callbacks.onOutput({
            data,
            isStderr,
            fullOutput: buffer
          });
        }
        break;

      case 'complete':
        if (callbacks.onComplete) {
          callbacks.onComplete({
            exitCode,
            fullOutput: this.outputBuffers.get(executionId)
          });
        }

        // Close the connection
        const es = this.eventSources.get(executionId);
        if (es) es.close();
        this.eventSources.delete(executionId);
        break;

      case 'error':
        if (callbacks.onError) {
          callbacks.onError({ error });
        }
        break;
    }
  }

  // ===== Unsubscribe =====
  unsubscribeFromStream(executionId) {
    const es = this.eventSources.get(executionId);
    if (es) {
      es.close();
      this.eventSources.delete(executionId);
    }

    this.callbacks.delete(executionId);
    this.outputBuffers.delete(executionId);
  }
}

// ===== USAGE =====
const sseClient = new SSEStreamingClient('http://localhost:3000');

async function executeCommandSSE(command) {
  const executionId = `exec-${Date.now()}`;

  // Call server API
  await fetch('/api/shell/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command,
      output_id: executionId
    })
  });

  // Subscribe to SSE stream
  sseClient.subscribeToStream(executionId, {
    onOutput: (event) => {
      document.getElementById('output').textContent += event.data;
    },
    onComplete: (event) => {
      console.log('Done!', event.exitCode);
    },
    onError: (event) => {
      console.error('Error:', event.error);
    }
  });
}
```

### **Example 3: React Component**

```jsx
import React, { useEffect, useState, useRef } from 'react';

export function StreamingTerminal() {
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [exitCode, setExitCode] = useState(null);
  const wsRef = useRef(null);
  const executionIdRef = useRef(null);
  const outputRef = useRef(null);

  // ===== Setup WebSocket =====
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3000/api/stream');

    ws.onopen = () => {
      console.log('✅ Connected');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const { type, data, isStderr, exitCode: code } = message;

      switch (type) {
        case 'output':
          setOutput(prev => prev + data);
          break;

        case 'complete':
          setIsExecuting(false);
          setExitCode(code);
          break;

        case 'error':
          setOutput(prev => prev + `❌ Error: ${message.error}\n`);
          break;
      }
    };

    ws.onerror = () => {
      setOutput(prev => prev + '❌ Connection error\n');
    };

    wsRef.current = ws;

    return () => ws.close();
  }, []);

  // ===== Auto-scroll =====
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // ===== Execute Command =====
  const handleExecute = async () => {
    const executionId = `exec-${Date.now()}`;
    executionIdRef.current = executionId;

    setIsExecuting(true);
    setOutput('');
    setExitCode(null);

    // Call API
    try {
      await fetch('/api/shell/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          output_id: executionId
        })
      });

      // Subscribe to updates
      wsRef.current.send(JSON.stringify({
        type: 'subscribe',
        executionId
      }));
    } catch (error) {
      setOutput(prev => prev + `❌ Error: ${error.message}\n`);
      setIsExecuting(false);
    }
  };

  return (
    <div className="terminal">
      <div className="input-section">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter command..."
          disabled={isExecuting}
        />
        <button onClick={handleExecute} disabled={isExecuting}>
          {isExecuting ? '⏳ Executing...' : '▶️ Execute'}
        </button>
      </div>

      <div
        ref={outputRef}
        className="output-section"
        style={{
          background: '#000',
          color: '#0f0',
          fontFamily: 'monospace',
          height: '400px',
          overflow: 'auto',
          padding: '10px',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word'
        }}
      >
        {output}
      </div>

      {exitCode !== null && (
        <div className="status">
          Exit Code: <strong style={{ color: exitCode === 0 ? 'green' : 'red' }}>
            {exitCode}
          </strong>
        </div>
      )}
    </div>
  );
}
```

---

## ✨ BEST PRACTICES

### **1. Connection Management**
```javascript
// ✅ DO: Implement automatic reconnection
client.connect().catch(() => {
  setTimeout(() => client.connect(), 5000);
});

// ❌ DON'T: Give up after first failure
client.connect().catch(() => {
  console.error('Failed to connect');
  // Don't retry
});
```

### **2. Handle Long Outputs**
```javascript
// ✅ DO: Use virtualizing for large outputs
import { FixedSizeList } from 'react-window';

// ✅ DO: Implement pagination
const lines = output.split('\n');
const pageSize = 100;
const displayLines = lines.slice(page * pageSize, (page + 1) * pageSize);

// ❌ DON'T: Add every line to DOM directly
document.getElementById('output').innerHTML += newLine; // Very slow!
```

### **3. Error Handling**
```javascript
// ✅ DO: Handle different error types
if (message.type === 'error') {
  if (message.error.includes('timeout')) {
    // Handle timeout
  } else if (message.error.includes('permission')) {
    // Handle permission denied
  }
}

// ✅ DO: Show errors to user
showToast(`Error: ${error}`, 'error');
```

### **4. Resource Management**
```javascript
// ✅ DO: Clean up subscriptions
onComponentUnmount(() => {
  client.unsubscribeFromStream(executionId);
});

// ✅ DO: Set timeout for stuck streams
setTimeout(() => {
  if (isExecuting) {
    showWarning('Command taking longer than expected');
  }
}, 60000);

// ❌ DON'T: Keep connections open indefinitely
```

### **5. Performance**
```javascript
// ✅ DO: Batch updates
const updates = [];
for (const message of messages) {
  updates.push(message.data);
}
setOutput(prev => prev + updates.join(''));

// ✅ DO: Use refs for frequently changing values
const outputRef = useRef('');

// ❌ DON'T: Update state on every character
setOutput(prev => prev + char); // Too many re-renders!
```

---

## 🔧 TROUBLESHOOTING

### **Problem: Not Receiving Output**

**Causes & Solutions:**
1. **Not subscribed**
   ```javascript
   // Make sure you subscribe BEFORE server response
   client.subscribeToStream(executionId);
   ```

2. **Wrong execution ID**
   ```javascript
   // Match the ID exactly
   // Client: { output_id: 'exec-123' }
   // Server response: { executionId: 'exec-123' }
   ```

3. **Connection not open**
   ```javascript
   // Wait for connection
   await client.connect();
   client.subscribeToStream(executionId);
   ```

### **Problem: Connection Dropping**

**Solutions:**
1. **Implement heartbeat detection**
   ```javascript
   let lastHeartbeat = Date.now();
   ws.onmessage = (e) => {
     if (JSON.parse(e.data).type === 'heartbeat') {
       lastHeartbeat = Date.now();
     }
   };

   setInterval(() => {
     if (Date.now() - lastHeartbeat > 60000) {
       console.error('No heartbeat - reconnecting');
       reconnect();
     }
   }, 10000);
   ```

2. **Exponential backoff for reconnection**
   ```javascript
   let attempts = 0;
   function reconnect() {
     const delay = Math.pow(2, Math.min(attempts++, 10)) * 1000;
     setTimeout(() => client.connect(), delay);
   }
   ```

### **Problem: Memory Leak**

**Solutions:**
1. **Clear buffers after stream ends**
   ```javascript
   onComplete: () => {
     setTimeout(() => {
       buffers.delete(executionId);
       subscriptions.delete(executionId);
     }, 5000);
   }
   ```

2. **Unsubscribe on component unmount**
   ```javascript
   useEffect(() => {
     return () => {
       client.unsubscribeFromStream(executionId);
     };
   }, []);
   ```

---

## 📊 RECOMMENDED CLIENT CHECKLIST

- [ ] Connection management with auto-reconnect
- [ ] Subscription/unsubscription handling
- [ ] Message type routing (output/error/complete/heartbeat)
- [ ] Output buffering for full command result
- [ ] Real-time UI updates (streaming display)
- [ ] Error handling and display
- [ ] Timeout detection (command taking too long)
- [ ] Memory management (cleanup buffers)
- [ ] Performance optimization (no DOM thrashing)
- [ ] Loading/progress indicators
- [ ] Exit code display
- [ ] Copy output to clipboard
- [ ] Clear output button
- [ ] Syntax highlighting for different output types
- [ ] Responsive UI for mobile

---

## 🎯 SUMMARY

### **Server Side (Already Done):**
✅ Real-time streaming infrastructure  
✅ Error handling & timeouts  
✅ WebSocket transport  
✅ SSE transport  
✅ Output emission  

### **Client Side (You Need):**
- Connect to WebSocket/SSE
- Subscribe to execution IDs
- Handle incoming messages
- Display output in real-time
- Handle errors gracefully
- Manage resources properly

### **Key Takeaway:**
The server **PUSHES** data to clients in real-time. The client just needs to listen and display it!

---

**Ready to build your client? Use the examples above as templates!** 🚀
