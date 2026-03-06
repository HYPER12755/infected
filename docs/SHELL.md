# Shell Module Documentation

## Purpose

The Shell module (`src/modules/shell/main.ts` and `src/modules/shell/shell-tools.ts`) is a comprehensive **MCP Shell Server** that provides secure shell command execution, terminal management, process control, and output file management. It integrates multiple core components (ProcessManager, TerminalManager, SecurityManager, FileManager, MonitoringManager, CommandHistoryManager) to deliver a full-featured shell execution environment with security controls, adaptive execution modes, and persistent session support.

---

## Main Features

### 1. **Shell Command Execution**
- Execute shell commands with multiple execution modes (foreground, background, detached, adaptive)
- Configurable timeouts, working directories, and environment variables
- Support for stdin input and output piping between commands
- Automatic truncation handling with output IDs for large outputs
- **Code**: `executeShell()` (shell-tools.ts lines 89-257), `ShellExecuteParamsSchema` (schemas.ts lines 13-119)

### 2. **Adaptive Execution Mode**
- Automatically switches from foreground to background for long-running commands
- Configurable foreground timeout (default 15s, max 300s)
- Returns partial output on timeout with continuation capability
- **Code**: `execution_mode: 'adaptive'` in schemas.ts

### 3. **Process Management**
- List, monitor, and kill running processes
- Filter by status (running, completed, failed), command pattern, or session ID
- Process monitoring with CPU, memory, I/O, and network metrics
- **Code**: `listProcesses()` (shell-tools.ts lines 281-314), `killProcess()` (shell-tools.ts lines 316-334), `monitorProcess()` (shell-tools.ts lines 336-348)

### 4. **Terminal Management**
- Create persistent terminal sessions with PTY support
- Send input, resize terminals, get output with line tracking
- Unified `terminal_operate` combining create, send, and get operations
- Multiple shell types support (bash, zsh, fish, cmd, powershell)
- **Code**: `ShellTools` terminal methods (shell-tools.ts lines 402-532), `TerminalOperateParamsSchema`

### 4.1 **Interactive Sessions with terminal_operate** ⚡

The `terminal_operate` tool is designed specifically for **interactive sessions** where commands require user input (like yes/no prompts, passwords, menus).

#### Key Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `terminal_id` | string? | Use existing terminal (if not provided, creates new one) |
| `command` | string? | Command to execute (required when creating new terminal) |
| `input` | string? | Input to send to existing terminal |
| `execute` | boolean | Press Enter after input (default: true) |
| `get_output` | boolean | Retrieve output after operations (default: true) |
| `output_delay_ms` | number | Delay before retrieving output (default: 500ms) |
| `output_lines` | number | Number of output lines to retrieve (default: 20) |

#### Example: Running apt upgrade

**Step 1: Start the command**
```json
{
  "name": "terminal_operate",
  "arguments": {
    "command": "sudo apt upgrade",
    "shell_type": "bash",
    "session_name": "apt-session",
    "get_output": true,
    "output_delay_ms": 1000
  }
}
```

**Response:**
```json
{
  "terminal_id": "term_abc123",
  "success": true,
  "output": "Reading package lists... Done\nBuilding dependency tree...\nThe following packages will be upgraded:\n...\nDo you want to continue? [Y/n]"
}
```

**Step 2: Send "y" to confirm**
```json
{
  "name": "terminal_operate",
  "arguments": {
    "terminal_id": "term_abc123",
    "input": "y",
    "execute": true,
    "get_output": true,
    "output_delay_ms": 2000
  }
}
```

**Step 3: Close when done**
```json
{
  "name": "terminal_operate",
  "arguments": {
    "terminal_id": "term_abc123",
    "input": "exit",
    "execute": true
  }
}
```

Or use `terminal_close`:
```json
{
  "name": "terminal_close",
  "arguments": {
    "terminal_id": "term_abc123"
  }
}
```

#### Use Cases

| Use Case | Tool | Example |
|----------|------|---------|
| Run command to completion | `shell_execute` | `ls -la`, `git status` |
| Interactive session | `terminal_operate` | `sudo apt upgrade`, `mysql -u root` |
| Check terminal status | `terminal_get_info` | Get terminal details |
| List all terminals | `terminal_list` | See active sessions |

