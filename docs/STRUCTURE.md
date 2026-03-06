# Project Structure: @infected/infected Unified MCP Server

This document outlines the architecture and file organization of the `@infected/infected` unified Model Context Protocol (MCP) server. The server is designed to be modular, extensible, and production-ready, integrating functionalities from multiple original MCP servers.

---

## Complete Directory Tree

```
infected/                                    # Project root
├── .env.example                           # Environment variables template
├── .gitignore                             # Git ignore rules
├── README.md                              # Project documentation
├── index.js                               # CLI entry point (compiled shim)
├── infected.config.json                   # Runtime configuration
├── infected.config.json.example           # Configuration template
├── package.json                           # npm package (MCP server)
├── package-lock.json                      # Dependency lock file
├── tsconfig.json                          # TypeScript config for server
├── tsconfig.tools.json                    # TypeScript config for tools
├── git+gh.md                             # GitHub integration docs
├── docs/                                  # Documentation
│   ├── STRUCTURE.md                       # This file
│   ├── GUIDE.md                          # Plugin & tool creation guide
│   ├── CONFIGURATION_EXAMPLES.md
│   ├── API_ENDPOINTS.md
│   ├── MCP_SERVER.md
│   ├── OFFICIAL_MCP_SDK_OVERVIEW.md
│   ├── SEQUENTALTHINKING.md
│   ├── MEMORY.md
│   ├── SHELL.md
│   ├── FILESYSTEM.md
│   ├── SSH.md
│   └── ...
├── src/                                   # Source code
│   ├── index.ts                          # Main entry point (CLI)
│   ├── server.ts                         # InfectedServer class
│   ├── cli/                              # CLI utilities
│   │   ├── configure.ts                  # Interactive config wizard
│   │   └── plugin-cli.ts                 # Plugin CLI manager
│   ├── config/                           # Configuration
│   │   ├── index.ts                     # ConfigManager
│   │   └── schema.ts                    # Zod schemas
│   ├── auth/                             # Authentication
│   │   ├── index.ts                     # Auth middleware
│   │   └── random-token-generator.ts    # Token generation
│   ├── core/                             # Core functionality (27 files)
│   │   ├── module-system/               # Module system
│   │   │   ├── module-manager.ts        # Module orchestration
│   │   │   ├── module-types.ts          # Type definitions
│   │   │   └── module-watcher.ts        # Hot reload watcher
│   │   ├── managers.ts                  # Manager exports
│   │   ├── logger.ts                    # Winston logger
│   │   ├── log-event-emitter.ts        # Log events
│   │   ├── log-broadcast-manager.ts     # Log broadcasting
│   │   ├── service-container.ts         # DI container
│   │   ├── module-loader.ts             # Module loader
│   │   ├── tool-loader.ts               # Tool loader
│   │   ├── tool-cache-manager.ts        # Tool caching
│   │   ├── plugin-loader.ts             # Plugin loader
│   │   ├── plugin-watcher.ts           # Plugin hot reload
│   │   ├── monitoring-manager.ts        # System monitoring
│   │   ├── process-manager.ts           # Process execution
│   │   ├── terminal-manager.ts         # PTY sessions
│   │   ├── permission-manager.ts        # Permissions
│   │   ├── file-manager.ts             # File operations
│   │   ├── file-storage-subscriber.ts  # File events
│   │   ├── enhanced-history-manager.ts # Command history
│   │   ├── shell-config-manager.ts      # Shell config
│   │   ├── remote-process-service.ts   # Remote execution
│   │   ├── remote-http-client.ts       # Remote HTTP
│   │   ├── realtime-stream-subscriber.ts
│   │   ├── stream-publisher.ts         # Stream pub/sub
│   │   ├── streaming-pipeline-reader.ts
│   │   └── executor/
│   │       └── server.ts               # Isolated executor
│   ├── modules/                         # Built-in modules (6)
│   │   ├── shell/                      # Shell execution
│   │   │   ├── index.ts
│   │   │   ├── main.ts
│   │   │   ├── entrypoint.ts
│   │   │   ├── shell-tools.ts
│   │   │   └── schemas.ts
│   │   ├── filesystem/                 # File operations
│   │   │   ├── index.ts
│   │   │   ├── lib.ts
│   │   │   ├── types.ts
│   │   │   ├── helpers.ts
│   │   │   ├── filesystem-helpers.ts
│   │   │   ├── path-utils.ts
│   │   │   ├── path-validation.ts
│   │   │   ├── roots-utils.ts
│   │   │   └── errors.ts
│   │   ├── memory/                      # Knowledge graph
│   │   │   ├── index.ts
│   │   │   ├── memory-core.ts
│   │   │   └── memory.jsonl
│   │   ├── sequentialthinking/          # Chain of thought
│   │   │   ├── index.ts
│   │   │   └── lib.ts
│   │   ├── fetch/                       # HTTP fetch
│   │   │   └── index.ts
│   │   └── ssh/                         # SSH sessions
│   │       └── index.ts
│   ├── security/                        # Security
│   │   ├── manager.ts                   # SecurityManager
│   │   ├── enhanced-evaluator.ts        # LLM evaluator
│   │   ├── security-tools.ts
│   │   ├── validator-criteria-manager.ts
│   │   ├── evaluator-types.ts
│   │   ├── security-llm-prompt-generator.ts
│   │   └── chat-completion-adapter.ts
│   ├── transports/                       # Transport layer
│   │   ├── stdio.ts                    # STDIO transport
│   │   ├── http.ts                      # HTTP REST
│   │   └── sse.ts                       # Server-Sent Events
│   ├── types/                           # TypeScript types
│   │   ├── index.ts
│   │   └── shell-server/
│   │       ├── index.ts
│   │       ├── schemas.ts
│   │       ├── response-schemas.ts
│   │       ├── quick-schemas.ts
│   │       └── enhanced-security.ts
│   └── utils/                           # Utilities
│       ├── common-helpers.ts
│       ├── server-helpers.ts
│       ├── shell-helpers.ts
│       ├── shell-errors.ts
│       ├── process-utils.ts
│       ├── criteria-manager.ts
│       ├── json-repair.ts
│       └── runtime-roots.ts
├── tools/                                # External tools
│   └── github/
│       ├── index.ts
│       └── index.js
├── plugins/                              # Plugin directory
│   └── test-plugin/
│       ├── index.ts
│       └── module.json
└── dist/                                 # Compiled output
    └── (mirrors src/ structure)
```

