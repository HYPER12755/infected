# Infected MCP Server - Project Context

## ⚠️ CRITICAL: Termux Shell Safety (READ FIRST)

**If you are running this server in Termux (Android):**

### 🚫 DO NOT use AI's built-in shell tool to run commands!
- The AI's internal shell execution can crash Termux
- Use the MCP server's `ShellExecute` tool instead (via HTTP/MCP)
- Or run commands manually in your terminal

### ✅ Safe Alternatives for Termux Users:
1. **Use MCP client** to call `ShellExecute` tool (not AI's internal shell)
2. **Run commands manually** in Termux terminal
3. **Use web interface** if available

### 📋 If You Must Use AI Shell in Termux:
- Only short commands: `ls`, `cat`, `pwd`, `git status`
- Limit output: `command | head -20`
- Set timeout: `timeout 10 command`
- NEVER: `vim`, `top`, interactive commands, long processes

**Report any crashes immediately so we can update these guidelines!**

---

## 📖 Project Overview

**Infected** is a unified **Model Context Protocol (MCP) Server** that provides AI agents with comprehensive capabilities through a modular architecture. It serves as an "operating system for AI agents" enabling shell execution, filesystem operations, persistent memory, sequential reasoning, HTTP fetching, and SSH connectivity.

### Core Purpose
- Transform AI assistants into fully-capable agents
- Provide standardized MCP interface for multiple operational modules
- Enable real-time command execution with streaming output
- Support extensibility through custom tools and plugins

### Key Technologies
- **Runtime**: Node.js (ES Modules)
- **Language**: TypeScript 5.3+
- **MCP SDK**: @modelcontextprotocol/sdk ^1.26.0
- **HTTP Server**: Express.js
- **Validation**: Zod schemas
- **Logging**: Winston

---

## 🏗️ Architecture

### Directory Structure
```
infected/
├── src/                          # TypeScript source code
│   ├── index.ts                  # CLI entry point
│   ├── server.ts                 # InfectedServer class (main server)
│   ├── cli/                      # CLI tools (configure, plugin-cli)
│   ├── config/                   # Configuration management
│   │   ├── index.ts              # ConfigManager
│   │   └── schema.ts             # Zod validation schemas
│   ├── core/                     # Core infrastructure (27 files)
│   │   ├── module-system/       # Dynamic module loading
│   │   ├── process-manager.ts   # Command execution
│   │   ├── terminal-manager.ts  # PTY sessions
│   │   ├── file-manager.ts      # Output file management
│   │   ├── stream-publisher.ts  # Real-time streaming PUB/SUB
│   │   └── ...
│   ├── modules/                  # Built-in modules (7)
│   │   ├── shell/               # Shell execution (12 tools)
│   │   ├── filesystem/          # File operations (13 tools)
│   │   ├── memory/              # Knowledge graph (9 tools)
│   │   ├── sequentialthinking/  # Chain-of-thought (1 tool)
│   │   ├── fetch/               # HTTP requests (2 tools)
│   │   ├── ssh/                 # SSH sessions (9 tools)
│   │   └── system/              # System info (2 tools)
│   ├── security/                 # Security & permissions
│   ├── transports/               # STDIO, HTTP, SSE, WebSocket
│   ├── types/                    # TypeScript definitions
│   └── utils/                    # Utility functions
├── tools/                        # Custom tools directory
├── plugins/                      # Plugins directory
├── clients/                      # MCP client examples
│   ├── streaming-client.ts      # Streaming demo client
│   ├── test-client.ts           # Simple test client
│   └── gemini-cli.config.json   # Gemini CLI config
├── docs/                         # Documentation
├── dist/                         # Compiled JavaScript output
├── logs/                         # Runtime logs (dev.log, start.log)
└── .infected/                    # Runtime data (memory.jsonl)
```

### Module System
All modules implement the `IUnifiedPlugin` or `Module` interface:
- **Lifecycle**: `onLoad(context)`, `onUnload()`
- **Tool Registration**: `context.moduleManager.registerToolExecution()`
- **Context Access**: Process manager, terminal manager, file manager, security manager

---

## 🚀 Build & Run Commands

### Development
```bash
# Install dependencies
npm install

# Development mode with hot reload
npm run dev

# Build TypeScript
npm run build
# Equivalent to: npm run build:server && npm run build:tools
```

### Production
```bash
# Start production server (background process)
npm start

# Logs written to: logs/start.log
```

### Testing
```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Verbose output
npm run test:verbose
```

### Server Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mcp` | POST/GET | MCP HTTP Stream transport |
| `/sse` | GET/POST | MCP SSE transport |
| `/streaming/sse/:outputId` | GET | Real-time command output streaming |
| `/health` | GET | Health check |
| `/messages` | GET | Get messages (empty array) |

Default port: **3001**

---

## 🛠️ Development Guidelines

### Coding Style
- **Module System**: ES Modules (`import x from '...'`)
- **Quotes**: Single quotes for strings
- **Indentation**: Two spaces
- **Variables**: Prefer `const`, use `let` when reassignment needed
- **Types**: Keep Zod schemas close to handlers

### File Naming
- Source files: `*.ts`
- Test files: `*.test.ts`
- Tools: Grouped by module (e.g., `src/modules/shell/`)

### Commit Messages
Follow Conventional Commits:
```
feat(shell): add real-time progress streaming
fix(ssh): session handling improvements
docs: update README with streaming examples
```

### Branch Strategy
- `development` - Active development
- `stable` - Production-ready releases
- `experimental/*` - Feature experiments

---

## 📦 Available Modules & Tools

### Shell Module (12 tools)
- `ShellExecute` - Execute commands with streaming
- `ShellExecuteStreaming` - Explicit streaming mode
- `ProcessGetExecution` - Get execution status
- `ProcessListExecutions` - List all executions
- `ProcessKill` - Terminate processes
- `TerminalOperate` - Interactive PTY sessions
- `TerminalList` - List terminal sessions
- `TerminalGetInfo` - Get terminal metadata
- `TerminalClose` - Close terminal
- `ListExecutionOutputs` - List output files
- `ReadExecutionOutput` - Read output content
- `DeleteExecutionOutputs` - Clean up outputs

### Filesystem Module (13 tools)
- `ReadFile`, `ReadTextFile`, `ReadMultipleFiles`
- `WriteFile`, `EditFile`
- `CreateDirectory`, `ListDirectory`, `ListDirectoryWithSizes`
- `DirectoryTree`, `MoveFile`, `SearchFiles`
- `GetFileInfo`, `ListAllowedDirectories`

### Memory Module (9 tools)
- `CreateEntities`, `CreateRelations`, `AddObservations`
- `DeleteEntities`, `DeleteObservations`, `DeleteRelations`
- `ReadGraph`, `SearchNodes`, `OpenNodes`

### Other Modules
- **SequentialThinking**: `SequentialThinking` (chain-of-thought)
- **Fetch**: `WebFetch`, `FetchHtml` (HTTP requests)
- **SSH**: `SshOperate`, `SshListSessions`, `SshUploadFile`, etc.
- **System**: `GetSystemInfo`, `NetworkDiagnostics`

**Total: 51 tools** (all renamed to PascalCase)

---

## 🔧 Configuration

### Environment Variables (.env)
```bash
# Server configuration
PORT=3001
MCP_TRANSPORT=http
LOG_LEVEL=info

# Streaming
STREAMING_POLL_INTERVAL_MS=100
STREAMING_HEARTBEAT_INTERVAL_MS=15000

# Execution
EXECUTION_BACKEND=local  # or 'remote'
```

### Main Config (infected.config.json)
```json
{
  "transport": "http",
  "modules": ["shell", "filesystem", "memory", "sequentialthinking", "fetch", "ssh", "system"],
  "port": 3001,
  "hotReload": true,
  "auth": {
    "enabled": false,
    "apiKey": []
  },
  "permissions": {
    "defaultPolicy": "allow"
  },
  "streaming": {
    "pollIntervalMs": 100,
    "heartbeatIntervalMs": 15000
  }
}
```

---

## 🌊 Real-Time Streaming

### MCP Progress Notifications (Standard)
Tools can stream output during execution using MCP progress tokens:

```typescript
// Server sends progress during execution
server.server.notification({
  method: 'notifications/progress',
  params: {
    progressToken,
    progress: {
      type: 'output',
      data: 'Compiling file1.ts...',
      isStderr: false,
      timestamp: new Date().toISOString()
    }
  }
});
```

### SSE Streaming Endpoint (Custom Extension)
For continuous streaming, clients poll `/streaming/sse/{output_id}`:

**Event Types:**
- `output` - Real-time stdout/stderr
- `heartbeat` - Keep-alive signal
- `complete` - Command finished with exit code

**Client Flow:**
1. Execute command via MCP → Get `output_id`
2. Poll `/streaming/sse/{output_id}` → Receive SSE events
3. Process events in real-time
4. Stop on `complete` event

---

## 🔐 Security Features

### Authentication
- API key-based (single or multiple keys)
- Random token generation for sessions
- Header: `X-API-Key` or `Authorization: Bearer`

### Permission System
- Default policy: `allow` or `deny`
- Tool allowlists/blocklists
- Command allowlist for shell

### LLM Security
- AI-powered command evaluation
- Safe/unsafe command classification
- Elicitation for dangerous commands

### Filesystem Sandboxing
- Allowed directories only
- Path validation
- Binary file detection

---

## 🧪 Testing Practices

### Test Structure
```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('ModuleName', () => {
  beforeEach(() => {
    // Setup
  });

  it('should do something', async () => {
    // Test logic
    assert.equal(actual, expected);
  });
});
```

### Running Tests
```bash
# All tests
npm test

# Specific test file
node --test --import tsx tests/unit/module.test.ts

# Watch mode
npm run test:watch
```

---

## 📚 Key Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | Project overview and quick start |
| `AGENTS.md` | Repository guidelines |
| `docs/GUIDE.md` | Developer guide for tools/plugins |
| `docs/STRUCTURE.md` | Complete architecture |
| `docs/CONFIGURATION_EXAMPLES.md` | Config examples |
| `clients/README.md` | Streaming client documentation |
| `clients/HOW-STREAMING-WORKS.md` | Streaming architecture explained |

---

## 🎯 Common Tasks

### Add a New Tool
1. Create file in `tools/my-tool/index.ts`
2. Implement `IUnifiedTool` interface
3. Define Zod input schema
4. Implement `execute()` method
5. Tool auto-loads with hot reload

### Add a New Plugin
1. Create directory in `plugins/my-plugin/`
2. Implement `IUnifiedPlugin` interface
3. Register tools in `onLoad(context)`
4. Plugin auto-loads with hot reload

### Modify Existing Module
1. Edit source in `src/modules/<module>/`
2. Run `npm run build` to compile
3. Test with `npm test`
4. Commit with conventional message

### Debug Runtime Issues
```bash
# Check logs
tail -f logs/dev.log

# Enable debug logging
LOG_LEVEL=debug npm run dev

# Kill stuck server
npx kill-port 3001
```

---

## 🚨 Important Notes

### Memory Constraints
- Build process can be memory-intensive
- If encountering OOM errors:
  - Close unnecessary applications
  - Build individual modules: `npx tsc src/modules/shell/index.ts`
  - Use development mode: `npm run dev` (no build needed)

### Streaming Limitations
- Most MCP clients don't poll streaming endpoints
- For real-time output, use MCP progress notifications
- Custom clients required for full streaming support

### Branch Management
- `development` - Active work
- `stable` - Production releases
- `experimental/*` - Feature experiments (e.g., `experimental/progress-streaming`)

### ⚠️ Termux Shell Tool Restrictions (CRITICAL)
**When using shell tools on Termux, ALWAYS follow these rules to prevent crashes:**

1. **NEVER use terminal/PTY features:**
   - ❌ `create_terminal: true`
   - ❌ `TerminalOperate` tool
   - ❌ `terminal_shell`, `terminal_dimensions` parameters

2. **Use only safe execution modes:**
   - ✅ `execution_mode: "foreground"` (safe)
   - ✅ `execution_mode: "background"` (safe)
   - ❌ `execution_mode: "adaptive"` (may create PTY)
   - ❌ `execution_mode: "detached"` (may create PTY)

3. **Recommended shell commands for AI:**
   ```json
   {
     "name": "ShellExecute",
     "arguments": {
       "command": "ls -la",
       "execution_mode": "foreground",
       "create_terminal": false,
       "timeout_seconds": 30
     }
   }
   ```

4. **If Termux crashes, add to client config:**
   ```json
   {
     "shellConfig": {
       "disableTerminalSessions": true,
       "disablePTY": true,
       "allowedExecutionModes": ["foreground", "background"]
     }
   }
   ```

5. **Safe commands for Termux:**
   - ✅ File operations: `ls`, `cat`, `cp`, `mv`, `rm`
   - ✅ Package management: `pkg install`, `npm install`
   - ✅ Text processing: `grep`, `sed`, `awk`
   - ❌ Avoid: Interactive commands (`vim`, `top`, `htop`)
   - ❌ Avoid: Long-running daemons without background mode

---

## 📞 Quick Reference

| Task | Command |
|------|---------|
| Start dev server | `npm run dev` |
| Build project | `npm run build` |
| Run tests | `npm test` |
| Start production | `npm start` |
| Check health | `curl localhost:3001/health` |
| View logs | `tail -f logs/dev.log` |
| Kill server | `npx kill-port 3001` |

---

## 🤖 AI Assistant Instructions

### ⚠️ CRITICAL: Termux Shell Usage (Prevent Crashes)

**When running commands in Termux environment:**

1. **Use short, non-interactive commands only**
   - ✅ `ls -la`, `cat file.txt`, `pwd`
   - ✅ `git status`, `npm install`
   - ❌ `vim`, `nano`, `top`, `htop` (interactive)
   - ❌ Long-running processes without timeout

2. **Limit output size**
   - Use `head`, `tail`, `less` for long outputs
   - Example: `ls -la | head -20` instead of `ls -la`
   - Example: `cat file.txt | head -50`

3. **Set timeouts**
   - Always specify timeout for commands
   - Default: 30 seconds max for Termux

4. **Avoid these crash-causing patterns:**
   - ❌ Commands with huge output (`find / -name "*.txt"`)
   - ❌ Infinite loops or watchers
   - ❌ Commands that spawn child processes
   - ❌ PTY-requiring commands

5. **Safe command template:**
   ```bash
   # Good: Limited, fast command
   ls -la | head -20
   
   # Good: With timeout
   timeout 10 npm install
   
   # Bad: Unlimited output
   find / -type f
   
   # Bad: Interactive
   vim config.json
   ```

6. **Before running command, check:**
   - [ ] Is this command safe for Termux?
   - [ ] Will output be too large?
   - [ ] Does it require PTY/interactive?
   - [ ] Is there a safer alternative?

7. **If user reports crash:**
   - Apologize immediately
   - Ask for the exact command that crashed
   - Suggest safer alternative
   - Add command to "avoid" list

### General Shell Tool Usage (Non-Termux)

**ALWAYS use this safe pattern:**
```json
{
  "name": "ShellExecute",
  "arguments": {
    "command": "your-command",
    "execution_mode": "foreground",
    "create_terminal": false,
    "timeout_seconds": 30,
    "capture_stderr": true
  }
}
```

**NEVER use:**
- `create_terminal: true`
- `TerminalOperate` tool
- `execution_mode: "adaptive"` or `"detached"`
- Interactive commands (`vim`, `nano`, `top`)

**If unsure, ask user first:**
> "I need to run a shell command. On Termux, I'll use foreground mode without terminal to avoid crashes. Proceed?"

### Safe Command Examples for Termux

```bash
# ✅ Safe: List files
ShellExecute("ls -la", { execution_mode: "foreground" })

# ✅ Safe: Check git status
ShellExecute("git status", { execution_mode: "foreground" })

# ✅ Safe: Install packages
ShellExecute("npm install", { execution_mode: "foreground", timeout_seconds: 300 })

# ❌ UNSAFE: Don't use
ShellExecute("vim file.txt", { create_terminal: true })  # Will crash!
```

---

**Last Updated**: Based on development branch with PascalCase tool names and streaming client support.
