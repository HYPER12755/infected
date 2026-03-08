# Real-Time Output Streaming in MCP Servers

Complete guide to implementing real-time output streaming in MCP servers, with detailed SDK references.

---

## Table of Contents

1. [Overview](#overview)
2. [MCP SDK Type Definitions](#mcp-sdk-type-definitions)
3. [Architecture & Data Flow](#architecture--data-flow)
4. [Implementation Guide](#implementation-guide)
5. [SDK Notification Method](#sdk-notification-method)
6. [Transport Considerations](#transport-considerations)
7. [Client Integration](#client-integration)
8. [Complete Code Examples](#complete-code-examples)
9. [Troubleshooting](#troubleshooting)
10. [Best Practices](#best-practices)

---

## Overview

Real-time output streaming enables MCP servers to send incremental updates to clients during long-running operations via the `notifications/progress` notification.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **progressToken** | Opaque token from client to correlate progress notifications |
| **notifications/progress** | MCP notification method for progress updates |
| **_meta** | Request metadata containing progressToken |
| **sessionId** | For routing notifications to correct client session |

---

## MCP SDK Type Definitions

### 1. ProgressToken Type

From `@modelcontextprotocol/sdk/dist/cjs/types.d.ts`:

```typescript
/**
 * A progress token, used to associate progress notifications with the original request.
 */
export declare const ProgressTokenSchema: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;

// TypeScript type
type ProgressToken = string | number;
```

### 2. RequestMeta Schema

From `@modelcontextprotocol/sdk/dist/cjs/types.d.ts`:

```typescript
declare const RequestMetaSchema: z.ZodObject<{
    /**
     * If specified, the caller is requesting out-of-band progress notifications 
     * for this request (as represented by notifications/progress).
     * The value of this parameter is an opaque token that will be attached 
     * to any subsequent notifications.
     * The receiver is not obligated to provide these notifications.
     */
    progressToken: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
    
    /**
     * If specified, this request is related to the provided task.
     */
    "io.modelcontextprotocol/related-task": z.ZodOptional<z.ZodObject<{
        taskId: z.ZodString;
    }, z.ZodCoreType>>;
}, z.ZodCoreType>;
```

### 3. RequestHandlerExtra Type

From `@modelcontextprotocol/sdk/dist/cjs/shared/protocol.d.ts`:

```typescript
export type RequestHandlerExtra<SendRequestT extends Request, SendNotificationT extends Notification> = {
    /**
     * An abort signal used to communicate if the request was cancelled from the sender's side.
     */
    signal: AbortSignal;
    
    /**
     * Information about a validated access token, provided to request handlers.
     */
    authInfo?: AuthInfo;
    
    /**
     * The session ID from the transport, if available.
     */
    sessionId?: string;
    
    /**
     * Metadata from the original request.
     * Contains progressToken when client requests streaming.
     */
    _meta?: RequestMeta;
    
    /**
     * The JSON-RPC ID of the request being handled.
     */
    requestId: RequestId;
    
    /**
     * Task ID if this is a task request
     */
    taskId?: string;
    
    /**
     * The original HTTP request.
     */
    requestInfo?: RequestInfo;
};
```

### 4. ProgressNotificationParams Interface

From `@modelcontextprotocol/sdk/dist/cjs/spec.types.d.ts`:

```typescript
/**
 * Parameters for a `notifications/progress` notification.
 *
 * @category `notifications/progress`
 */
export interface ProgressNotificationParams extends NotificationParams {
    /**
     * The progress token which was given in the initial request, 
     * used to associate this notification with the request that is proceeding.
     */
    progressToken: ProgressToken;
    
    /**
     * The progress thus far. This should increase every time progress is made, 
     * even if the total is unknown.
     *
     * @TJS-type number
     */
    progress: number;
    
    /**
     * Total number of items to process (or total progress required), if known.
     *
     * @TJS-type number
     */
    total?: number;
    
    /**
     * An optional message describing the current progress.
     */
    message?: string;
}
```

### 5. ProgressNotification Interface

From `@modelcontextprotocol/sdk/dist/cjs/spec.types.d.ts`:

```typescript
/**
 * An out-of-band notification used to inform the receiver of a progress update 
 * for a long-running request.
 *
 * @category `notifications/progress`
 */
export interface ProgressNotification extends JSONRPCNotification {
    method: "notifications/progress";
    params: ProgressNotificationParams;
}
```

### 6. CallToolRequest Schema

From `@modelcontextprotocol/sdk/dist/cjs/types.d.ts`:

```typescript
export declare const CallToolRequestSchema: z.ZodObject<{
    method: z.ZodLiteral<"tools/call">;
    params: z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications
             * for this request (as represented by notifications/progress).
             */
            progressToken: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
            "io.modelcontextprotocol/related-task": z.ZodOptional<z.ZodObject<{...}>>;
        }, z.ZodCoreType>>;
        
        name: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.ZodCoreType>;
}, z.ZodCoreType>;
```

---

## Architecture & Data Flow

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                          │
│                                                                              │
│  1. Send request with _meta.progressToken                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ {                                                                     │    │
│  │   "method": "tools/call",                                            │    │
│  │   "params": {                                                         │    │
│  │     "name": "shell_execute",                                         │    │
│  │     "arguments": { "command": "npm run build" },                    │    │
│  │     "_meta": { "progressToken": "token-123" }  ← Client provides    │    │
│  │   }                                                                   │    │
│  │ }                                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER                                          │
│                                                                              │
│  2. Tool Handler receives request                                           │
│     async (rawArgs, extra: ToolRequestExtra) => {                          │
│       const progressToken = extra._meta?.progressToken;  ← Extract token    │
│       const sessionId = extra.sessionId;              ← Extract session   │
│     }                                                                       │
│                                                                              │
│  3. Store execution context for callbacks                                   │
│     executionContexts.set(executionId, { progressToken, sessionId });       │
│                                                                              │
│  4. Start long-running operation                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CALLBACK SYSTEM                                      │
│                                                                              │
│  5. When output data is available:                                         │
│     onOutputData: async (executionId, data, isStderr) => {                 │
│                                                                              │
│       const context = executionContexts.get(executionId);                  │
│       const progressToken = context?.progressToken;                         │
│                                                                              │
│       // Send notification with progressToken                               │
│       await server.notification({                                          │
│         method: "notifications/progress",                                  │
│         params: {                                                           │
│           progressToken: progressToken,  ← MUST include!                    │
│           progress: currentBytes,                                           │
│           total: estimatedTotal,                                             │
│           message: data,                                                     │
│         }                                                                   │
│       });                                                                   │
│     }                                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                          │
│                                                                              │
│  6. Receive progress notification                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ {                                                                     │    │
│  │   "method": "notifications/progress",                                │    │
│  │   "params": {                                                         │    │
│  │     "progressToken": "token-123",  ← Matches original request!      │    │
│  │     "progress": 1024,                                                │    │
│  │     "total": 4096,                                                   │    │
│  │     "message": "Compiling..."                                        │    │
│  │   }                                                                   │    │
│  │ }                                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Guide

### Step 1: Define Types

```typescript
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';

// Define tool request extra type
type ToolRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// Execution context for storing progress info
interface ExecutionContext {
  progressToken?: string | number;
  sessionId?: string;
  // Add other context as needed
}
```

### Step 2: Create Execution Context Storage

```typescript
export class YourModule implements Module {
  name = 'your-module';
  
  // Map executionId to context for progress streaming
  private executionContexts = new Map<string, ExecutionContext>();
  
  // ... rest of module
}
```

### Step 3: Extract Token in Tool Handler

```typescript
// In your tool registration
server.registerTool(
  'your_tool',
  {
    title: 'Your Tool',
    description: 'Description with streaming support mention',
    inputSchema: YourInputSchema.shape,
  },
  async (rawArgs: unknown, extra: ToolRequestExtra) => {
    // ✅ CORRECT: Extract progressToken and sessionId from extra
    const progressToken = extra._meta?.progressToken;
    const sessionId = extra.sessionId;
    
    // ❌ WRONG: Ignoring the extra parameter
    // async (rawArgs: unknown, _extra: ToolRequestExtra) => { ... }
    
    // Parse arguments
    const args = YourSchema.parse(rawArgs);
    
    // Start operation
    const executionId = await startLongRunningOperation(args);
    
    // Store context for progress callbacks
    this.executionContexts.set(executionId, {
      progressToken,
      sessionId,
    });
    
    // Return initial result (streaming continues via notifications)
    return { content: [{ type: 'text', text: 'Operation started...' }] };
  }
);
```

### Step 4: Send Progress Notifications

```typescript
// In your callback or async operation
async function sendProgressUpdate(
  executionId: string,
  data: string,
  isStderr: boolean = false,
  currentProgress?: number,
  totalProgress?: number
): Promise<void> {
  // Get stored context
  const context = this.executionContexts.get(executionId);
  const progressToken = context?.progressToken;
  
  // Build notification params
  const params: Record<string, unknown> = {
    // For custom output streaming (like shell stdout/stderr)
    execution_id: executionId,
    type: isStderr ? 'stderr' : 'stdout',
    data: data,
  };
  
  // For standard MCP progress (recommended)
  // params.progress = currentProgress ?? 0;
  // params.total = totalProgress;
  // params.message = data;
  
  // ✅ CRITICAL: Include progressToken from client request
  if (progressToken !== undefined) {
    params.progressToken = progressToken;
  }
  
  // Send notification
  // Using MCP SDK's notification method
  await this.serverInstance.server.notification({
    method: 'notifications/progress',
    params: params as any, // Type may need casting for custom params
  });
}
```

### Step 5: Clean Up on Completion

```typescript
// Always clean up to prevent memory leaks
async function onComplete(executionId: string): Promise<void> {
  const context = this.executionContexts.get(executionId);
  
  // Send completion notification
  await this.serverInstance.server.notification({
    method: 'notifications/message',
    params: {
      level: 'info',
      data: 'Operation completed',
      execution_id: executionId,
      progressToken: context?.progressToken,
    },
  });
  
  // ✅ Clean up execution context
  this.executionContexts.delete(executionId);
}

async function onError(executionId: string, error: Error): Promise<void> {
  // Send error notification
  // ... include progressToken ...
  
  // ✅ Clean up execution context
  this.executionContexts.delete(executionId);
}

async function onTimeout(executionId: string): Promise<void> {
  // Send timeout notification
  // ... include progressToken ...
  
  // ✅ Clean up execution context
  this.executionContexts.delete(executionId);
}
```

---

## SDK Notification Method

### From `@modelcontextprotocol/sdk/dist/cjs/shared/protocol.js`:

```javascript
/**
 * Emits a notification, which is a one-way message that does not expect a response.
 */
async notification(notification, options) {
    if (!this._transport) {
        throw new Error('Not connected');
    }
    this.assertNotificationCapability(notification.method);
    
    // Queue notification if related to a task
    const relatedTaskId = options?.relatedTask?.taskId;
    if (relatedTaskId) {
        // Build the JSONRPC notification with metadata
        const jsonrpcNotification = {
            ...notification,
            jsonrpc: '2.0',
            params: {
                ...notification.params,
                _meta: {
                    ...(notification.params?._meta || {}),
                    [types_js_1.RELATED_TASK_META_KEY]: options.relatedTask
                }
            }
        };
        await this._enqueueTaskMessage(relatedTaskId, {
            type: 'notification',
            message: jsonrpcNotification,
            timestamp: Date.now()
        });
        // Don't send through transport - queued messages delivered via tasks/result
    }
    // ... rest of method
}
```

### Usage from McpServer:

```typescript
// McpServer exposes the underlying Server via .server property
const mcpServer: McpServer = new McpServer({ name: 'MyServer', version: '1.0.0' });

// Send notification via the underlying server
await mcpServer.server.notification({
  method: 'notifications/progress',
  params: {
    progressToken: 'token-123',
    progress: 50,
    total: 100,
    message: 'Processing...'
  }
});
```

### Key Notes:

1. **No response expected** - Notifications are one-way messages
2. **Capability checks** - Server validates notification method capability
3. **Task queuing** - Notifications can be queued for task-based delivery
4. **Session routing** - Some transports use sessionId for routing

---

## Transport Considerations

### HTTP Transport (Streamable HTTP) - RECOMMENDED

From `@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js`:

```typescript
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
  onsessioninitialized: (sessionId) => {
    // Session created
  },
});

await transport.connect();
await server.run(transport);
```

**Features:**
- ✅ Native progressToken support
- ✅ Session-based routing
- ✅ HTTP/1.1 and HTTP/2 compatible
- ✅ Recommended by MCP spec

### SSE Transport

From `@modelcontextprotocol/sdk/dist/cjs/server/sse.js`:

```typescript
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

app.get('/mcp/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const transport = new SSEServerTransport('/mcp/messages', res);
  // Stream events to client
});
```

### WebSocket Transport

Custom implementation (see `src/transports/websocket.ts`):
- True bidirectional
- Low latency
- More complex setup

---

## Client Integration

### Sending Request with Progress Token

**JSON-RPC Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "shell_execute",
    "arguments": {
      "command": "npm run build",
      "executionMode": "foreground"
    },
    "_meta": {
      "progressToken": "unique-token-123"
    }
  }
}
```

### Receiving Progress Notifications

**Progress Notification:**

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "unique-token-123",
    "progress": 1024,
    "total": 4096,
    "message": "Compiling project..."
  }
}
```

### Custom Progress Format (Shell Output)

If using custom format like Infected:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "unique-token-123",
    "execution_id": "exec-456",
    "type": "stdout",
    "data": "Compiling TypeScript files..."
  }
}
```

---

## Complete Code Examples

### Example 1: Shell Module Implementation

File: `src/modules/shell/index.ts`

Key sections:
- Lines 344-358: Execution context storage
- Lines 468-490: Extract and store progressToken
- Lines 361-453: Callback system with progress notifications

### Example 2: Custom Tool with Streaming

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

class StreamingModule {
  private server!: McpServer;
  private contexts = new Map<string, { progressToken?: string | number }>();
  
  register(server: McpServer) {
    this.server = server;
    
    server.registerTool(
      'long_running_task',
      {
        title: 'Long Running Task',
        description: 'A task that streams progress updates',
        inputSchema: { 
          type: 'object', 
          properties: { 
            taskId: { type: 'string' } 
          } 
        },
      },
      async (rawArgs, extra) => {
        const args = rawArgs as { taskId: string };
        
        // Extract progressToken from request
        const progressToken = extra._meta?.progressToken;
        
        // Store for callbacks
        const executionId = `exec-${Date.now()}`;
        this.contexts.set(executionId, { progressToken });
        
        // Start async operation
        this.runTask(args.taskId, executionId);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Task started with ID: ${executionId}` 
          }],
        };
      }
    );
  }
  
  private async runTask(taskId: string, executionId: string) {
    const context = this.contexts.get(executionId);
    const totalSteps = 10;
    
    for (let i = 0; i <= totalSteps; i++) {
      // Simulate work
      await new Promise(r => setTimeout(r, 500));
      
      // Send progress notification
      await this.server.server.notification({
        method: 'notifications/progress',
        params: {
          progressToken: context?.progressToken,
          progress: i,
          total: totalSteps,
          message: `Step ${i}/${totalSteps} complete`
        }
      });
    }
    
    // Clean up
    this.contexts.delete(executionId);
  }
}
```

---

## Troubleshooting

### Issue: progressToken is undefined

**Cause:** Client didn't include `_meta.progressToken` in request

**Solution:** 
- Make progressToken optional (don't require it)
- Check client implementation

```typescript
// Handle both cases
const progressToken = extra._meta?.progressToken;
if (progressToken) {
  // Client wants progress updates
}
```

### Issue: Notifications not reaching client

**Possible causes:**
1. Transport doesn't support streaming
2. Missing progressToken in notification params
3. Session routing issues

**Solution:**

```typescript
// Always include progressToken if available
const params: Record<string, unknown = { ... };
if (progressToken !== undefined) {
  params.progressToken = progressToken;
}
await server.notification({ method: 'notifications/progress', params });
```

### Issue: Memory leak from execution contexts

**Cause:** Not cleaning up execution contexts

**Solution:** Always delete in all completion handlers:

```typescript
// Clean up in ALL completion paths
onComplete: () => this.contexts.delete(id),
onError: () => this.contexts.delete(id),
onTimeout: () => this.contexts.delete(id),
```

### Issue: TypeScript errors with notification

**Cause:** Incorrect notification signature

**Solution:**

```typescript
// Use correct method signature
await server.notification({
  method: 'notifications/progress',
  params: {
    progressToken: token,
    progress: current,
    total: max,
    message: 'status'
  }
});
```

---

## Best Practices

1. **Always include progressToken** when provided by client
2. **Make progressToken optional** - not all clients support streaming
3. **Clean up contexts** on complete/error/timeout
4. **Use TypeScript** for type safety
5. **Log progress** for debugging
6. **Handle errors gracefully** with cleanup
7. **Use standard progress format** when possible (progress/total/message)
8. **Support custom formats** for domain-specific needs (like shell stdout/stderr)

---

## SDK Reference Summary

| Type/Interface | Location | Purpose |
|----------------|----------|---------|
| `ProgressToken` | `types.d.ts` | `string \| number` token type |
| `RequestMeta` | `types.d.ts` | Contains progressToken |
| `RequestHandlerExtra` | `shared/protocol.d.ts` | Handler extra param with _meta |
| `ProgressNotificationParams` | `spec.types.d.ts` | Progress notification params |
| `ProgressNotification` | `spec.types.d.ts` | Full notification type |
| `CallToolRequestSchema` | `types.d.ts` | Client request with _meta |
| `Server.notification()` | `shared/protocol.js` | Send notifications |

---

## Files Reference

- **Infected Shell Module**: `src/modules/shell/index.ts`
- **Infected HTTP Transport**: `src/transports/http.ts`
- **Infected WebSocket Transport**: `src/transports/websocket.ts`
- **MCP SDK Types**: `@modelcontextprotocol/sdk/dist/cjs/types.d.ts`
- **MCP SDK Spec Types**: `@modelcontextprotocol/sdk/dist/cjs/spec.types.d.ts`
- **MCP SDK Protocol**: `@modelcontextprotocol/sdk/dist/cjs/shared/protocol.js`

---

## Summary

| Step | Action | Key Code |
|------|--------|----------|
| 1 | Define context storage | `contexts = new Map()` |
| 2 | Extract from request | `extra._meta?.progressToken` |
| 3 | Store with execution | `contexts.set(id, {progressToken})` |
| 4 | Send with token | `params.progressToken = token` |
| 5 | Clean up | `contexts.delete(id)` |

Following these steps ensures proper MCP-compliant real-time streaming implementation.
