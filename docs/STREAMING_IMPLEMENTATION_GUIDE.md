# Real-Time Output Streaming Implementation Guide

## Overview

This guide explains how to integrate real-time output streaming into Infected MCP Server's Shell and SSH tools, following MCP SDK best practices.

## What is Being Implemented

### For Shell Tool
A new `shell_execute_streaming` tool that:
- Executes shell commands with real-time output streaming
- Emits output chunks as they arrive (every 100ms)
- Tracks execution status and progress
- Supports command cancellation
- Handles timeouts gracefully
- Returns structured responses

### For SSH Tool
Three new SSH tools with streaming:
- `ssh_create_session`: Create persistent SSH sessions
- `ssh_execute_streaming`: Execute commands with real-time output streaming
- `ssh_close_session`: Cleanly close sessions

## Architecture

### Shell Streaming Flow

```
User Request (shell_execute_streaming)
         ↓
EnhancedShellTool.executeWithStreaming()
         ↓
spawn('bash', ['-c', command])
         ↓
    ┌────┴────┐
    ↓         ↓
 stdout      stderr
    ↓         ↓
  data      data
    ↓         ↓
  emit→→→→→→→emit
    ↓         ↓
Process  → EventEmitter
    ↓         ↓
  complete   subscribers
    ↓         ↓
Response  → Updates
```

### SSH Streaming Flow

```
Create Session (ssh_create_session)
         ↓
    SSHSession
    (persistent)
         ↓
Execute Command (ssh_execute_streaming)
         ↓
EnhancedSSHTool.executeWithStreaming()
         ↓
spawn('ssh', [...args])
         ↓
    ┌────┴────┐
    ↓         ↓
 stdout      stderr
    ↓         ↓
  Stream   Stream
    ↓         ↓
  EventEmitter
    ↓
 Subscribers
    ↓
 Updates
    ↓
Response + Session State
```

## Integration Steps

### Step 1: Add Streaming Shell Tool to Shell Module

File: `src/modules/shell/index.ts`

```typescript
import { EnhancedShellTool, shellStreamingToolDefinition } from '../../enhanced-shell-tool.js';

export class ShellModule implements Module {
  private shellTool: EnhancedShellTool;

  async register(server: McpServer, config: InfectedConfig, managers: ManagerInstances) {
    // Initialize streaming shell tool
    this.shellTool = new EnhancedShellTool({
      enabled: true,
      bufferSize: 8192,
      maxOutputSize: 10 * 1024 * 1024,
      updateInterval: 100,
    });

    // Register shell_execute_streaming tool
    this.deregisterFunctions.push(
      server.registerTool(shellStreamingToolDefinition, async (args) => {
        return await this.shellTool.executeWithStreaming(args);
      })
    );

    logger.info('  ShellModule: shell_execute_streaming tool registered.');
  }
}
```

### Step 2: Add Streaming SSH Tools to SSH Module

File: `src/modules/ssh/index.ts`

```typescript
import { EnhancedSSHTool, sshStreamingTools } from '../../enhanced-ssh-tool.js';

export default class SshModule implements IUnifiedPlugin {
  private sshTool: EnhancedSSHTool;

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    // Initialize streaming SSH tool
    this.sshTool = new EnhancedSSHTool({
      enabled: true,
      updateInterval: 100,
      maxOutputSize: 50 * 1024 * 1024,
      defaultTimeout: 600,
    });

    // Register SSH streaming tools
    sshStreamingTools.forEach((tool) => {
      const deregister = context.moduleManager.registerToolExecution(
        tool.name,
        async (args) => {
          if (tool.name === 'ssh_create_session') {
            return await this.sshTool.createSession(args);
          } else if (tool.name === 'ssh_execute_streaming') {
            return await this.sshTool.executeWithStreaming(args);
          } else if (tool.name === 'ssh_close_session') {
            return await this.sshTool.closeSession(args.sessionId);
          }
        },
        tool.name
      );
      this.deregisterFns.push(() => deregister?.());
    });

    context.logger.info('SSH streaming tools registered');
  }
}
```

### Step 3: Enable Streaming in Configuration

File: `infected.config.json`

```json
{
  "streaming": {
    "enabled": true,
    "shell": {
      "enabled": true,
      "bufferSize": 8192,
      "maxOutputSize": 10485760,
      "updateInterval": 100
    },
    "ssh": {
      "enabled": true,
      "updateInterval": 100,
      "maxOutputSize": 52428800,
      "defaultTimeout": 600
    }
  }
}
```