### 5. **Output File Management**
- List, read, and delete command output files (stdout, stderr, logs)
- Chunked reading with offset support for large files
- Multiple encoding options (utf-8, binary, etc.)
- **Code**: `listFiles()` (shell-tools.ts lines 351-373), `readFile()` (shell-tools.ts lines 375-388), `deleteFiles()` (shell-tools.ts lines 390-398)

### 6. **Security & Safety Evaluation**
- Enhanced security evaluation with LLM-based command safety analysis
- Traditional security auditing and command validation
- Configurable security restrictions (allowed/blocked commands, directories, network access)
- Execution time and memory limits
- **Code**: `executeShell()` security section (lines 91-135), `SecurityManager` integration

### 7. **Command History Management**
- Persistent command history with search and analytics
- Pagination, filtering by date, working directory, safety classification
- Statistics, pattern analysis, and top commands analytics
- **Code**: `queryCommandHistory()` (shell-tools.ts lines 833-976)

### 8. **Cleanup Management**
- Automatic cleanup suggestions based on file age and size
- Dry-run mode for safe cleanup simulation
- Configurable retention policies
- **Code**: `getCleanupSuggestions()` (shell-tools.ts lines 625-638), `performAutoCleanup()` (shell-tools.ts lines 641-654)

### 9. **System Monitoring**
- System statistics (CPU, memory, uptime)
- Process, terminal, and file counts
- Configurable time ranges for historical data
- **Code**: `getMonitoringStats()` (shell-tools.ts lines 569-605)

---

## How It Works

### Server Initialization

The `MCPShellServer` class initializes multiple managers in a specific order:

```
Constructor (main.ts lines 61-128):
1. Create McpServer instance with capabilities
2. Initialize FileManager (for output storage)
3. Initialize ConfigManager (configuration)
4. Initialize ProcessManager (max 50 concurrent, output dir /tmp/mcp-shell-outputs)
5. Initialize TerminalManager (PTY sessions)
6. Initialize MonitoringManager (system stats)
7. Initialize CommandHistoryManager (persistent history)
8. Initialize SecurityManager with EnhancedSafetyEvaluator
9. Set up background process callbacks
10. Create ShellTools instance with all managers
11. Register all tool handlers
```

### Command Execution Flow

```
executeShell() (shell-tools.ts lines 89-257):

1. Security Evaluation (if enhanced mode enabled)
   ├─> EnhancedSafetyEvaluator.analyzeCommand()
   ├─> Evaluate: allow, deny, or ai_assistant_confirm
   └─> Throw error or return confirmation request

2. Traditional Security Checks
   ├─> SecurityManager.auditCommand()
   └─> SecurityManager.validateExecutionTime()

3. Build ExecutionOptions
   ├─> Map schema params to ExecutionOptions
   ├─> Validate timeout limits (foreground max 300s)
   └─> Handle optional parameters

4. Execute via ProcessManager
   ├─> ProcessManager.executeCommand(options)
   ├─> Spawn child process with configured environment
   ├─> Handle stdout/stderr streams
   └─> Return ExecutionInfo with output, exit code, timing

5. Add to Command History
   ├─> Analyze command safety classification
   ├─> Create history entry with metadata
   └─> Save to persistent storage

6. Return Response
   ├─> Include execution_id, status, output
   ├─> Include safety_evaluation if available
   └─> Handle truncation (output_truncated flag)
```

### Execution Modes

| Mode | Behavior |
|------|----------|
| `foreground` | Wait for completion, return output, respect timeout |
| `background` | Run async, return immediately with execution_id |
| `detached` | Fire-and-forget, no tracking |
| `adaptive` | Start foreground, switch to background after timeout |

### Adaptive Mode Details

```
foreground_timeout_seconds (default: 15s, max: 300s):
1. Execute command in foreground
2. If completes within timeout → return result
3. If timeout → switch to background execution
4. Return partial output with execution_id
5. Client can poll with process_get_execution
```

---

## Important Classes, Functions, and Utilities

### Core Server Class

