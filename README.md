# Infected MCP Platform

A unified Model Context Protocol (MCP) server for shell, filesystem, memory, sequential thinking, fetch, and plugins.

## Installation

```bash
npm install @_nazmiforreal/infected
```

Or clone from source:

```bash
git clone https://github.com/HYPER12755/infected.git
cd infected
npm install
```

## Quick Start

```bash
# Configure
cp .env.example .env
cp infected.config.json.example infected.config.json

# Run
npm run dev          # Development with hot reload
npm run build        # Build for production
npm start            # Start production server
```

Server runs on `http://localhost:3001` by default.

## Usage

### Call a Tool

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tool_code/shell_execute","params":{"command":"ls","executionMode":"foreground"}}'
```

### Health Check

```bash
curl http://localhost:3001/health
```

## Configuration

### Environment Variables (.env)

```bash
PORT=3001                    # Server port
TRANSPORT=http               # stdio, http, or sse
HOT_RELOAD=true              # Enable hot reload
LOG_LEVEL=info              # error, warn, info, debug
API_KEY=your-key            # Optional API key auth
```

### Config File (infected.config.json)

- `caching` — Response cache settings
- `authentication` — API key configuration
- `permissions` — Access control rules
- `plugins` — Plugin loading settings

## Available Tools

| Tool | Description |
|------|-------------|
| `shell` | Execute shell commands |
| `filesystem` | Read, write, copy, move, delete files |
| `memory` | Persistent key-value storage |
| `sequentialthinking` | Multi-step reasoning |
| `fetch` | HTTP requests |
| `ssh` | Remote SSH execution |

## Examples

### Run Shell Command

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tool_code/shell_execute",
    "params": {
      "command": "echo hello",
      "executionMode": "foreground",
      "timeout": 30000
    }
  }'
```

### Read a File

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tool_code/filesystem_read",
    "params": {
      "path": "/path/to/file.txt"
    }
  }'
```

### Store Data in Memory

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tool_code/memory_set",
    "params": {
      "key": "user:name",
      "value": "John"
    }
  }'
```

### HTTP Fetch

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tool_code/fetch",
    "params": {
      "url": "https://api.github.com/users",
      "method": "GET"
    }
  }'
```

## Adding Custom Tools

1. Create a directory in `tools/`
2. Add `module.json` with tool definition
3. Add implementation in `index.js`
4. Server auto-discovers on restart

Example `module.json`:

```json
{
  "name": "mytool",
  "version": "1.0.0",
  "description": "My custom tool",
  "tools": [
    {
      "name": "mytool_execute",
      "description": "Does something useful",
      "inputSchema": {
        "type": "object",
        "properties": {
          "param": { "type": "string" }
        }
      }
    }
  ]
}
```

## Adding Plugins

1. Create a directory in `plugins/`
2. Add your plugin code
3. Add `module.json` for discovery
4. Update `infected.config.json` to enable

## Security

- API key auth via `API_KEY` env var
- Command filtering and blacklists
- Permission system for granular access
- Structured logging of all operations

## Documentation

| Document | Description |
|----------|-------------|
| [GUIDE.md](docs/GUIDE.md) | How to create tools and plugins |
| [CONFIGURATION_EXAMPLES.md](docs/CONFIGURATION_EXAMPLES.md) | Config examples |
| [MCP_SERVER.md](docs/MCP_SERVER.md) | Server details |
| [STRUCTURE.md](docs/STRUCTURE.md) | Project structure |
| [API_ENDPOINTS.md](docs/API_ENDPOINTS.md) | API endpoints |

## Project Structure

```
infected/
├── src/           # Source code
│   ├── core/     # Core modules
│   ├── modules/  # Built-in tools
│   └── security/ # Security
├── tools/        # Custom tools
├── plugins/      # Plugins
├── docs/         # Documentation
└── dist/         # Built files
```

## License

MIT