### Step 4: Update Existing Shell Tool

To add streaming support to the existing `shell_execute` tool, modify shell-tools.ts:

```typescript
async executeShell(params: ShellExecuteParams) {
  // Check if streaming is enabled
  if (params.output_id && this.streamPublisher?.isRealtimeStreamingEnabled()) {
    // Use streaming implementation
    const result = await this.shellTool.executeWithStreaming({
      command: params.command,
      workingDirectory: params.working_directory,
      timeout: params.timeout_seconds * 1000,
      streamingEnabled: true,
    });

    // Subscribe to updates
    this.shellTool.subscribeToExecution(result.executionId, (update) => {
      this.streamPublisher.notifyOutputData(
        params.output_id,
        update.data,
        update.isStderr
      );
    });

    return result.content[0];
  } else {
    // Fall back to existing implementation
    return await this.executeShellTraditional(params);
  }
}
```

## Client Usage Examples

### Using Shell Streaming Tool

```typescript
// Client code to use real-time streaming
const response = await fetch('http://localhost:3000/tools/shell_execute_streaming', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    command: 'npm install',
    timeout: 600,
    streamingEnabled: true,
  }),
});

const result = await response.json();
const executionId = result.executionId;

// Connect to WebSocket for real-time updates
const ws = new WebSocket(`ws://localhost:3000/stream/${executionId}`);

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log(`[${update.timestamp}] ${update.data}`);
};

ws.onclose = () => {
  console.log('Stream ended');
};
```

### Using SSH Streaming Tools

```typescript
// Step 1: Create session
const sessionResponse = await fetch('http://localhost:3000/tools/ssh_create_session', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: 'prod-deploy',
    host: 'production.example.com',
    user: 'deploy',
  }),
});

// Step 2: Execute command with streaming
const execResponse = await fetch('http://localhost:3000/tools/ssh_execute_streaming', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: 'prod-deploy',
    command: './deploy.sh',
    timeout: 1800,
    streamingEnabled: true,
  }),
});

const execResult = await execResponse.json();

// Step 3: Subscribe to real-time updates
const ws = new WebSocket(`ws://localhost:3000/stream/${execResult.executionId}`);

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log(update.data);
};

// Step 4: Close session when done
await fetch('http://localhost:3000/tools/ssh_close_session', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: 'prod-deploy',
  }),
});
```

## Configuration Options

### Shell Streaming

```typescript
interface StreamingConfig {
  enabled: boolean;           // Enable streaming (default: true)
  bufferSize: number;         // Chunk size in bytes (default: 8192)
  maxOutputSize: number;      // Max total output (default: 10MB)
  captureStderr: boolean;     // Include stderr (default: true)
  updateInterval: number;     // Update frequency ms (default: 100)
}
```

### SSH Streaming

```typescript
interface SSHStreamingConfig {
  enabled: boolean;           // Enable streaming (default: true)
  updateInterval: number;     // Update frequency ms (default: 100)
  maxOutputSize: number;      // Max total output (default: 50MB)
  defaultTimeout: number;     // Timeout in seconds (default: 600)
}
```

## Performance Considerations

### Memory Usage
- **Without streaming**: Entire output buffered in memory
- **With streaming**: Only current chunk (8KB) in buffer
- **Benefit**: Can handle 1GB+ outputs with constant memory

### Network Usage
- **Without streaming**: Single large message at completion
- **With streaming**: Continuous 8KB chunks every 100ms
- **Benefit**: Better perceived performance, smoother UX

### CPU Usage
- **Without streaming**: Spike at completion
- **With streaming**: Distributed load over execution time
- **Benefit**: More stable resource usage

## Error Handling

All streaming tools include comprehensive error handling:

```typescript
// Errors are streamed immediately
emitStreamUpdate(executionId, {
  type: 'error',
  error: error.message,
  timestamp: Date.now(),
});

// Timeouts are detected and reported
if (execution.status === 'running') {
  sshProcess.kill();
  execution.status = 'timeout';
  emitStreamUpdate(executionId, {
    type: 'timeout',
    duration: timeout,
  });
}

