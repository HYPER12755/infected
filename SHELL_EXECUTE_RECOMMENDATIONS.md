# shell_execute Tool - Recommendations

## Current Limitation
shell_execute runs processes in a detached background mode. These processes:
- Have no associated terminal session
- Cannot be accessed/interacted with by terminal_operate
- Buffer all output until completion (no real-time streaming)

---

## Recommended Improvements

### 1. Real-time Output Streaming
Currently: Buffers all output until process completes
Recommended: Add option to stream output in real-time
```
shell_execute(cmd, stream: true)  // Returns output incrementally
```

### 2. Output Polling API
Currently: Must wait for completion to get output
Recommended: Allow checking current buffered output anytime
```
get_output(execution_id)  // Returns current output without waiting
```

### 3. Process Attach / Terminal Session
Currently: No way to interact with running process
Recommended: Create terminal session that attaches to the process
```
shell_execute(cmd, interactive: true)  // Returns terminal_id for operate
```
OR
```
attach_to_process(execution_id)  // Returns terminal_id
```

### 4. Signal Support
Currently: Timeout kills process, no manual control
Recommended: Allow sending signals to running process
```
kill_process(execution_id, signal: "SIGINT")  // Ctrl+C equivalent
kill_process(execution_id, signal: "SIGTERM")
```

### 5. Better Timeout Handling
Currently: Kills after timeout
Recommended: Configurable behavior
```
shell_execute(cmd, timeout: 30, on_timeout: "background")  // Keep running
shell_execute(cmd, timeout: 30, on_timeout: "return_id")  // Return execution_id
```

### 6. Progress Metadata
Currently: Limited info about running process
Recommended: Return additional metadata
```
{
  execution_id: "...",
  status: "running",
  pid: 1234,
  elapsed_ms: 5000,
  output_lines: 100,
  output_id: "..."
}
```

### 7. Named Executions
Currently: Hard to track multiple running processes
Recommended: Tag executions with names
```
shell_execute(cmd, name: "count-to-1000")
list_executions(name: "count-to-1000")
```

### 8. Output Diff / Incremental Reads
Currently: Re-reads full output each time
Recommended: Return only new lines since last read
```
get_output(execution_id, since: last_read_position)
```

---

## Priority Ranking

| Priority | Feature | Impact |
|----------|---------|--------|
| 1 | Process Attach / Interactive Mode | High - Enables terminal_operate integration |
| 2 | Real-time Streaming | High - Matches terminal_operate capability |
| 3 | Output Polling API | Medium - Enables monitoring |
| 4 | Signal Support | Medium - Process control |
| 5 | Better Timeout Handling | Medium - Flexibility |
| 6 | Progress Metadata | Low - Debugging aid |
| 7 | Named Executions | Low - Organization |
| 8 | Output Diff | Low - Efficiency |

---

## Ideal Implementation

```javascript
// Start interactive process (creates terminal)
const result = shell_execute({
  command: "./interactive.sh",
  interactive: true,  // Creates terminal session
  timeout: 60,
  stream: true
});
// Returns: { terminal_id: "...", execution_id: "...", pid: 123 }

// Now can use terminal_operate with terminal_id
terminal_operate({ terminal_id: result.terminal_id, input: "Alice" });

// Or monitor output in real-time
for await (const chunk of stream_output(result.execution_id)) {
  console.log(chunk);  // 1, 2, 3, 4...
}
```

---

## Summary

The main gap: shell_execute and terminal_operate are completely disconnected. 

Solution: Allow shell_execute to optionally create a terminal session that terminal_operate can then interact with. This bridges the two tools and enables true interactive scripting.
