<p align="center">
  <img src="https://via.placeholder.com/400x120/00d4ff/ffffff?text=Infected" alt="Infected MCP Server" />
</p>

<h1 align="center">Infected MCP Server</h1>

<p align="center">
  <strong>The Ultimate Unified Model Context Protocol Server for AI Agents</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/@_nazmiforreal/infected" alt="npm version" />
  <img src="https://img.shields.io/npm/l/@_nazmiforreal/infected" alt="License" />
  <img src="https://img.shields.io/github/last-commit/HYPER12755/infected" alt="Last Commit" />
  <img src="https://img.shields.io/github/stars/HYPER12755/infected" alt="Stars" />
</p>

---

## 🚀 What is Infected?

**Infected** is a powerful, modular, and extensible **Model Context Protocol (MCP) Server** that provides AI agents with universal access to shell commands, filesystem operations, persistent memory, sequential reasoning, HTTP fetching, and SSH capabilities — all through a unified, standardized interface.

Think of Infected as the **"operating system for AI agents"** — a single server that transforms your AI assistant into a fully capable agent that can execute commands, manage files, remember conversations, think step-by-step, fetch web content, and connect to remote systems.

### Why Choose Infected?

| Feature | Benefit |
|---------|---------|
| **🚀 Unified Platform** | One server, endless capabilities — no need to manage multiple MCP servers |
| **🔌 Modular Architecture** | Built-in modules + custom tools + plugins = infinite extensibility |
| **🛡️ Enterprise Security** | LLM-powered command evaluation, permission controls, API key auth |
| **⚡ High Performance** | Adaptive execution, caching, streaming output, background processing |
| **🔄 Hot Reloading** | Develop tools and plugins without restarting the server |
| **🌐 Multi-Transport** | STDIO, HTTP, and SSE — works locally and over the network |
| **📚 Comprehensive Docs** | Full API reference, examples, and guides |

---

## ✨ Key Features

### 🖥️ Shell Execution
- Execute shell commands with **foreground**, **background**, **detached**, or **adaptive** modes
- Real-time output streaming
- Command history with search and analytics
- Process monitoring and management
- Terminal sessions with PTY support

### 📁 Filesystem Operations
- Read, write, edit, copy, move, and delete files
- Directory listing with sizes
- Recursive tree navigation
- Glob pattern search
- Path security validation (sandboxed)
- Atomic write operations

### 🧠 Persistent Memory
- Knowledge graph storage
- Entity-relation-observation model
- JSONL-based persistence
- Search and query capabilities

### 💭 Sequential Thinking
- Chain-of-thought reasoning
- Thought revision tracking
- Branch exploration
- Progress notifications

### 🌐 HTTP Fetch
- REST API integration
- Web scraping capabilities
- Custom headers and body support

### 🔐 SSH Terminal
- Persistent PTY sessions
- Command execution on remote systems
- File upload/download
- Session management

---

## 📦 What's Inside

The Infected ecosystem is comprised of several integrated components:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Infected MCP Server                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │    Shell    │  │ Filesystem  │  │   Memory    │            │
│   │   Module    │  │   Module    │  │   Module    │            │
│   │  12 tools   │  │  14 tools   │  │   9 tools   │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │Sequential   │  │    Fetch    │  │     SSH     │            │
│   │ Thinking    │  │   Module    │  │   Module    │            │
│   │   Module    │  │             │  │             │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              Security & Permissions Layer                │   │
│   │   • LLM-Powered Command Evaluation                      │   │
│   │   • Permission Manager (Allow/Block Lists)              │   │
│   │   • API Key Authentication                              │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📚 Documentation

Comprehensive documentation is available to help you get started and master Infected:

| Document | Description |
|----------|-------------|
| 📖 **[README.md](README.md)** | Quick start and basic usage |
| 🏗️ **[STRUCTURE.md](docs/STRUCTURE.md)** | Complete project architecture and file organization |
| 🛠️ **[GUIDE.md](docs/GUIDE.md)** | Developer guide for creating tools and plugins |
| ⚙️ **[CONFIGURATION_EXAMPLES.md](docs/CONFIGURATION_EXAMPLES.md)** | Advanced configuration examples |
| 🌐 **[API_ENDPOINTS.md](docs/API_ENDPOINTS.md)** | HTTP API reference |
| 🔒 **[MCP_SERVER.md](docs/MCP_SERVER.md)** | MCP server implementation details |
| 🖥️ **[SHELL.md](docs/SHELL.md)** | Shell module deep dive |
| ⚡ **[REALTIME-OUTPUT.md](docs/REALTIME-OUTPUT.md)** | Real-time output streaming guide |
| 📁 **[FILESYSTEM.md](docs/FILESYSTEM.md)** | Filesystem module reference |
| 🧠 **[MEMORY.md](docs/MEMORY.md)** | Memory module guide |
| 💭 **[SEQUENTALTHINKING.md](docs/SEQUENTALTHINKING.md)** | Sequential thinking module docs |
| 🔐 **[SSH.md](docs/SSH.md)** | SSH module documentation |

---

## 🚦 Getting Started

### Installation

```bash
# Install from npm
npm install @_nazmiforreal/infected

# Or clone from source
git clone https://github.com/HYPER12755/infected.git
cd infected
npm install
```

### Quick Start

