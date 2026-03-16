# Infected MCP Server - Codebase Analysis

**Project:** @_nazmiforreal/infected  
**Version:** 9.4.0  
**Type:** Modular Model Context Protocol (MCP) Server  
**Author:** HYPER12755 (GitHub)  
**License:** ISC

---

## 📊 Project Overview

**Infected** is a unified, enterprise-grade MCP server that empowers AI agents with:
- Shell command execution (foreground, background, detached, adaptive modes)
- Filesystem operations with security validation
- Persistent memory (knowledge graphs)
- Sequential reasoning (chain-of-thought)
- HTTP fetching and web scraping
- SSH terminal sessions with PTY support

### Why "Infected"?
The name suggests the server "infects" an AI agent with capabilities—transforming it from a passive language model into an active agent capable of real-world interactions.

---

## 📁 Codebase Statistics

- **Total TypeScript Files:** 81
- **Total Lines of Code:** ~23,734
- **Language:** TypeScript (compiled to JavaScript)
- **Main Output:** `dist/index.js` (ESM module)

---

## 🏗️ Architecture Overview

### Directory Structure

```
infected/
├── src/                       # TypeScript source code (81 files)
│   ├── auth/                  # Authentication & token generation
│   ├── cli/                   # CLI commands (configure, plugin management)
│   ├── config/                # Configuration management & schema
│   ├── core/                  # Core infrastructure (26 files)
│   │   ├── module-system/     # Module loader, manager, watcher
│   │   ├── managers.ts        # Service managers container
│   │   ├── logger.ts          # Winston-based logging
│   │   ├── permission-manager.ts    # Access control
│   │   ├── process-manager.ts       # Child process handling
│   │   ├── terminal-manager.ts      # PTY terminal sessions
│   │   ├── tool-loader.ts    # Dynamic tool loading
│   │   ├── tool-cache-manager.ts    # Tool caching
│   │   └── ... (more managers)
│   ├── executor/              # Server execution engine
│   ├── modules/               # Built-in capability modules (7 total)
│   │   ├── shell/             # 12 shell execution tools
│   │   ├── filesystem/        # 14 file operation tools
│   │   ├── memory/            # 9 persistent memory tools
│   │   ├── sequentialthinking/# Chain-of-thought reasoning
│   │   ├── fetch/             # HTTP client
│   │   ├── ssh/               # Remote terminal
│   │   └── system/            # System info
│   ├── security/              # Security evaluation & validation
│   │   ├── enhanced-evaluator.ts    # LLM-powered command evaluation
│   │   ├── manager.ts         # Security orchestration
│   │   ├── security-tools.ts  # Validation helpers
│   │   └── ...
│   ├── transports/            # Communication protocols
│   │   ├── stdio.ts           # Standard I/O transport
│   │   ├── http.ts            # HTTP API transport
│   │   ├── sse.ts             # Server-Sent Events
│   │   └── websocket.ts       # WebSocket support
│   ├── types/                 # TypeScript type definitions
│   └── utils/                 # Utility functions
├── tools/                     # Custom tools (GitHub integration)
├── plugins/                   # Plugin system support
├── docs/                      # Comprehensive documentation
├── dist/                      # Compiled JavaScript output
└── package.json               # Dependencies & scripts
```

---

## 🔌 Core Modules (7 Built-in Modules)

### 1. **Shell Module** (`src/modules/shell/`)
**Purpose:** Execute arbitrary shell commands with multiple execution modes

**Key Files:**
- `shell-tools.ts` - Tool definitions (12 tools)
- `main.ts` - Core execution logic
- `schemas.ts` - Zod input validation schemas
- `entrypoint.ts` - Module initialization

**Tools Include:**
- `shell_execute()` - Execute command in foreground
- `shell_background()` - Execute in background
- `shell_detached()` - Execute detached from parent
- `shell_adaptive()` - Smart mode selection
- `shell_command_history()` - Retrieve past commands
- `terminal_create_session()` - Create PTY session
- `terminal_send_input()` - Send data to terminal
- Plus more...

