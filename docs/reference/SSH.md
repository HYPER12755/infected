# SSH Module Documentation

## Purpose

The SSH module (`src/modules/ssh/index.ts`) is a **Stateful SSH Session Manager** that provides persistent terminal sessions with PTY (pseudo-terminal) support. It allows clients to execute commands on the local system through persistent shell sessions, with support for file uploads/downloads via base64 encoding. The module is designed as a plugin that integrates with the project's MCP (Model Context Protocol) framework.

---

## Main Features

### 1. **Persistent Terminal Sessions**
- Creates and maintains stateful PTY sessions using `node-pty`
- Sessions persist between commands, maintaining shell state (environment variables, working directory, etc.)
- Supports multiple concurrent sessions with unique IDs
- **Code**: `createSession()` (lines 576-617), `getOrCreateSession()` (lines 567-574)

### 2. **Command Execution**
- Execute commands within a persistent session
- Configurable timeout (default 30s, max 120s)
- Returns command output, exit code, and execution duration
- **Code**: `executeCommand()` (lines 619-673), `handleSshExecute()` (lines 243-295)

+### 3. **Session Management**
- Create new sessions by supplying a remote target (host, user, port, etc.)
- List all active sessions with metadata (status, uptime, last command)
- Close and clean up sessions
- **Code**: `handleSshNewSession()`, `handleListSessions()`, `handleCloseSession()`

+### 4. **Unified SSH Operations (`ssh_operate`)**
- Combines session creation, command execution, and output retrieval in a single tool
- Can create new sessions on-the-fly by providing a `target` parameter
- Use existing sessions by providing `session_id`
- Send commands or input to sessions
- Automatically retrieve output with configurable delay
- Option to strip ANSI/control sequences
- **Code**: `handleSshOperate()`, `formatSshOperateText()`

- Read the full history log (commands and outputs) for any session
- Option to strip ANSI/control sequences for clean output
- **Code**: `handleGetBuffer()` (lines 405-461), `cleanOutput()` (lines 708-727)

### 5. **File Transfer (Upload/Download)**
- **Upload**: Read local file → base64 encode → write to remote via session commands
- **Download**: Read remote file → base64 encode → decode locally
- 10MB file size limit, 5-minute default timeout
- **Code**: `handleUploadFile()` (lines 463-509), `handleDownloadFile()` (lines 511-557), `uploadFile()` (lines 745-832), `downloadFile()` (lines 834-870)

---

## How It Works

### Connection & Session Establishment

The module only establishes real SSH connections. `ssh_new_session` now requires a `target` object (host, user, port, identity file, etc.). It runs the `ssh` binary to keep an interactive session open on that remote host, and every later `ssh_execute`, upload, download or buffer access works inside that remote shell. There is no local shell fallback, so you cannot run commands on the controller host from these tools anymore.

```
createSession() (lines 576-617):
1. Builds `ssh` arguments from the requested host/user/port/identityFile
2. Spawns a PTY process that runs the `ssh` client with `-tt`, `BatchMode=yes`, and the extra args
3. Configures terminal (160 cols, 40 rows, xterm-256color)
4. Inherits entire process.env (SSH credentials taken from agent/identity file)
5. Attaches data handler to buffer PTY output
6. Stores session in Map<string, TerminalSession>
```

### Authentication

The module relies on the SSH client’s own authentication (keys/passwords configured on the target). When you specify `identityFile` or rely on agent forwarding, SSH handles credentials; the tool never stores passwords directly.

### Command Execution Workflow

```
executeCommand() (lines 619-673):

1. Mark session as "busy" (isReady = false)
2. Clear output buffer
3. Generate unique markers:
   - startMarker = "===START{timestamp}==="
   - endMarker = "===END{timestamp}==="
   - exitMarker = "===EXIT{timestamp}==="
4. Write markers to PTY to delimit command output:
   - echo '===START{timestamp}==='
   - {command}
   - echo '===EXIT{timestamp}?'$?
   - echo '===END{timestamp}==='
5. Poll buffer until endMarker appears (within timeout)
6. Extract output between markers
7. Filter out command echo, prompts, and duplicate lines
8. Parse exit code from exitMarker
9. Mark session as "ready" again
10. Return { output, exitCode, durationMs }
```

---

## Important Classes, Functions, and Utilities

### Core Class

| Class/Interface | Role |
|-----------------|------|
| `SshModule` (line 100) | Main plugin class implementing `IUnifiedPlugin`. Manages all SSH functionality. |
| `TerminalSession` (lines 15-22) | Interface representing a PTY session with id, ptyProcess, outputBuffer, isReady, lastCommand, createdAt. |

### Registration Functions (lines 141-241)