```bash
# Configure environment
cp .env.example .env
cp infected.config.json.example infected.config.json

# Run in development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

The server runs on `http://localhost:3001` by default.

---

## 💻 Usage Examples

### Execute a Shell Command

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "shell_execute",
      "arguments": {
        "command": "ls -la",
        "execution_mode": "foreground"
      }
    }
  }'
```

### Read a File

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "read_text_file",
      "arguments": {
        "path": "./config/app.json"
      }
    }
  }'
```

### Store Knowledge in Memory

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "create_entities",
      "arguments": {
        "entities": [
          { "name": "ProjectX", "entityType": "project", "observations": ["AI-powered"] }
        ]
      }
    }
  }'
```

---

## 🔧 Extending Infected

### Create Custom Tools

Tools are the building blocks of Infected. Create your own in the `tools/` directory:

```typescript
// tools/my-tool/index.ts
import { z } from 'zod';
import { IUnifiedTool } from '../../src/core/module-system/module-types.js';

const InputSchema = z.object({
  name: z.string().describe("Name to greet"),
  loud: z.boolean().optional().describe("Yell?"),
});

class MyTool implements IUnifiedTool {
  manifest = {
    id: 'tool.my_tool',
    name: 'My Tool',
    version: '1.0.0',
    type: 'tool',
    entry: 'index.ts',
    description: 'A custom greeting tool',
    inputs: InputSchema,
  };

  async execute(args: z.infer<typeof InputSchema>) {
    const greeting = `Hello, ${args.name}!`;
    return { 
      content: [{ type: 'text', text: args.loud ? greeting.toUpperCase() : greeting }],
      structuredContent: { message: greeting }
    };
  }
}

export default MyTool;
```

### Build Plugins

Plugins can register multiple tools and maintain state:

```typescript
// plugins/weather/index.ts
import { IUnifiedPlugin } from '../../src/core/module-system/module-types.js';

class WeatherPlugin implements IUnifiedPlugin {
  manifest = {
    id: 'plugin.weather',
    name: 'Weather',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.ts',
    description: 'Weather information plugin',
  };

  async onLoad(context) {
    context.moduleManager.registerToolExecution(
      'tool.get_weather',
      async (args: { city: string }) => {
        // Implementation here
        return { temperature: 72, city: args.city };
      },
      'get_weather',
      'Get weather for a city',
      { city: z.string() },
      this.manifest.id
    );
  }
}

export default WeatherPlugin;
```

---

## 🏗️ Project Architecture

```
infected/
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── server.ts               # InfectedServer class
│   ├── cli/                    # Command-line tools
│   │   ├── configure.ts       # Interactive setup wizard
│   │   └── plugin-cli.ts      # Plugin management
│   ├── config/                 # Configuration management
│   │   ├── index.ts           # ConfigManager
│   │   └── schema.ts          # Zod validation schemas
│   ├── core/                   # Core functionality (27 files)
│   │   ├── module-system/    # Dynamic module loading
│   │   ├── process-manager.ts # Command execution
│   │   ├── terminal-manager.ts# PTY sessions
│   │   ├── file-manager.ts   # Output file management
│   │   └── ...               # And more
│   ├── modules/                # Built-in modules (6)
│   │   ├── shell/            # Shell execution
│   │   ├── filesystem/       # File operations
│   │   ├── memory/          # Knowledge graph
│   │   ├── sequentialthinking/ # Reasoning
│   │   ├── fetch/           # HTTP requests
│   │   └── ssh/             # SSH sessions
│   ├── security/             # Security & permissions
│   ├── transports/          # STDIO, HTTP, SSE
│   ├── types/                # TypeScript definitions
│   └── utils/                # Utility functions
├── tools/                    # Custom tools directory
├── plugins/                  # Plugins directory
├── docs/                     # Documentation
└── dist/                     # Compiled output
```

---

## 🛡️ Security Features

Infected was built with security as a first-class concern:

- **🔑 API Key Authentication** — Protect your server with single or multiple API keys
- **🛡️ Permission System** — Allowlist/blocklist specific tools
- **🤖 LLM-Powered Evaluation** — Use AI to analyze commands before execution
- **📝 Command Auditing** — Full logging of all operations
- **🚫 Path Sandboxing** — Filesystem access restricted to allowed directories
- **⏱️ Execution Timeouts** — Prevent runaway processes

---

## 📦 Available Modules & Tools

### Built-in Modules

| Module | Tools | Description |
|--------|-------|-------------|
| **Shell** | 12 | Command execution, process management, terminals, interactive sessions |
| **Filesystem** | 14 | File operations, directory management, search |
| **Memory** | 9 | Knowledge graph, entities, relations |
| **SequentialThinking** | 1 | Chain-of-thought reasoning |
| **Fetch** | 2 | HTTP requests, web scraping |
| **SSH** | 7 | Remote execution, file transfer |

---

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [Model Context Protocol SDK](https://github.com/modelcontextprotocol) — The foundation of Infected
- All contributors and community members

---

<p align="center">
  <strong>Built with ❤️ for AI Agents Everywhere</strong>
</p>

<p align="center">
  <a href="https://github.com/HYPER12755/infected">GitHub</a> •
  <a href="https://npmjs.com/package/@_nazmiforreal/infected">npm</a> •
  <a href="docs/GUIDE.md">Documentation</a>
</p>