**Execution Modes:**
- Foreground: Blocks until complete
- Background: Returns immediately
- Detached: Parent-independent process
- Adaptive: Automatically selects best mode

---

### 2. **Filesystem Module** (`src/modules/filesystem/`)
**Purpose:** Secure file and directory operations with sandboxing

**Key Files:**
- `index.ts` - Module interface
- `filesystem-helpers.ts` - Core file operations
- `path-validation.ts` - Security boundary checking
- `path-utils.ts` - Path manipulation
- `roots-utils.ts` - Root directory management

**Tools Include:**
- `file_read()` - Read file contents
- `file_write()` - Write/create files
- `file_edit()` - Edit with find-replace
- `file_copy()`, `file_move()`, `file_delete()`
- `directory_list()` - List with sizes
- `directory_tree()` - Recursive tree view
- `glob_search()` - Pattern matching
- Path validation & sandboxing

**Security Features:**
- Configurable root directories (sandboxing)
- Path traversal prevention
- Allowed extensions filtering
- Symlink safety checks

---

### 3. **Memory Module** (`src/modules/memory/`)
**Purpose:** Persistent knowledge graph storage

**Key Files:**
- `index.ts` - Module interface
- `memory-core.ts` - Storage implementation
- `memory.jsonl` - Persistent data file

**Entity-Relation-Observation Model:**
```
Entity --[relation]--> Entity (observation)
```

**Tools Include:**
- `memory_add_entity()` - Create/update entities
- `memory_add_relation()` - Define entity relationships
- `memory_add_observation()` - Store observations
- `memory_search()` - Full-text search
- `memory_query()` - Structured queries
- `memory_clear()` - Reset memory

**Storage:**
- JSONL format (JSON Lines - one JSON object per line)
- Persistent across sessions
- Full search capabilities

---

### 4. **Sequential Thinking Module** (`src/modules/sequentialthinking/`)
**Purpose:** Chain-of-thought reasoning and step-by-step problem solving

**Key Features:**
- Thought tracking and revision
- Branch exploration
- Progress notifications
- Structured reasoning flow

---

### 5. **Fetch Module** (`src/modules/fetch/`)
**Purpose:** HTTP requests and web content retrieval

**Features:**
- REST API integration
- Web scraping support
- Custom headers
- Request body support
- Content type handling

---

### 6. **SSH Module** (`src/modules/ssh/`)
**Purpose:** Remote system access via SSH

**Features:**
- Persistent PTY sessions
- Command execution on remote hosts
- File upload/download
- Session management

---

### 7. **System Module** (`src/modules/system/`)
**Purpose:** System information retrieval

**Features:**
- OS information
- Environment variables
- System metrics

---

## 🔐 Security Architecture

### Security Manager (`src/security/`)
The server implements **multi-layer security**:

**Components:**
1. **Enhanced Evaluator** (`enhanced-evaluator.ts`)
   - LLM-powered command validation
   - Risk assessment using Claude/GPT
   - Context-aware permission checking

2. **Permission Manager** (`src/core/permission-manager.ts`)
   - Role-based access control (RBAC)
   - API key authentication
   - Token generation & validation

3. **Validator Criteria Manager**
   - Configurable validation rules
   - Dangerous command detection
   - Pattern-based filtering

4. **Security Tools** (`security-tools.ts`)
   - Sanitization utilities
   - Validation helpers

### Security Flow
```
User Request
    ↓
API Key Validation
    ↓
Permission Check
    ↓
Command Parsing
    ↓
LLM Evaluation (if dangerous)
    ↓
Execution or Denial
```

---

## 🎯 Core Infrastructure

### Service Container (`src/core/service-container.ts`)
Implements **Dependency Injection** pattern:
- Centralized service management
- Singleton instances
- Service lifecycle management