---

## Top-Level Files

| File | Description |
|------|-------------|
| `.env.example` | Environment variables template (API keys, ports, paths, LLM config) |
| `index.js` | CLI entry point shim - forwards to `dist/index.js` |
| `infected.config.json` | Runtime configuration file |
| `infected.config.json.example` | Configuration template with comments |
| `package.json` | npm package config, declares `infected` CLI command |
| `tsconfig.json` | TypeScript configuration for server |

---

## Source Directory (`src/`)

### Entry Points

#### `src/index.ts`
Main entry point for CLI. Handles:
- `--configure` flag → interactive configuration wizard
- `plugin add/remove <name>` → plugin management
- Server startup via `InfectedServer`

#### `src/server.ts`
Core `InfectedServer` class:
- Initializes MCP server with SDK
- Loads configuration
- Sets up transport (stdio/http/sse)
- Orchestrates managers and modules
- Handles authentication

---

## CLI Module (`src/cli/`)

| File | Description |
|------|-------------|
| `configure.ts` | Interactive `infected --configure` wizard |
| `plugin-cli.ts` | `PluginCliManager` for `plugin add/remove` |

---

## Config Module (`src/config/`)

| File | Description |
|------|-------------|
| `index.ts` | `ConfigManager` - loads/validates config from JSON + env |
| `schema.ts` | Zod `InfectedConfigSchema` for validation |

---

## Core Modules (`src/core/`)

### Module System (`src/core/module-system/`)

| File | Description |
|------|-------------|
| `module-manager.ts` | Central orchestrator for unified modules. Handles discovery, loading, hot-reload via `ModuleWatcher`. |
| `module-types.ts` | Defines `IUnifiedModule`, `IUnifiedTool`, `IUnifiedPlugin` interfaces + `UnifiedModuleManifest` schema |
| `module-watcher.ts` | File watcher for development hot-reload with debouncing |

### Manager Classes

| Class | File | Purpose |
|-------|------|---------|
| `ProcessManager` | `process-manager.ts` | Shell command execution, foreground/background/detached modes |
| `TerminalManager` | `terminal-manager.ts` | PTY terminal sessions |
| `FileManager` | `file-manager.ts` | Output file storage, cleanup |
| `MonitoringManager` | `monitoring-manager.ts` | System metrics (CPU, memory, processes) |
| `PermissionManager` | `permission-manager.ts` | Tool execution permissions |
| `CommandHistoryManager` | `enhanced-history-manager.ts` | Persistent command history |
| `SecurityManager` | `security/manager.ts` | Command auditing, LLM evaluation |
| `ToolLoader` | `tool-loader.ts` | Tool registration with MCP server |
| `PluginLoader` | `plugin-loader.ts` | Plugin lifecycle management |
| `ToolCacheManager` | `tool-cache-manager.ts` | Execution result caching |

---

## Built-in Modules (`src/modules/`)

| Module | Directory | Tools Provided |
|--------|-----------|----------------|
| **Shell** | `shell/` | shell_execute, process_get_execution, terminal_operate, etc. (12 tools) |
| **Filesystem** | `filesystem/` | read_text_file, write_file, list_directory, search_files, etc. (14 tools) |
| **Memory** | `memory/` | create_entities, create_relations, add_observations, search_nodes (9 tools) |
| **SequentialThinking** | `sequentialthinking/` | sequentialthinking (1 tool) |
| **Fetch** | `fetch/` | fetch, fetch_html |
| **SSH** | `ssh/` | ssh_execute, ssh_new_session, ssh_upload_file, etc. (7 tools) |

