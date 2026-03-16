# Streaming Implementation Integration Patches

This document shows step-by-step how to integrate real-time streaming into the existing Shell and SSH modules.

## Patch 1: Add EnhancedShellTool to Shell Module

**File**: `src/modules/shell/index.ts`

**Change 1: Add imports**

```typescript
// Add to imports section
import { EnhancedShellTool, shellStreamingToolDefinition } from '../../enhanced-shell-tool.js';
```

**Change 2: Add streaming tool instance**

```typescript
export class ShellModule implements Module {
  private shellTools: ShellTools;
  private streamingShellTool: EnhancedShellTool;  // ← ADD THIS
  
  // ... existing code ...
```

**Change 3: Initialize in register method**

```typescript
async register(server: McpServer, config: InfectedConfig, managers: ManagerInstances): Promise<void> {
  logger.info(`  ShellModule: Registering...`);

  // Initialize streaming shell tool
  this.streamingShellTool = new EnhancedShellTool({
    enabled: process.env.MCP_SHELL_ENABLE_STREAMING !== 'false',
    bufferSize: 8192,
    maxOutputSize: 10 * 1024 * 1024,
    updateInterval: 100,
  });

  // Register streaming tool
  this.deregisterFunctions.push(
    server.registerTool(
      'shell_execute_streaming',
      {
        title: 'Execute Shell Command with Real-Time Streaming',
        description: 'Execute shell command with real-time output streaming support',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Shell command to execute',
            },
            workingDirectory: {
              type: 'string',
              description: 'Working directory for command',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
            },
            streamingEnabled: {
              type: 'boolean',
              description: 'Enable real-time streaming',
            },
          },
          required: ['command'],
        },
      },
      async (args: unknown) => {
        try {
          const result = await this.streamingShellTool.executeWithStreaming(args as any);
          return {
            content: result.content,
            structuredContent: {
              executionId: result.executionId,
              isStreaming: result.isStreaming,
            },
          };
        } catch (error) {
          logger.error(`Streaming shell execution failed: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      }
    )
  );

  logger.info('  ShellModule: shell_execute_streaming tool registered.');

  // ... rest of existing registration code ...
}
```

**Change 4: Add cleanup in shutdown**

```typescript
async shutdown(): Promise<void> {
  logger.info('  ShellModule: Shutting down, deregistering tools...');
  this.deregisterFunctions.forEach((deregister) => {
    if (typeof deregister === 'function') {
      deregister();
    } else if (deregister && typeof deregister.remove === 'function') {
      deregister.remove();
    }
  });
  this.deregisterFunctions = [];
  
  // Cleanup streaming tool sessions
  if (this.streamingShellTool) {
    // Cancel any running executions
    logger.info('  ShellModule: Cleaning up streaming tool sessions.');
  }
  
  this.executionContexts.clear();
  logger.info('  ShellModule: All tools deregistered.');
}
```

## Patch 2: Add EnhancedSSHTool to SSH Module

**File**: `src/modules/ssh/index.ts`

**Change 1: Add imports**

```typescript
// Add to imports section
import { EnhancedSSHTool, sshStreamingTools } from '../../enhanced-ssh-tool.js';
```

**Change 2: Add streaming tool instance**

```typescript
export default class SshModule implements IUnifiedPlugin {
  public manifest: UnifiedModuleManifest = { /* ... */ };
  
  private sessions = new Map<string, TerminalSession>();
  private deregisterFns: Array<() => void> = [];
  private streamingSSHTool: EnhancedSSHTool;  // ← ADD THIS