### Manager Classes (in `src/core/`)

| Manager | Purpose |
|---------|---------|
| **Tool Loader** | Dynamically load tool definitions |
| **Tool Cache Manager** | Cache tool metadata and schemas |
| **Permission Manager** | Control access to resources |
| **Process Manager** | Manage child processes |
| **Terminal Manager** | Handle PTY sessions |
| **Plugin Loader** | Load external plugins |
| **Plugin Watcher** | Hot-reload plugins on file changes |
| **Module Loader** | Load capability modules |
| **Module Manager** | Organize modules |
| **Module Watcher** | Hot-reload modules |
| **Monitoring Manager** | Monitor system health |
| **Shell Config Manager** | Shell environment setup |
| **File Manager** | File operation orchestration |
| **Enhanced History Manager** | Command history with analytics |

---

## 🔄 Transport Layers (`src/transports/`)

The server supports **4 transport protocols**:

### 1. STDIO (`stdio.ts`)
- Standard input/output
- Local process communication
- Used by Claude/AI applications

### 2. HTTP (`http.ts`)
- REST API over HTTP
- Network accessible
- Express-based server

### 3. SSE (`sse.ts`)
- Server-Sent Events
- Real-time streaming
- Unidirectional from server

### 4. WebSocket (`websocket.ts`)
- Bidirectional communication
- Real-time interactive sessions
- Low-latency updates

---

## 🛠️ Configuration System

### ConfigManager (`src/config/index.ts`)
**Handles:**
- `infected.config.json` parsing
- Environment variable override
- Config validation with Zod

**Example Config:**
```json
{
  "security": {
    "enableLLMEvaluation": true,
    "apiKeyAuth": "enabled",
    "dangerousCommands": ["rm -rf", "sudo"]
  },
  "modules": {
    "shell": { "enabled": true },
    "filesystem": {
      "enabled": true,
      "roots": ["/home/user", "/tmp"]
    }
  },
  "plugins": {
    "autoLoad": true,
    "directory": "./plugins"
  }
}
```

---

## 📚 Module System

### How Modules Work
1. **Module Definition** - Each module exports a `Module` interface
2. **Tool Registration** - Tools are registered with MCP
3. **Dynamic Loading** - `ModuleLoader` discovers and loads modules
4. **Hot Reloading** - `ModuleWatcher` watches for file changes
5. **Plugin Integration** - Modules can be extended via plugins

### Module Structure (e.g., Shell Module)
```typescript
export const ShellModule = {
  name: 'shell',
  description: 'Shell execution capabilities',
  tools: [
    {
      name: 'shell_execute',
      description: 'Execute command in foreground',
      inputSchema: { ... }
    },
    // ... more tools
  ]
}
```

---

## 🔧 Tool System

### Tool Definition
Each tool is defined with:
- **Name** - Tool identifier
- **Description** - Human-readable purpose
- **Input Schema** - Zod validation schema (turned into JSON Schema)
- **Handler** - Async function that executes the tool

### Tool Loading Pipeline
```
Tool Definition
    ↓
Schema Compilation (Zod → JSON Schema)
    ↓
Cache Storage (Tool Cache Manager)
    ↓
MCP Registration
    ↓
Available to AI Agents
```

### Tool Error Handling (`src/core/tool-error.ts`)
- Custom error types
- Error serialization
- Stack trace handling

---

## 🔌 Plugin System

### Plugin Architecture
- Located in `plugins/` directory
- Support hot-reloading
- Can extend existing modules
- Export standard plugin interface

### Example Plugin Structure
```
plugins/
├── test-plugin/
│   ├── index.js
│   └── module.json
```

### Plugin CLI
- `infected plugin add <name>` - Add plugin
- `infected plugin remove <name>` - Remove plugin
- Automatic discovery and loading

---

## 🚀 Server Execution (`src/executor/server.ts`)