---

## Security (`src/security/`)

| File | Description |
|------|-------------|
| `manager.ts` | `SecurityManager` - orchestrates security checks |
| `enhanced-evaluator.ts` | LLM-based command safety evaluation |
| `chat-completion-adapter.ts` | Adapter for OpenAI/Anthropic APIs |
| `validator-criteria-manager.ts` | Criteria document management |
| `security-llm-prompt-generator.ts` | Prompt generation for LLM |

---

## Transports (`src/transports/`)

| Transport | File | Use Case |
|-----------|------|----------|
| STDIO | `stdio.ts` | Local CLI usage |
| HTTP | `http.ts` | REST API access |
| SSE | `sse.ts` | Real-time streaming |

---

## Types (`src/types/`)

| File | Description |
|------|-------------|
| `index.ts` | Main exports including `Module`, `ManagerInstances`, `InfectedConfig` |
| `shell-server/index.ts` | ExecutionInfo, ExecutionMode, ShellType, etc. |
| `shell-server/schemas.ts` | Zod schemas for shell tools |

---

## Utilities (`src/utils/`)

| File | Description |
|------|-------------|
| `shell-helpers.ts` | ID generation, safe env vars, string sanitization |
| `shell-errors.ts` | MCPShellError, TimeoutError, SecurityError classes |
| `criteria-manager.ts` | Security criteria document management |
| `json-repair.ts` | Repair malformed JSON |

---

## Documentation (`docs/`)

| File | Description |
|------|-------------|
| `STRUCTURE.md` | This file - project architecture |
| `GUIDE.md` | Plugin & tool creation guide |
| `CONFIGURATION_EXAMPLES.md` | Config examples |
| `SHELL.md` | Shell module documentation |
| `FILESYSTEM.md` | Filesystem module docs |
| `MEMORY.md` | Memory module docs |
| `SEQUENTALTHINKING.md` | Sequential thinking docs |
| `SSH.md` | SSH module docs |

---

## External Tools (`tools/`)

| Directory | Description |
|-----------|-------------|
| `tools/github/` | GitHub integration tools (issues, PRs, search) |

---

## Plugins (`plugins/`)

| Directory | Description |
|-----------|-------------|
| `plugins/test-plugin/` | Example plugin demonstrating plugin development |

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                    Infected MCP Server                      │
├────────────────────────────────────────────────────────────┤
│  CLI (src/index.ts)                                        │
│    ├── --configure → ConfigWizard                         │
│    ├── plugin add/remove → PluginCliManager               │
│    └── Default → InfectedServer                           │
├────────────────────────────────────────────────────────────┤
│  InfectedServer (src/server.ts)                           │
│    ├── ConfigManager → Load infected.config.json          │
│    ├── McpServer (SDK)                                    │
│    ├── Transport (stdio/http/sse)                        │
│    ├── ManagerInstances                                   │
│    │   ├── ProcessManager                                │
│    │   ├── TerminalManager                               │
│    │   ├── FileManager                                   │
│    │   ├── SecurityManager                               │
│    │   └── ...                                           │
│    ├── ModuleManager                                      │
│    │   ├── Built-in Modules (src/modules/)               │
│    │   │   ├── shell/                                    │
│    │   │   ├── filesystem/                               │
│    │   │   ├── memory/                                   │
│    │   │   └── ...                                       │
│    │   ├── Plugins (plugins/)                            │
│    │   └── Tools (tools/)                                │
│    └── SecurityManager                                    │
│        ├── PermissionManager                              │
│        └── EnhancedEvaluator (LLM)                        │
└────────────────────────────────────────────────────────────┘
```

---

## Configuration Schema Highlights

### Auth Configuration
```typescript
{
  auth: {
    enabled: boolean,
    apiKey: string | string[],      // Single or multiple keys
    randomAuthTokenEnabled: boolean,  // Auto-generate tokens
  }
}
```

### Permissions Configuration
```typescript
{
  permissions: {
    defaultPolicy: "allow" | "deny",
    toolAllowlist: string[],         // Allowed tool names
    toolBlocklist: string[],         // Blocked tool names
  }
}
```

### LLM Security Configuration
```typescript
{
  llmSecurity: {
    enabled: boolean,
    provider: "openai" | "anthropic" | "custom",
    model: string,
    apiKey: string,
    elicitationEnabled: boolean,
    skipSafeCommands: boolean,
  }
}
```

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `express` | HTTP transport |
| `node-pty` | PTY emulation |
| `zod` | Schema validation |
| `winston` | Logging |
| `minimatch` | Glob patterns |
| `diff` | Unified diffs |

---

## File Count

| Category | Count |
|----------|-------|
| Source TypeScript Files | ~75 |
| Core Manager Classes | 15 |
| Built-in Modules | 6 |
| Total MCP Tools | ~50 |
| Documentation Files | 12 |

---

*Last updated: March 2026*
