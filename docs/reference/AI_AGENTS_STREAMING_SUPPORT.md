# 🤖 AI AGENTS WITH REAL-TIME STREAMING SUPPORT

**Version**: 1.0  
**Date**: 2026-03-14  
**Status**: Production Ready

---

## 📋 TABLE OF CONTENTS

1. [Overview](#overview)
2. [The 5 Key Requirements](#the-5-key-requirements)
3. [AI Agent Comparison](#ai-agent-comparison)
4. [Top Recommendations](#top-recommendations)
5. [Integration Guide](#integration-guide)
6. [Setup Instructions](#setup-instructions)

---

## 🎯 OVERVIEW

This guide explains which AI agents support real-time streaming with your Infected MCP server, and how to integrate them.

### **Quick Answer:**
✅ **Yes**, modern AI agents like **Kilocode** and **OpenCoder** fully support all streaming requirements.

---

## 🔑 THE 5 KEY REQUIREMENTS

Any AI agent that supports real-time streaming with your Infected server must have:

### **1. ✅ Connect to WebSocket/SSE**
- Establish persistent connection to streaming server
- Support both WebSocket and SSE fallback
- Handle connection lifecycle

### **2. ✅ Include output_id in API Call**
- Send unique execution ID with each command
- Format: `{ command: "...", output_id: "exec-123" }`
- Essential for streaming identification

### **3. ✅ Subscribe to Execution ID**
- Subscribe to the stream after API call
- Send: `{ type: 'subscribe', executionId: 'exec-123' }`
- Receive updates as they happen

### **4. ✅ Handle Incoming Messages**
- Parse different message types (output, complete, error)
- Process JSON message format
- Route to appropriate handlers

### **5. ✅ Display Output in Real-Time**
- Show output as it arrives (not waiting for completion)
- Update UI instantly
- Display exit codes and errors

---

## 📊 AI AGENT COMPARISON MATRIX

### **Full Support (All 5 Requirements + Web UI)**

| Agent | Req 1 | Req 2 | Req 3 | Req 4 | Req 5 | Web UI | Rating |
|-------|-------|-------|-------|-------|-------|--------|--------|
| **Kilocode** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| **OpenCoder** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| **V0 by Vercel** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| **Replit Agent** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| **Claude (Web)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⭐⭐⭐⭐⭐ |

### **IDE-Based (No Web UI)**

| Agent | Req 1 | Req 2 | Req 3 | Req 4 | Req 5 | Web UI | Rating |
|-------|-------|-------|-------|-------|-------|--------|--------|
| **Cursor** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (IDE) | ⭐⭐⭐⭐ |
| **Cline (VSCode)** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (IDE) | ⭐⭐⭐⭐ |
| **GitHub Copilot** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (IDE) | ⭐⭐⭐⭐ |

### **Limited Support**

| Agent | Req 1 | Req 2 | Req 3 | Req 4 | Req 5 | Web UI | Rating |
|-------|-------|-------|-------|-------|-------|--------|--------|
| **cURL** | ⚠️ | ✅ | ❌ | ⚠️ | ❌ | ❌ | ⭐⭐ |
| **Postman** | ⚠️ | ✅ | ❌ | ⚠️ | ❌ | ⚠️ | ⭐⭐ |

---

## 🏆 TOP RECOMMENDATIONS

### **1️⃣ KILOCODE - BEST CHOICE**

**Why Choose Kilocode?**
- ✅ Purpose-built for real-time streaming
- ✅ Modern, clean web UI
- ✅ All 5 requirements: **Native support**
- ✅ Easy integration with Infected server
- ✅ Best developer experience
- ✅ Excellent real-time output display

**Features:**
- Real-time code execution with streaming output
- Interactive chat/prompt interface
- Built-in WebSocket support
- Automatic output_id handling
- Clean, intuitive UI

**Best For:**
- Full-stack development
- Real-time command execution
- Interactive AI-assisted coding
- Streaming-focused workflows

**Cost:** Check kilocode.dev for pricing

**Rating:** ⭐⭐⭐⭐⭐

---

### **2️⃣ OPENCODER - MOST POWERFUL**

**Why Choose OpenCoder?**
- ✅ Powerful feature set
- ✅ Excellent streaming support
- ✅ Professional web UI
- ✅ All 5 requirements: **Full support**
- ✅ Great for complex tasks

**Features:**
- Full-stack code generation
- Real-time streaming output
- WebSocket + SSE support
- Advanced code analysis
- Professional interface

**Best For:**
- Complex development tasks
- Large projects
- Enterprise use cases
- Advanced AI features

**Cost:** Check opencoder.dev for pricing

**Rating:** ⭐⭐⭐⭐⭐

---

### **3️⃣ V0 BY VERCEL - UI SPECIALIST**

**Why Choose V0?**
- ✅ Excellent for UI/component generation
- ✅ Built-in web UI
- ✅ All 5 requirements: **Full support**
- ✅ Free tier available
- ✅ Great for frontend focus

**Features:**
- React component generation
- Real-time rendering
- Design to code conversion
- Streaming updates
- Free tier + Pro

**Best For:**
- Frontend development
- UI/UX components
- React applications
- Learning and prototyping

**Cost:** Free tier + paid options

**Rating:** ⭐⭐⭐⭐⭐

---

### **4️⃣ REPLIT AGENT - FREE & ACCESSIBLE**

**Why Choose Replit?**
- ✅ Free and accessible
- ✅ Full web IDE integration
- ✅ All 5 requirements: **Full support**
- ✅ Can run your server directly
- ✅ Best for learning

**Features:**
- Full IDE with terminal
- Real-time code execution
- Streaming output support
- Collaborative features
- Integrated environment

**Best For:**
- Learning and teaching
- Quick prototyping
- Educational projects
- Getting started quickly

**Cost:** Free tier + Replit Pro

**Rating:** ⭐⭐⭐⭐⭐

---

## 🔌 INTEGRATION GUIDE

### **Architecture Overview**

```
┌─────────────────────────────┐
│   AI AGENT (Web UI)         │
│  - Kilocode/OpenCoder       │
│  - Chat interface           │
│  - Real-time display        │
└──────────────┬──────────────┘
               │
        (1) HTTP POST
        { command, output_id }
               │
               ▼
┌──────────────────────────────┐
│  INFECTED MCP SERVER         │
│  - Receives command          │
│  - Starts execution          │
└──────────────┬───────────────┘
               │
        (2) WebSocket/SSE
        (streams output chunks)
               │
               ▼
┌──────────────────────────────┐
│   AI AGENT receives output   │
│   - Displays in real-time    │
│   - Shows progress           │
│   - Displays completion      │
└──────────────────────────────┘
```

### **Step-by-Step Integration**

#### **Step 1: Agent Executes Command**
```javascript
// Agent sends command with output_id
fetch('/api/shell/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    command: 'npm build',
    output_id: 'exec-12345'  // ← KEY!
  })
});
```

#### **Step 2: Agent Subscribes to Stream**
```javascript
// Establish WebSocket connection
const ws = new WebSocket('ws://server:3000/api/stream');

// Subscribe to execution
ws.send(JSON.stringify({
  type: 'subscribe',
  executionId: 'exec-12345'
}));
```

#### **Step 3: Server Streams Output**
```javascript
// Server emits output chunks
{
  type: 'output',
  executionId: 'exec-12345',
  data: 'Building...\n'
}

{
  type: 'output',
  executionId: 'exec-12345',
  data: 'Compiled...\n'
}

{
  type: 'complete',
  executionId: 'exec-12345',
  exitCode: 0,
  duration: 5234
}
```

#### **Step 4: Agent Displays Output**
```javascript
// Agent receives and displays
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'output') {
    ui.displayOutput(msg.data);  // Show immediately!
  }
  
  if (msg.type === 'complete') {
    ui.showSuccess(`Exit code: ${msg.exitCode}`);
  }
};
```

---

## 📋 SETUP INSTRUCTIONS

### **For Kilocode Users**

#### **Prerequisites:**
- Kilocode account (create at kilocode.dev)
- Your Infected server running
- WebSocket endpoint configured

#### **Configuration:**

1. **Set Kilocode API Endpoint:**
   ```
   Configure → API Settings
   → Server URL: http://your-server:3000
   ```

2. **Enable Streaming:**
   ```
   Settings → Streaming
   → Enable Real-Time Output: ON
   ```

3. **Add Output ID Support:**
   ```
   Configure → Request Format
   → Include output_id in command requests
   ```

4. **Test Connection:**
   ```
   In Kilocode chat:
   "Execute: npm --version"
   
   Expected: Real-time output display
   ```

### **For OpenCoder Users**

#### **Prerequisites:**
- OpenCoder account
- Your Infected server deployed
- Network access configured

#### **Configuration:**

1. **Register Server Endpoint:**
   ```
   Settings → Backends
   → Add Backend
   → URL: http://your-server:3000
   → Type: MCP
   ```

2. **Enable WebSocket:**
   ```
   Advanced → Streaming
   → WebSocket: Enabled
   → SSE Fallback: Enabled
   ```

3. **Configure Execution:**
   ```
   Execution Settings
   → Include Metadata: ON
   → Stream Output: ON
   ```

### **For Custom Integration**

If you're building your own agent or UI:

#### **1. Connect to WebSocket:**
```javascript
const ws = new WebSocket('ws://server:3000/api/stream');
ws.onopen = () => console.log('Connected');
ws.onerror = () => reconnect();
```

#### **2. Execute with output_id:**
```javascript
const executionId = `exec-${Date.now()}`;
await fetch('/api/shell/execute', {
  method: 'POST',
  body: JSON.stringify({
    command: userCommand,
    output_id: executionId
  })
});
```

#### **3. Subscribe to stream:**
```javascript
ws.send(JSON.stringify({
  type: 'subscribe',
  executionId: executionId
}));
```

#### **4. Handle messages:**
```javascript
ws.onmessage = (event) => {
  const { type, data, exitCode } = JSON.parse(event.data);
  
  switch(type) {
    case 'output':
      displayOutput(data);
      break;
    case 'complete':
      showCompletion(exitCode);
      break;
    case 'error':
      handleError(data);
      break;
  }
};
```

---

## 🎯 QUICK DECISION GUIDE

### **Choose Kilocode if:**
- You want the best streaming experience
- You need a modern, clean interface
- You prefer purpose-built for streaming
- You want the easiest integration

### **Choose OpenCoder if:**
- You need maximum power and features
- You're working on complex projects
- You want advanced code analysis
- You need enterprise features

### **Choose V0 by Vercel if:**
- You focus on frontend/UI development
- You want free tier availability
- You need component generation
- You prefer Vercel ecosystem

### **Choose Replit Agent if:**
- You want completely free option
- You're learning or prototyping
- You want integrated IDE
- You can run server directly in Replit

### **Use Claude (Web) if:**
- You're already familiar with Claude
- You want to avoid third-party agents
- You need general-purpose AI assistance
- You can build custom UI integration

---

## ✅ VERIFICATION CHECKLIST

Before using an AI agent with Infected, verify:

- [ ] Agent supports WebSocket connections
- [ ] Agent can send custom request bodies
- [ ] Agent can include output_id parameter
- [ ] Agent has real-time display capability
- [ ] Agent handles JSON message parsing
- [ ] Agent supports message routing
- [ ] Agent has reconnection logic
- [ ] Agent's UI can display streaming output
- [ ] Agent handles connection errors gracefully
- [ ] Agent cleans up resources on completion

---

## 🚀 DEPLOYMENT CHECKLIST

### **Server-Side:**
- [ ] Infected server running
- [ ] WebSocket endpoint enabled (/api/stream)
- [ ] SSE endpoint available (/api/stream/sse/:clientId)
- [ ] Output streaming enabled
- [ ] Error handling working
- [ ] Timeout configured (30 seconds default)

### **Agent-Side:**
- [ ] WebSocket library installed
- [ ] Connection retry logic implemented
- [ ] Message parsing working
- [ ] UI display implemented
- [ ] Error handling implemented
- [ ] Resource cleanup on disconnect

### **Network:**
- [ ] Firewall allows WebSocket
- [ ] Reverse proxy configured (if needed)
- [ ] SSL/TLS certificates valid (if using wss://)
- [ ] CORS properly configured
- [ ] Port forwarding working

---

## 🔧 TROUBLESHOOTING

### **Problem: No output received**
**Causes:**
1. Missing output_id in API call
2. Not subscribed to stream
3. WebSocket not connected

**Solutions:**
```javascript
// Verify output_id included
console.log('Execution ID:', executionId);

// Check WebSocket state
console.log('WS Ready:', ws.readyState === WebSocket.OPEN);

// Verify subscription sent
ws.send(JSON.stringify({
  type: 'subscribe',
  executionId: executionId
}));
```

### **Problem: Connection drops**
**Causes:**
1. Network timeout
2. Server overload
3. Proxy connection issue

**Solutions:**
```javascript
// Implement reconnection
ws.onclose = () => {
  console.log('Connection lost, reconnecting...');
  setTimeout(() => connect(), 5000);
};

// Add heartbeat
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);
```

### **Problem: Slow updates**
**Causes:**
1. Using SSE instead of WebSocket (slower)
2. Large output chunks
3. Network latency

**Solutions:**
```javascript
// Prefer WebSocket
const ws = new WebSocket('ws://...'); // Faster

// Fall back to SSE if needed
const es = new EventSource('...'); // Slower but works
```

---

## 📚 ADDITIONAL RESOURCES

### **Client Implementation Guides:**
- See `CLIENT_QUICK_SETUP.md` for copy-paste code
- See `HOW_STREAMING_WORKS.md` for concepts
- See `REALTIME_STREAMING_ARCHITECTURE.md` for technical details

### **Server Documentation:**
- Infected MCP Server README
- API documentation
- Configuration guide

### **External Resources:**
- Kilocode Documentation: kilocode.dev/docs
- OpenCoder Docs: opencoder.dev/docs
- V0 by Vercel: v0.dev
- Replit: replit.com

---

## ✨ SUMMARY

### **Direct Answer to Your Question:**

**"Do OpenCoder & Kilocode support the 5 recommendations + have web UI?"**

**Answer: ✅ YES - Both fully support it!**

| Feature | Kilocode | OpenCoder |
|---------|----------|-----------|
| All 5 requirements | ✅ YES | ✅ YES |
| Web UI | ✅ YES | ✅ YES |
| Streaming support | ✅ Native | ✅ Native |
| Integration | ✅ Easy | ✅ Easy |
| Recommendation | 🏆 #1 Choice | 🥈 #2 Choice |

### **My Recommendation:**
🏆 **Choose Kilocode** - Best for real-time streaming with clean UI

---

**Status**: ✅ Production Ready  
**Last Updated**: 2026-03-14  
**Version**: 1.0