### InfectedServer Class
**Responsibilities:**
1. Initialize all managers
2. Load modules and tools
3. Setup transport layers
4. Start listening on configured ports
5. Handle incoming requests
6. Execute tools
7. Return responses

### Startup Flow
```
InfectedServer.start()
    ↓
Load Configuration
    ↓
Initialize Managers
    ↓
Load Modules
    ↓
Load Plugins
    ↓
Setup Transports
    ↓
Start Listening
    ↓
Server Ready
```

---

## 📊 Data Storage

### Persistent Storage Locations
1. **Memory Module** - `memory.jsonl` (JSONL format)
2. **Config** - `infected.config.json` (JSON)
3. **History** - Optional history file (JSON)
4. **Logs** - `logs/` directory (rotating logs)

### JSONL Format
```jsonl
{"entity": "user", "name": "Alice", "timestamp": "2024-03-13"}
{"entity": "conversation", "id": "c1", "date": "2024-03-13"}
{"relation": {"from": "user", "to": "conversation", "type": "participated"}}
```

---

## 🌐 API Endpoints (HTTP Transport)

### Health Check
```
GET /health
→ { "status": "operational" }
```

### Tool Listing
```
GET /tools
→ [ { "name": "shell_execute", "description": "...", ... } ]
```

### Tool Execution
```
POST /execute
Body: { "toolName": "shell_execute", "arguments": { "command": "ls" } }
→ { "result": "...", "exitCode": 0 }
```

### Events/Streaming
```
GET /events (Server-Sent Events)
→ Real-time progress updates
```

---

## 🔄 Real-time Streaming

### Stream Publisher (`src/core/stream-publisher.ts`)
- Broadcast messages to multiple subscribers
- Real-time command output
- Progress notifications

### Real-time Stream Subscriber (`src/core/realtime-stream-subscriber.ts`)
- Listen to streaming events
- Process large command output efficiently

### Streaming Pipeline Reader (`src/core/streaming-pipeline-reader.ts`)
- Parse streaming data
- Buffer management
- Flow control

---

## 📝 Logging System

### Logger (`src/core/logger.ts`)
Uses **Winston** logging library:
- Multiple log levels (debug, info, warn, error)
- Console output
- File output to `logs/` directory
- Configurable via `LOG_LEVEL` env var

### Log Event Emitter (`src/core/log-event-emitter.ts`)
- Emit log events for external consumption
- Subscribe to specific log levels
- Event-driven logging

---

## 🛡️ Error Handling

### Error Types
- **ToolError** - Tool execution failures
- **ValidationError** - Input schema violations
- **SecurityError** - Permission denials
- **ProcessError** - Shell execution errors
- **FileSystemError** - FS operation failures

### Error Response Format
```json
{
  "error": "Command failed",
  "code": "EACCES",
  "details": "Permission denied",
  "context": { "command": "rm -rf /" }
}
```

---

## 🎨 Type System

### Core Types (`src/types/`)
- **MCP Types** - Model Context Protocol interfaces
- **Tool Types** - Tool definitions and handlers
- **Transport Types** - Request/response contracts
- **Module Types** - Module interfaces
- **Shell Server Types** - Enhanced shell-specific types

### Zod Schemas
Used for **runtime validation**:
- Input validation
- Config validation
- Type safety at runtime

---

## 🚀 Development & Building

### Available Scripts
```bash
npm run dev              # Development mode with hot-reload
npm run build           # Compile TypeScript to JavaScript
npm run start           # Production start (backgrounded)
npm run pack            # Build and create tarball
npm run publish:npm     # Build and publish to npm
```

### Environment Variables
```
INFECTED_RUNTIME_MODE=development|production
LOG_LEVEL=debug|info|warn|error
NODE_OPTIONS=--enable-source-maps
```

### TypeScript Configuration
- Target: ES2020
- Module: ESNext
- Source maps enabled for debugging
- Strict mode enabled