| Class | Lines | Role |
|-------|-------|------|
| `MCPShellServer` | main.ts 50-484 | Main server class orchestrating all components |
| `ShellTools` | shell-tools.ts 73-1025 | Central handler for all MCP tool operations |

### ProcessManager (core/process-manager.ts)

| Function | Lines | Role |
|----------|-------|------|
| `executeCommand()` | ~200-400 | Core command execution with streaming support |
| `listExecutions()` | ~500+ | List executions with filtering |
| `killProcess()` | ~600+ | Terminate running process |
| `setDefaultWorkingDirectory()` | ~300+ | Set default working directory |
| `getAllowedWorkingDirectories()` | ~300+ | Get list of allowed directories |

### TerminalManager (core/terminal-manager.ts)

| Function | Role |
|----------|------|
| `createTerminal()` | Create new PTY terminal session |
| `listTerminals()` | List active terminals with filters |
| `getTerminal()` | Get terminal details |
| `sendInput()` | Send input to terminal |
| `getOutput()` | Retrieve terminal output with line tracking |
| `resizeTerminal()` | Resize terminal dimensions |
| `closeTerminal()` | Close terminal session |

### SecurityManager (security/manager.ts)

| Function | Role |
|----------|------|
| `evaluateCommandSafetyByEnhancedEvaluator()` | LLM-based safety evaluation |
| `analyzeCommandSafety()` | Classification (basic_safe, llm_required) |
| `auditCommand()` | Traditional command auditing |
| `setRestrictions()` | Configure security restrictions |

### FileManager (core/file-manager.ts)

| Function | Role |
|----------|------|
| `listFiles()` | List output files with filters |
| `readFile()` | Read file content with offset/size |
| `deleteFiles()` | Delete output files |
| `getCleanupSuggestions()` | Get cleanup recommendations |
| `performAutoCleanup()` | Execute automatic cleanup |

### CommandHistoryManager (core/enhanced-history-manager.ts)

| Function | Role |
|----------|------|
| `addHistoryEntry()` | Add command to history |
| `searchHistory()` | Search with filters |
| `getHistoryStats()` | Get analytics (stats, patterns, top commands) |
| `loadHistory()` | Load history from persistent storage |

### ShellTools Handler Functions (shell-tools.ts)

| Function | Lines | MCP Tool |
|----------|-------|----------|
| `executeShell()` | 89-257 | shell_execute |
| `getExecution()` | 259-278 | process_get_execution |
| `listProcesses()` | 281-314 | process_list |
| `killProcess()` | 316-334 | process_kill |
| `monitorProcess()` | 336-348 | process_monitor |
| `listFiles()` | 351-373 | list_execution_outputs |
| `readFile()` | 375-388 | read_execution_output |
| `deleteFiles()` | 390-398 | delete_execution_outputs |
| `createTerminal()` | 402-419 | terminal_create |
| `listTerminals()` | 421-444 | terminal_list |
| `getTerminal()` | 446-453 | terminal_get_info |
| `sendTerminalInput()` | 455-477 | terminal_send_input |
| `getTerminalOutput()` | 479-507 | terminal_get_output |
| `resizeTerminal()` | 509-522 | terminal_resize |
| `closeTerminal()` | 524-532 | terminal_close |
| `terminalOperate()` | 657-830 | terminal_operate (unified) |
| `setSecurityRestrictions()` | 535-567 | security_set_restrictions |
| `getMonitoringStats()` | 569-605 | monitoring_get_stats |
| `setDefaultWorkingDirectory()` | 607-622 | shell_set_default_workdir |
| `getCleanupSuggestions()` | 625-638 | get_cleanup_suggestions |
| `performAutoCleanup()` | 641-654 | perform_auto_cleanup |
| `queryCommandHistory()` | 833-976 | command_history_query |

### Input Schemas (schemas.ts)

