# ⚡ CLIENT-SIDE QUICK SETUP GUIDE

**TL;DR**: Copy-paste ready client code to get streaming working in minutes!

---

## 🚀 QUICKSTART (5 minutes)

### **Option 1: WebSocket (Recommended)**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Streaming Terminal</title>
  <style>
    body {
      font-family: monospace;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 20px;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    .controls {
      margin-bottom: 20px;
    }
    input {
      width: 70%;
      padding: 10px;
      font-family: monospace;
    }
    button {
      padding: 10px 20px;
      cursor: pointer;
      background: #007acc;
      color: white;
      border: none;
      border-radius: 4px;
    }
    button:hover {
      background: #005a9e;
    }
    button:disabled {
      background: #666;
      cursor: not-allowed;
    }
    .output {
      background: #000;
      border: 1px solid #666;
      padding: 15px;
      height: 400px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      margin-bottom: 10px;
    }
    .status {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .status-indicator.connected {
      background: #4ec9b0;
    }
    .status-indicator.disconnected {
      background: #f48771;
    }
    .stderr {
      color: #f48771;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Real-Time Streaming Terminal</h1>

    <div class="controls">
      <input
        type="text"
        id="commandInput"
        placeholder="Enter command (e.g., 'npm build')"
      />
      <button id="executeBtn">Execute</button>
    </div>

    <div class="status">
      <div id="statusIndicator" class="status-indicator disconnected"></div>
      <span id="statusText">Connecting...</span>
    </div>

    <div id="output" class="output"></div>

    <div>
      <strong>Exit Code:</strong>
      <span id="exitCode">-</span>
    </div>
  </div>

  <script>
    // ===== WEBSOCKET CLIENT =====
    class StreamingClient {
      constructor(url = 'ws://localhost:3000/api/stream') {
        this.url = url;
        this.ws = null;
        this.subscriptions = new Map();
        this.buffers = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
      }

      connect() {
        return new Promise((resolve, reject) => {
          try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
              console.log('✅ Connected');
              this.updateStatus('Connected', true);
              this.reconnectAttempts = 0;
              resolve();
            };

            this.ws.onmessage = (event) => {
              this.handleMessage(JSON.parse(event.data));
            };

            this.ws.onerror = (error) => {
              console.error('❌ Error:', error);
              reject(error);
            };

            this.ws.onclose = () => {
              console.warn('⚠️ Disconnected');
              this.updateStatus('Disconnected', false);
              this.attemptReconnect();
            };
          } catch (error) {
            reject(error);
          }
        });
      }

      attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.updateStatus('Connection failed', false);
          return;
        }

        this.reconnectAttempts++;
        const delay = Math.pow(2, this.reconnectAttempts) * 1000;
        console.log(`⏳ Reconnecting in ${delay}ms...`);

        setTimeout(() => this.connect().catch(() => {}), delay);
      }

      subscribe(executionId, callbacks) {
        this.subscriptions.set(executionId, callbacks);
        this.buffers.set(executionId, '');
        this.send({ type: 'subscribe', executionId });
      }

      unsubscribe(executionId) {
        this.send({ type: 'unsubscribe', executionId });
        this.subscriptions.delete(executionId);
      }

      handleMessage(message) {
        const { type, executionId, data, isStderr, exitCode, error } = message;
        const callbacks = this.subscriptions.get(executionId);

        if (!callbacks) return;

        switch (type) {
          case 'output':
            const buffer = (this.buffers.get(executionId) || '') + data;
            this.buffers.set(executionId, buffer);

            if (callbacks.onOutput) {
              callbacks.onOutput({ data, isStderr, fullOutput: buffer });
            }
            break;

          case 'complete':
            if (callbacks.onComplete) {
              callbacks.onComplete({ exitCode, fullOutput: this.buffers.get(executionId) });
            }
            break;

          case 'error':
            if (callbacks.onError) {
              callbacks.onError({ error });
            }
            break;
        }
      }

      send(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          console.error('WebSocket not connected');
          return;
        }
        this.ws.send(JSON.stringify(message));
      }

      updateStatus(text, connected) {
        const indicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');

        indicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
        statusText.textContent = text;
      }
    }

    // ===== UI =====
    const client = new StreamingClient('ws://localhost:3000/api/stream');
    const outputEl = document.getElementById('output');
    const commandInput = document.getElementById('commandInput');
    const executeBtn = document.getElementById('executeBtn');
    const exitCodeEl = document.getElementById('exitCode');

    // Connect on load
    client.connect().catch(() => {
      console.error('Initial connection failed, will retry...');
    });

    // Execute command
    executeBtn.addEventListener('click', async () => {
      const command = commandInput.value.trim();
      if (!command) return;

      const executionId = `exec-${Date.now()}`;

      // Reset UI
      outputEl.textContent = '';
      exitCodeEl.textContent = '-';
      executeBtn.disabled = true;

      try {
        // Call server API
        const response = await fetch('/api/shell/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command,
            output_id: executionId  // ← KEY for streaming!
          })
        });

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        // Subscribe to real-time updates
        client.subscribe(executionId, {
          onOutput: (event) => {
            // Append to output
            outputEl.textContent += event.data;

            // Change color for stderr
            if (event.isStderr) {
              const lastLine = outputEl.innerHTML.split('<br>').pop();
              outputEl.innerHTML = outputEl.innerHTML.replace(
                lastLine,
                `<span class="stderr">${lastLine}</span>`
              );
            }

            // Auto-scroll
            outputEl.scrollTop = outputEl.scrollHeight;
          },

          onComplete: (event) => {
            outputEl.textContent += `\n✅ Exit code: ${event.exitCode}`;
            exitCodeEl.textContent = event.exitCode;
            executeBtn.disabled = false;

            // Show color based on exit code
            exitCodeEl.style.color = event.exitCode === 0 ? '#4ec9b0' : '#f48771';
          },

          onError: (event) => {
            outputEl.textContent += `\n❌ Error: ${event.error}`;
            executeBtn.disabled = false;
          }
        });
      } catch (error) {
        outputEl.textContent = `❌ Error: ${error.message}`;
        executeBtn.disabled = false;
      }
    });

    // Enter to execute
    commandInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        executeBtn.click();
      }
    });
  </script>