| Function | Role |
|----------|------|
| `registerSshExecute()` | Registers `ssh_execute` tool with the module manager |
| `registerSshNewSession()` | Registers `ssh_new_session` tool |
| `registerSshOperate()` | Registers `ssh_operate` tool (unified operations) |
| `registerSshListSessions()` | Registers `ssh_list_sessions` tool |
| `registerSshCloseSession()` | Registers `ssh_close_session` tool |
| `registerSshBuffer()` | Registers `ssh_get_buffer` tool |
| `registerSshUploadFile()` | Registers `ssh_upload_file` tool |
| `registerSshDownloadFile()` | Registers `ssh_download_file` tool |

### Handler Functions

| Function | Role |
|----------|------|
| `handleSshExecute()` | Validates args, gets/creates session, executes command, returns formatted response |
| `handleSshNewSession()` | Creates new named session |
| `handleSshOperate()` | Unified handler: creates sessions, sends input, retrieves output |
| `handleListSessions()` | Returns formatted list of all sessions |
| `handleCloseSession()` | Kills PTY process and removes session |
| `handleGetBuffer()` | Returns raw or cleaned buffer content |
| `handleUploadFile()` | Handles file upload flow |
| `handleDownloadFile()` | Handles file download flow |

### Utility Functions

| Function | Role |
|----------|------|
| `createSession()` (576-617) | Spawns PTY process and creates TerminalSession |
| `executeCommand()` (619-673) | Core command execution with marker-based output extraction |
| `filterCommandOutput()` (675-706) | Removes echo, prompts, duplicates from output |
| `cleanOutput()` (708-727) | Strips ANSI escape sequences and terminal artifacts |
| `escapeShellArg()` (737-743) | Escapes single quotes for safe shell arguments |
| `escapeRegex()` (729-731) | Escapes regex special characters |
| `resolveRemotePath()` (559-565) | Resolves ~ to home directory |
| `uploadFile()` (745-832) | Base64 chunked file upload implementation |
| `downloadFile()` (834-870) | Base64 file download implementation |
| `sleep()` (733-735) | Promise-based delay utility |

### Input Schemas (Zod)

| Schema | Purpose |
|--------|---------|
| `sshExecuteSchema` | Validates command, session_id, timeout, allowFailure |
| `sshNewSessionSchema` | Validates session_id, target |
| `sshOperateSchema` | Validates session_id, target, command, input, execute, get_output, output_delay_ms, clean, timeout |
| `sshCloseSessionSchema` | Validates session_id |
| `sshBufferSchema` | Validates session_id, clean flag |
| `sshUploadSchema` | Validates session_id, local_path, remote_path, timeout |
| `sshDownloadSchema` | Validates session_id, remote_path, local_path, timeout |

---

## Data Flow

### Input Flow
```
Client Request (JSON)
    ↓
Tool Execution Handler (context.moduleManager.registerToolExecution)
    ↓
Raw Args Validation (Zod schema.parse)
    ↓
Handler Function (e.g., handleSshExecute)
    ↓
Session Lookup (getOrCreateSession)
    ↓
Command Execution (executeCommand)
    ↓
Output Processing (filterCommandOutput → cleanOutput)
    ↓
Response (MCP format with content/structuredContent)
```

### Output Flow
```
PTY Process Output (stream)
    ↓
onData handler (session.outputBuffer += data)
    ↓
Buffer trimming (if > MAX_BUFFER_CHARS, slice to last 200K chars)
    ↓
Marker-based extraction in executeCommand()
    ↓
Output filtering (remove echo, prompts, ANSI)
    ↓
Return: { content: [{type: 'text', text: ...}], structuredContent: {...} }
```

---

## Integration

### Module System Integration

The SSH module follows the `IUnifiedPlugin` interface:

1. **onLoad()**: Registers 8 tools with the module manager
2. **onUnload()**: Cleans up all sessions and deregisters tools
3. **Manifest**: Declares plugin ID, name, version, provided features

### How Other Modules/Components Use It

- **Module Manager**: Calls `onLoad()` to register tools, routes tool execution requests to handlers
- **Context Object**: Provides `logger`, `moduleManager` for logging and tool registration
- **No direct imports**: Other modules access SSH functionality through the MCP tool execution interface

### Key Dependencies

| Dependency | Purpose |
|------------|---------|
| `node-pty` | PTY process spawning |
| `zod` | Input validation schemas |
| `IUnifiedPlugin` interface | Plugin contract |
| `UnifiedModuleContext` | Logger, moduleManager access |

---

## Example Workflow: Executing an SSH Command

### Scenario: Client calls `ssh_execute` with `{ command: "ls -la", session_id: "my-session" }`