| Schema | Lines | Purpose |
|--------|-------|---------|
| `ShellExecuteParamsSchema` | 13-119 | Command execution parameters |
| `ShellGetExecutionParamsSchema` | 121-128 | Get execution details |
| `ProcessListParamsSchema` | 131-167 | List processes |
| `ProcessKillParamsSchema` | 169-184 | Kill process |
| `ProcessMonitorParamsSchema` | 186-209 | Monitor process |
| `FileListParamsSchema` | 212-237 | List output files |
| `FileReadParamsSchema` | 239-269 | Read output file |
| `FileDeleteParamsSchema` | 271-283 | Delete output files |
| `TerminalCreateParamsSchema` | 286-314 | Create terminal |
| `TerminalListParamsSchema` | 316-338 | List terminals |
| `TerminalGetParamsSchema` | 340-347 | Get terminal info |
| `TerminalInputParamsSchema` | 349-385 | Send terminal input |
| `TerminalOutputParamsSchema` | 387-423 | Get terminal output |
| `TerminalResizeParamsSchema` | 425-435 | Resize terminal |
| `TerminalCloseParamsSchema` | 437-450 | Close terminal |
| `CleanupSuggestionsParamsSchema` | 533-548 | Cleanup suggestions |
| `AutoCleanupParamsSchema` | 550-566 | Auto cleanup |
| `CommandHistoryQueryParamsSchema` | 569-616 | Command history query |

---

## Data Flow

### Input Flow
```
Client Request (JSON with tool name and arguments)
    ↓
MCP Server routes to setRequestHandler(CallToolRequestSchema)
    ↓
Zod Schema Validation (ShellExecuteParamsSchema.parse(args))
    ↓
ShellTools Handler (e.g., executeShell)
    ↓
Security Evaluation (if enabled)
    ↓
ProcessManager.executeCommand()
    ↓
Child Process Spawn (spawn with options)
    ↓
Stream Output (stdout/stderr to FileManager)
    ↓
Return ExecutionInfo
    ↓
Add to Command History
    ↓
Response to Client
```

### Output Flow
```
Command Execution
    ↓
Stream to /tmp/mcp-shell-outputs/{execution_id}
    ↓
FileManager stores files
    ↓
ExecutionInfo returned to client
    ↓
If output_truncated: client uses output_id
    ↓
read_execution_output retrieves full content
```

---

## Integration

### MCP Tools Registered (12 Tools)

| Tool Name | Description | Interactive |
|-----------|-------------|-------------|
| `shell_execute` | Execute shell commands with adaptive execution | ❌ |
| `process_get_execution` | Get execution details by ID | - |
| `process_list_executions` | List all command executions | - |
| `process_kill` | Kill a running process | - |
| `shell_set_default_workdir` | Set default working directory | - |
| `list_execution_outputs` | List output files from executions | - |
| `get_cleanup_suggestions` | Get cleanup recommendations | - |
| `perform_auto_cleanup` | Perform automatic cleanup | - |
| **`terminal_operate`** | **Unified terminal operations for interactive sessions** | ✅ |
| `terminal_list` | List terminal sessions | - |
| `terminal_get_info` | Get terminal details | - |
| `terminal_close` | Close terminal session | - |

### Component Dependencies

| Component | Dependency For |
|-----------|----------------|
| ProcessManager | Command execution, output storage |
| TerminalManager | PTY terminal sessions |
| FileManager | Output file management |
| MonitoringManager | System statistics |
| SecurityManager | Command safety evaluation |
| CommandHistoryManager | Persistent history |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `MCP_DISABLED_TOOLS` | Comma-separated list of tools to disable |
| `EXECUTION_BACKEND` | Set to "remote" for remote execution |

---

## Example Workflow: Executing a Shell Command

### Scenario: Client calls `shell_execute` with `{ command: "npm install", execution_mode: "foreground" }`