</body>
</html>
```

### **Option 2: React Component**

```jsx
// StreamingTerminal.jsx
import React, { useEffect, useState, useRef } from 'react';

export function StreamingTerminal() {
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [exitCode, setExitCode] = useState(null);
  const wsRef = useRef(null);
  const outputRef = useRef(null);

  // Connect WebSocket
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3000/api/stream');

    ws.onopen = () => {
      setIsConnected(true);
      console.log('✅ Connected');
    };

    ws.onmessage = (event) => {
      const { type, data, isStderr, exitCode: code } = JSON.parse(event.data);

      switch (type) {
        case 'output':
          setOutput(prev => prev + data);
          break;
        case 'complete':
          setIsExecuting(false);
          setExitCode(code);
          break;
        case 'error':
          setOutput(prev => prev + `❌ Error: ${data.error}\n`);
          break;
      }
    };

    ws.onerror = () => setIsConnected(false);
    ws.onclose = () => setIsConnected(false);

    wsRef.current = ws;
    return () => ws.close();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleExecute = async () => {
    const executionId = `exec-${Date.now()}`;
    setIsExecuting(true);
    setOutput('');
    setExitCode(null);

    try {
      await fetch('/api/shell/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, output_id: executionId })
      });

      // Subscribe
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
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>🚀 Real-Time Streaming</h1>

      <div style={{ marginBottom: '10px' }}>
        Status: <span style={{
          color: isConnected ? '#4ec9b0' : '#f48771',
          fontWeight: 'bold'
        }}>
          {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter command..."
          disabled={isExecuting || !isConnected}
          style={{ width: '70%', padding: '8px' }}
          onKeyPress={(e) => e.key === 'Enter' && handleExecute()}
        />
        <button
          onClick={handleExecute}
          disabled={isExecuting || !isConnected}
          style={{ marginLeft: '10px', padding: '8px 16px' }}
        >
          {isExecuting ? '⏳ Executing...' : '▶️ Execute'}
        </button>
      </div>

      <div
        ref={outputRef}
        style={{
          background: '#000',
          color: '#0f0',
          height: '400px',
          border: '1px solid #666',
          padding: '10px',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word'
        }}
      >
        {output}
      </div>

      {exitCode !== null && (
        <div style={{ marginTop: '10px' }}>
          <strong>Exit Code:</strong> <span style={{
            color: exitCode === 0 ? '#4ec9b0' : '#f48771',
            fontWeight: 'bold'
          }}>
            {exitCode}
          </span>
        </div>
      )}
    </div>
  );
}

// Usage:
// <StreamingTerminal />
```

### **Option 3: Vue Component**

```vue
<template>
  <div class="streaming-terminal">
    <h1>🚀 Real-Time Streaming</h1>

    <div class="status">
      Status:
      <span :style="{ color: isConnected ? '#4ec9b0' : '#f48771' }">
        {{ isConnected ? '🟢 Connected' : '🔴 Disconnected' }}
      </span>
    </div>

    <div class="controls">
      <input
        v-model="command"
        placeholder="Enter command..."
        :disabled="isExecuting || !isConnected"
        @keypress.enter="handleExecute"
      />
      <button :disabled="isExecuting || !isConnected" @click="handleExecute">
        {{ isExecuting ? '⏳ Executing...' : '▶️ Execute' }}
      </button>
    </div>

    <div ref="outputRef" class="output">{{ output }}</div>

    <div v-if="exitCode !== null" class="exit-code">
      <strong>Exit Code:</strong>
      <span :style="{ color: exitCode === 0 ? '#4ec9b0' : '#f48771' }">
        {{ exitCode }}
      </span>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      command: '',
      output: '',
      isConnected: false,
      isExecuting: false,
      exitCode: null,
      ws: null
    };
  },

  mounted() {
    this.connectWebSocket();
  },

  beforeUnmount() {
    if (this.ws) this.ws.close();
  },

  methods: {
    connectWebSocket() {
      this.ws = new WebSocket('ws://localhost:3000/api/stream');

      this.ws.onopen = () => {
        this.isConnected = true;
      };

      this.ws.onmessage = (event) => {
        const { type, data, exitCode } = JSON.parse(event.data);

        switch (type) {
          case 'output':
            this.output += data;
            this.$nextTick(() => {
              this.$refs.outputRef.scrollTop = this.$refs.outputRef.scrollHeight;
            });
            break;
          case 'complete':
            this.isExecuting = false;
            this.exitCode = exitCode;
            break;
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
      };
    },

    async handleExecute() {
      const executionId = `exec-${Date.now()}`;
      this.isExecuting = true;
      this.output = '';
      this.exitCode = null;

      await fetch('/api/shell/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: this.command,
          output_id: executionId
        })
      });

      this.ws.send(JSON.stringify({
        type: 'subscribe',
        executionId
      }));
    }
  }
};
</script>