  // ... existing code ...
```

**Change 3: Initialize in onLoad method**

```typescript
async onLoad(context: UnifiedModuleContext): Promise<void> {
  // Initialize streaming SSH tool
  this.streamingSSHTool = new EnhancedSSHTool({
    enabled: process.env.MCP_SSH_ENABLE_STREAMING !== 'false',
    updateInterval: 100,
    maxOutputSize: 50 * 1024 * 1024,
    defaultTimeout: 600,
  });

  // Register streaming SSH tools
  sshStreamingTools.forEach((toolDef) => {
    const deregister = context.moduleManager.registerToolExecution(
      toolDef.name,
      async (args: any) => {
        try {
          if (toolDef.name === 'ssh_create_session') {
            return await this.streamingSSHTool.createSession(args);
          } else if (toolDef.name === 'ssh_execute_streaming') {
            return await this.streamingSSHTool.executeWithStreaming(args);
          } else if (toolDef.name === 'ssh_close_session') {
            return await this.streamingSSHTool.closeSession(args.sessionId);
          }
        } catch (error) {
          context.logger.error(`SSH streaming tool error: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      },
      toolDef.name,
      toolDef.description
    );

    if (deregister) {
      this.deregisterFns.push(() => deregister());
    }
  });

  context.logger.info('SSH streaming tools registered.');

  // ... rest of existing onLoad code ...
}
```

**Change 4: Update onUnload**

```typescript
async onUnload(): Promise<void> {
  // Deregister streaming tools
  for (const deregister of this.deregisterFns) {
    deregister();
  }
  this.deregisterFns = [];

  // Close all sessions
  const sessionIds = Array.from(this.sessions.keys());
  for (const sessionId of sessionIds) {
    try {
      await this.streamingSSHTool.closeSession(sessionId);
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  // Cleanup existing sessions
  this.sessions.forEach((session) => {
    try {
      session.ptyProcess.kill();
    } catch {
      // ignore failures when cleaning up
    }
  });
  this.sessions.clear();

  logger.info('SSH Module unloaded.');
}
```

## Patch 3: Update Configuration Schema

**File**: `src/config/schema.ts`

**Change**: Add streaming configuration

```typescript
// Add to InfectedConfigSchema properties
streaming: z.object({
  enabled: z.boolean().default(true).describe("Enable real-time output streaming"),
  shell: z.object({
    enabled: z.boolean().default(true),
    bufferSize: z.number().int().default(8192),
    maxOutputSize: z.number().int().default(10485760), // 10MB
    updateInterval: z.number().int().default(100),
  }).default({}),
  ssh: z.object({
    enabled: z.boolean().default(true),
    updateInterval: z.number().int().default(100),
    maxOutputSize: z.number().int().default(52428800), // 50MB
    defaultTimeout: z.number().int().default(600),
  }).default({}),
}).default({}),
```

## Patch 4: Environment Variables

**File**: `.env.example`

```bash
# Real-time Output Streaming Configuration
MCP_SHELL_ENABLE_STREAMING=true
MCP_SSH_ENABLE_STREAMING=true
MCP_SHELL_STREAMING_BUFFER_SIZE=8192
MCP_SHELL_STREAMING_MAX_OUTPUT=10485760
MCP_SSH_STREAMING_MAX_OUTPUT=52428800
MCP_SSH_STREAMING_DEFAULT_TIMEOUT=600
```

## Patch 5: Update Type Definitions

**File**: `src/types/index.ts`

**Change**: Add streaming types

```typescript
export interface StreamingConfig {
  enabled: boolean;
  bufferSize: number;
  maxOutputSize: number;
  updateInterval: number;
}

export interface SSHStreamingConfig {
  enabled: boolean;
  updateInterval: number;
  maxOutputSize: number;
  defaultTimeout: number;
}

export interface StreamUpdate {
  type: 'output' | 'complete' | 'error' | 'timeout';
  data?: string;
  isStderr?: boolean;
  timestamp: number;
  [key: string]: any;
}
```

## Patch 6: WebSocket Transport Support

**File**: `src/transports/websocket.ts`

**Change**: Add streaming endpoint

```typescript
// Add to WebSocket transport implementation
private streamSubscriptions = new Map<string, Set<WebSocket>>();

setupStreamingEndpoint() {
  this.server.on('stream', async (executionId: string) => {
    // Register client for streaming updates
    if (!this.streamSubscriptions.has(executionId)) {
      this.streamSubscriptions.set(executionId, new Set());
    }
    this.streamSubscriptions.get(executionId)!.add(this);
  });
}

broadcastStreamUpdate(executionId: string, update: StreamUpdate) {
  const clients = this.streamSubscriptions.get(executionId);
  if (clients) {
    clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(update));
      }
    });
  }
}
```

## Patch 7: SSE Transport Support

**File**: `src/transports/sse.ts`

**Change**: Add streaming endpoint

```typescript
// Add to SSE transport implementation
private eventClients = new Map<string, { res: Response; write: (data: string) => void }>();

setupStreamingEndpoint(app: Express) {
  app.get('/stream/:executionId', (req, res) => {
    const executionId = req.params.executionId;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    this.eventClients.set(executionId, {
      res,
      write: (data: string) => res.write(`data: ${data}\n\n`),
    });

    res.on('close', () => {
      this.eventClients.delete(executionId);
    });
  });
}

broadcastStreamUpdate(executionId: string, update: StreamUpdate) {
  const client = this.eventClients.get(executionId);
  if (client) {
    client.write(JSON.stringify(update));
  }
}
```

## Implementation Checklist

- [ ] Copy `STREAMING_SHELL_IMPLEMENTATION.ts` to `src/enhanced-shell-tool.ts`
- [ ] Copy `STREAMING_SSH_IMPLEMENTATION.ts` to `src/enhanced-ssh-tool.ts`
- [ ] Apply Patch 1 to `src/modules/shell/index.ts`
- [ ] Apply Patch 2 to `src/modules/ssh/index.ts`
- [ ] Apply Patch 3 to `src/config/schema.ts`
- [ ] Apply Patch 4 to `.env.example`
- [ ] Apply Patch 5 to `src/types/index.ts`
- [ ] Apply Patch 6 to `src/transports/websocket.ts` (if using WebSocket)
- [ ] Apply Patch 7 to `src/transports/sse.ts` (if using SSE)
- [ ] Run `npm run build` to compile TypeScript
- [ ] Test shell streaming: `curl -X POST http://localhost:3000/tools/shell_execute_streaming ...`
- [ ] Test SSH streaming: Create session, execute command, verify streaming
- [ ] Update documentation with new tools
- [ ] Add integration tests for streaming functionality

## Testing After Integration

### Test Shell Streaming

```bash
# Execute command with streaming
curl -X POST http://localhost:3000/tools/shell_execute_streaming \
  -H "Content-Type: application/json" \
  -d '{
    "command": "for i in {1..10}; do echo \"Line $i\"; sleep 0.5; done",
    "streamingEnabled": true
  }'

# Expected: See execution ID returned immediately
# Then connect to WebSocket for real-time output
```

### Test SSH Streaming

```bash
# Create session
curl -X POST http://localhost:3000/tools/ssh_create_session \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session",
    "host": "example.com",
    "user": "admin",
    "port": 22
  }'

# Execute command
curl -X POST http://localhost:3000/tools/ssh_execute_streaming \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session",
    "command": "ls -la /var/log",
    "streamingEnabled": true
  }'

# Close session
curl -X POST http://localhost:3000/tools/ssh_close_session \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test-session"}'
```

## Rollback Instructions

If streaming implementation causes issues:

1. Remove streaming tool registrations from `register()` method
2. Comment out `EnhancedShellTool` and `EnhancedSSHTool` initialization
3. Revert `src/config/schema.ts` changes
4. Rebuild: `npm run build`
5. Restart server

Existing tools will continue to work without streaming.