```
1. REQUEST RECEIVED
   └─> MCP server routes to case 'shell_execute'

2. INPUT VALIDATION
   └─> ShellExecuteParamsSchema.parse({ command: "npm install", ... })

3. SECURITY EVALUATION
   └─> securityManager.isEnhancedModeEnabled() → true
   └─> evaluateCommandSafetyByEnhancedEvaluator("npm install", ...)
   └─> Result: "allow" (safe command)

4. OPTIONS BUILDING
   └─> ExecutionOptions = {
         command: "npm install",
         executionMode: "foreground",
         timeoutSeconds: 60,
         maxOutputSize: 5242880,
         captureStderr: true,
         ...
       }

5. EXECUTION (ProcessManager.executeCommand)
   └─> Generate execution_id: "exec_abc123"
   └─> Spawn child process: spawn("npm install", [], { cwd, env, ... })
   └─> Capture stdout/stderr streams
   └─> Write to /tmp/mcp-shell-outputs/exec_abc123/{stdout,stderr}

6. COMPLETION
   └─> Process exits with code 0
   └─> ExecutionInfo = {
         execution_id: "exec_abc123",
         command: "npm install",
         status: "completed",
         exit_code: 0,
         stdout: "...",
         stderr: "",
         execution_time_ms: 45000
       }

7. COMMAND HISTORY
   └─> Analyze command safety: "basic_safe"
   └─> Add history entry with metadata

8. RESPONSE
   └─> Return:
       {
         execution_id: "exec_abc123",
         command: "npm install",
         status: "completed",
         exit_code: 0,
         stdout: "...",
         execution_time_ms: 45000,
         output_truncated: false,
         safety_evaluation: { ... }
       }
```

---

## Example Workflow: Adaptive Mode Long-Running Command

### Scenario: Client calls `shell_execute` with `{ command: "npm run build", execution_mode: "adaptive", foreground_timeout_seconds: 30 }`

```
1. INITIAL FOREGROUND EXECUTION
   └─> Spawn command in foreground
   └─> Wait up to 30 seconds

2. COMPLETION CHECK (at 30s mark)
   └─> Command still running (build takes 2 minutes)
   └─> return_partial_on_timeout: true

3. BACKGROUND SWITCH
   └─> Detach from foreground process
   └─> Mark as "background" status
   └─> Return partial output collected

4. RESPONSE (partial)
   └─> {
         execution_id: "exec_xyz789",
         status: "background",
         output_truncated: true,
         truncation_reason: "foreground_timeout",
         stdout: "Compiling... 50%",
         message: "Command switched to background"
       }

5. CLIENT POLLS FOR COMPLETION
   └─> process_get_execution({ execution_id: "exec_xyz789" })
   └─> Returns: { status: "running", ... }

6. EVENTUAL COMPLETION
   └─> Background process completes
   └─> Notification sent to client
   └─> Final status: { status: "completed", exit_code: 0 }
```

---

## Security Features

| Feature | Implementation |
|---------|---------------|
| **Enhanced Safety Evaluation** | LLM-based command analysis with deny/allow/confirm outcomes |
| **Traditional Auditing** | Pattern-based command auditing |
| **Execution Time Limits** | Configurable timeout (1-3600s) |
| **Memory Limits** | Configurable max memory (1-32768MB) |
| **Directory Restrictions** | Allowed/blocked directories |
| **Command Allowlist/Blocklist** | Fine-grained command control |
| **Network Control** | Enable/disable network access |
| **Safe Environment** | Sensitive env vars filtered via getSafeEnvironment() |

---

## Known Issues

| Issue | Location | Severity |
|-------|----------|----------|
| Duplicate initializeEnhancedEvaluator call | main.ts lines 90 and 98 | High - redundant initialization |
| Command injection via shell metacharacters | shell-tools.ts - executeShell | Critical - not sanitized |
| No rate limiting on tool calls | HTTP transport (separate) | High |
| Enhanced evaluator initialization may fail silently | main.ts | Medium |
| Background process callbacks may not fire on crash | process-manager.ts | Medium |
| Command history may grow unbounded | enhanced-history-manager.ts | Medium |
| Output files in /tmp may persist | file-manager.ts | Low |
| Terminal session cleanup not guaranteed | terminal-manager.ts | Low |

---

## Configuration

### Tool Disabling

```bash
# Disable specific tools via environment variable
export MCP_DISABLED_TOOLS="terminal_create,terminal_send_input"
```

### Remote Backend

```bash
# Use remote execution backend
export EXECUTION_BACKEND=remote
```

### Security Modes

| Mode | Description |
|------|-------------|
| `permissive` | Basic safety checks only |
| `restrictive` | Read-only commands allowed |
| `custom` | Fine-grained configuration |