<style scoped>
.streaming-terminal {
  font-family: monospace;
  padding: 20px;
  max-width: 1000px;
}

.status {
  margin-bottom: 15px;
}

.controls {
  margin-bottom: 15px;
}

input {
  width: 70%;
  padding: 8px;
  font-family: monospace;
}

button {
  margin-left: 10px;
  padding: 8px 16px;
  background: #007acc;
  color: white;
  border: none;
  cursor: pointer;
}

button:disabled {
  background: #666;
  cursor: not-allowed;
}

.output {
  background: #000;
  color: #0f0;
  height: 400px;
  border: 1px solid #666;
  padding: 10px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.exit-code {
  margin-top: 10px;
}
</style>
```

---

## 🎯 CLIENT REQUIREMENTS

**Minimum Client Must Have:**
- ✅ WebSocket/SSE connection
- ✅ Subscribe to execution ID
- ✅ Handle output messages
- ✅ Handle complete message
- ✅ Display output in real-time
- ✅ Handle disconnect/reconnect

**Nice to Have:**
- ✅ Auto-reconnect with backoff
- ✅ Multiple concurrent streams
- ✅ Syntax highlighting
- ✅ Copy to clipboard
- ✅ Clear output
- ✅ Command history

---

## ✨ KEY POINTS

1. **Always include `output_id`** in API call
2. **Subscribe IMMEDIATELY** after API response
3. **Use WebSocket** for best experience (recommended)
4. **Fall back to SSE** if WebSocket unavailable
5. **Handle disconnections** gracefully

---

**Copy the code above and you're done!** 🚀