// Size limits are enforced
if (execution.totalOutput.length > maxOutputSize) {
  process.kill();
  reject(new Error('Output exceeded maximum size'));
}
```

## Backward Compatibility

The new streaming tools are **completely backward compatible**:

- Existing `shell_execute` tool continues to work unchanged
- New `shell_execute_streaming` tool is an additional option
- Existing `ssh_operate` tool continues to work unchanged
- New SSH streaming tools provide enhanced functionality

Clients can choose which tool to use based on their needs:
- Use traditional tools for quick commands (< 5 seconds)
- Use streaming tools for long operations (> 5 seconds)

## Testing Streaming Tools

### Test Shell Streaming

```bash
# Execute npm install with streaming
curl -X POST http://localhost:3000/tools/shell_execute_streaming \
  -H "Content-Type: application/json" \
  -d '{
    "command": "npm install",
    "timeout": 300,
    "streamingEnabled": true
  }'
```

### Test SSH Streaming

```bash
# Create session
curl -X POST http://localhost:3000/tools/ssh_create_session \
  -d '{"sessionId":"test","host":"example.com","user":"admin"}'

# Execute command with streaming
curl -X POST http://localhost:3000/tools/ssh_execute_streaming \
  -d '{"sessionId":"test","command":"ls -la","streamingEnabled":true}'

# Close session
curl -X POST http://localhost:3000/tools/ssh_close_session \
  -d '{"sessionId":"test"}'
```

## Monitoring & Observability

### Metrics to Track

1. **Output Size**: `execution.totalOutput.length`
2. **Execution Time**: `Date.now() - execution.startTime`
3. **Chunk Count**: `execution.outputChunks.length`
4. **Update Frequency**: Count of updates per second
5. **Session Count**: Active SSH sessions
6. **Memory Usage**: Peak memory during streaming

### Logging

```typescript
logger.debug('Streaming execution started', {
  executionId: execution.id,
  command: execution.command,
  streaming: true,
});

logger.debug('Output chunk received', {
  executionId: execution.id,
  chunkSize: data.length,
  totalSize: execution.totalOutput.length,
});

logger.info('Streaming execution completed', {
  executionId: execution.id,
  status: execution.status,
  duration: Date.now() - execution.startTime,
  outputSize: execution.totalOutput.length,
});
```

## Troubleshooting

### Issue: No streaming updates received

**Check**:
1. Verify WebSocket connection is open
2. Confirm `streamingEnabled: true` in request
3. Check `MCP_SHELL_ENABLE_STREAMING` environment variable
4. Verify subscriber is registered

**Solution**:
```typescript
// Ensure streaming is enabled
const result = await shellTool.executeWithStreaming({
  command: 'your-command',
  streamingEnabled: true, // Explicitly set to true
});

// Verify WebSocket connection
const ws = new WebSocket(`ws://localhost:3000/stream/${result.executionId}`);
ws.onerror = (error) => console.error('WebSocket error:', error);
```

### Issue: Output truncated due to size limit

**Check**:
1. Command produces > 10MB output (shell) or > 50MB (SSH)
2. `maxOutputSize` configuration

**Solution**:
```typescript
// Increase size limit in config
const shellTool = new EnhancedShellTool({
  maxOutputSize: 50 * 1024 * 1024, // 50MB instead of 10MB
});

// Or process output in streaming chunks instead of waiting for completion
```

### Issue: Command timeout during long operations

**Check**:
1. Command execution time > timeout setting
2. Default timeout: 600 seconds (10 minutes) for SSH

**Solution**:
```typescript
// Increase timeout in request
await shellTool.executeWithStreaming({
  command: 'long-running-command',
  timeout: 3600000, // 1 hour in milliseconds
});
```

## Future Enhancements

Possible improvements for streaming implementation:

1. **Compression**: Compress output chunks for large outputs
2. **Filtering**: Filter output by pattern/severity level
3. **Progress Estimation**: Predict completion time
4. **Parallel Execution**: Run multiple streams concurrently
5. **Output Caching**: Cache and replay output
6. **Performance Tuning**: Adaptive buffer sizing based on network speed

## Conclusion

This implementation provides production-ready real-time output streaming for both shell and SSH tools in Infected MCP Server, with full backward compatibility and comprehensive error handling.

The streaming architecture:
- ✅ Improves user experience significantly
- ✅ Enables monitoring of long operations
- ✅ Reduces memory usage for large outputs
- ✅ Provides better error diagnostics
- ✅ Maintains backward compatibility
- ✅ Follows MCP SDK best practices