```
1. REQUEST RECEIVED
   └─> moduleManager routes to handleSshExecute()

2. INPUT VALIDATION
   └─> sshExecuteSchema.parse({ command: "ls -la", session_id: "my-session" })

3. SESSION ACQUISITION (getOrCreateSession)
   └─> Check sessions Map for "my-session"
   └─> Not found → createSession("my-session")
       └─> spawn('/bin/bash', [], { env: {...process.env}, ... })
       └─> Create TerminalSession object
       └─> Store in sessions Map

4. COMMAND EXECUTION (executeCommand)
   └─> session.isReady = false
   └─> session.outputBuffer = ''
   └─> Generate markers: startMarker="===START123456===", etc.
   └─> Write to PTY:
       └─> echo '===START123456==='
       └─> ls -la
       └─> echo '===EXIT123456==='$?
       └─> echo '===END123456==='
   └─> Poll buffer until "===END123456===" appears (timeout: 30s)

5. OUTPUT EXTRACTION
   └─> Find indices of startMarker and endMarker
   └─> Extract substring between markers
   └─> filterCommandOutput() removes:
       └─> Command echo ("ls -la")
       └─> Shell prompts (❯, $, >, #)
       └─> Duplicate lines
   └─> cleanOutput() removes ANSI sequences

6. RESPONSE
   └─> Parse exit code from exitMarker
   └─> Return:
       {
         content: [{ type: 'text', text: 'total 32\ndrwxr-xr-x 5 user user 4096 ...' }],
         structuredContent: { sessionId, command, exitCode: 0, durationMs: 156 }
       }

 7. SESSION STATE
    └─> session.isReady = true
    └─> session.lastCommand = "ls -la"
```

---

## Example Workflow: Using `ssh_operate` (Unified Tool)

### Scenario: Create session and execute command in one call

```
Client calls ssh_operate with:
{
  target: { host: "server.example.com", user: "admin", port: 22 },
  command: "uname -a",
  get_output: true,
  clean: true
}
```

```
1. REQUEST RECEIVED
   └─> moduleManager routes to handleSshOperate()

2. INPUT VALIDATION
   └─> sshOperateSchema.parse({ target, command, get_output, clean })

3. SESSION CREATION (no session_id provided)
   └─> Generate session ID: "session_{timestamp}"
   └─> createSession() spawns SSH PTY to remote host
   └─> Wait 500ms for connection

4. COMMAND EXECUTION
   └─> executeCommand() runs "uname -a" via PTY
   └─> Extracts output between markers
   └─> Returns exit code and output

5. OUTPUT RETRIEVAL (get_output: true)
   └─> Wait output_delay_ms (default 500ms)
   └─> Get buffer content
   └─> cleanOutput() removes ANSI sequences

6. RESPONSE
   └─> formatSshOperateText() formats output:
   └─> Return:
   {
     content: [{ type: 'text', text: 'Linux server 5.4.0 #1 SMP...' }],
     structuredContent: {
       session_id: "session_1234567890",
       session_created: true,
       target: { host: "server.example.com", port: 22, user: "admin" },
       command: "uname -a",
       exit_code: 0,
       output: "Linux server 5.4.0..."
     }
   }
```

### Scenario: Using existing session

```
Client calls ssh_operate with:
{
  session_id: "my-session",
  command: "df -h",
  get_output: true
}
```

- Session is retrieved from sessions Map
- Command is executed in existing session
- Output is returned without creating new session

---

## Error Handling

The SSH module uses standardized error responses with error codes and recovery suggestions. See [ERROR_HANDLING.md](./ERROR_HANDLING.md) for detailed documentation.

### Common Error Codes

| Error Code | Description |
|------------|-------------|
| `SESSION_NOT_FOUND` | Session does not exist |
| `SESSION_BUSY` | Session is executing another command |
| `SESSION_EXISTS` | Session with same ID already exists |
| `CONNECTION_FAILED` | Cannot connect to SSH server |
| `AUTHENTICATION_FAILED` | SSH authentication failed |
| `COMMAND_TIMEOUT` | Command execution timed out |

### Example Error Response

```
Error: Session my-session not found
Code: SESSION_NOT_FOUND
Details:
  tool: ssh_execute
  sessionId: my-session

Suggestion: Create a new session using ssh_new_session or provide target in ssh_operate
```

---

## Known Issues

| Issue | Location | Severity |
|-------|----------|----------|
| Full `process.env` passed to PTY | Lines 586-592 | High - leaks secrets |
| No rate limiting | HTTP transport | High |
| Unbounded output buffer | Line 606-608 | Medium - only trims to 200K |
| Shell argument injection possible | Lines 629-635 | Medium - markers could be manipulated |
| File transfer uses /tmp | Line 798 | Low - security consideration |