---

## 📦 Dependencies

### Key Dependencies
| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `express` | HTTP server framework |
| `axios` | HTTP client |
| `node-pty` | PTY terminal sessions |
| `cheerio` | HTML parsing |
| `jsdom` | DOM simulation |
| `winston` | Logging |
| `zod` | Runtime validation |
| `chokidar` | File watching (hot-reload) |
| `uuid` | Unique ID generation |
| `ws` | WebSocket support |

---

## 🔍 Code Quality & Patterns

### Design Patterns Used
1. **Dependency Injection** - Service Container pattern
2. **Factory Pattern** - Module/Plugin loading
3. **Singleton Pattern** - Managers
4. **Observer Pattern** - Event emitters
5. **Strategy Pattern** - Multiple execution modes
6. **Adapter Pattern** - Multiple transports

### Best Practices
- ✅ TypeScript for type safety
- ✅ Async/await for async operations
- ✅ Error handling with custom error types
- ✅ Configuration management
- ✅ Logging throughout
- ✅ Input validation with Zod
- ✅ Hot-reloading support

---

## 🎯 Use Cases

### 1. **AI Agent Execution Environment**
- Claude, ChatGPT, or custom LLMs need to execute commands
- Infected provides unified interface to all capabilities

### 2. **Development Automation**
- Run tests, builds, deployments via AI commands
- Real-time output streaming

### 3. **Remote Administration**
- SSH module for remote system management
- Terminal sessions with persistent state

### 4. **Knowledge Management**
- Memory module for conversation persistence
- Entity-relation graphs for reasoning

### 5. **Content Processing**
- Fetch module for web scraping
- Filesystem operations for batch processing

### 6. **Security & Auditing**
- Command evaluation before execution
- Permission-based access control
- Full audit logging

---

## 📈 Performance Features

### Caching
- **Tool Cache Manager** - Cache tool definitions
- Reduces repeated lookups
- Faster tool resolution

### Streaming
- Real-time output for long-running commands
- Memory-efficient processing of large data
- Progress notifications

### Adaptive Execution
- Shell module adapts execution mode based on command
- Optimizes for foreground vs background vs detached
- Reduces resource waste

### Process Management
- Tracks child processes
- Prevents zombie processes
- Resource cleanup

---

## 🔮 Future Extensibility

### Custom Modules
Developers can create new modules following the same pattern:
```typescript
export const CustomModule = {
  name: 'custom',
  tools: [ /* tool definitions */ ]
}
```

### Custom Tools
Tools can be added dynamically via:
1. Plugin system
2. Module extensions
3. Custom module creation

### Custom Transports
New transport protocols can be implemented by following the transport interface.

---

## 🎓 Learning Resources

### Documentation Files
- `GUIDE.md` - Getting started
- `SHELL.md` - Shell module deep-dive
- `FILESYSTEM.md` - Filesystem operations
- `MEMORY.md` - Memory module usage
- `SSH.md` - SSH configuration
- `ERROR_HANDLING.md` - Error patterns
- `REALTIME-OUTPUT.md` - Streaming features
- `API_ENDPOINTS.md` - HTTP API reference

---

## 📋 Summary

**Infected** is a **mature, production-ready MCP server** that provides:

✅ **Comprehensive Capabilities** - 7 built-in modules with 60+ tools  
✅ **Security-First Design** - LLM evaluation, RBAC, token auth  
✅ **Enterprise Features** - Logging, monitoring, hot-reload  
✅ **High Performance** - Streaming, caching, adaptive execution  
✅ **Extensible Architecture** - Plugins, custom modules, tools  
✅ **Multiple Transports** - STDIO, HTTP, SSE, WebSocket  
✅ **Type Safe** - TypeScript + Zod validation  

**Perfect for:** Building AI agents, automation platforms, remote management systems.

---

*Analysis generated: 2024-03-13*  
*Codebase version: 9.4.0*
