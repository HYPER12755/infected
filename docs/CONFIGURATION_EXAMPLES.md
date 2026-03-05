# Configuration Examples for @infected/infected MCP Server

This document mirrors the current runtime configuration shape.

## 1. `.env.example`

Use these environment variables when you want runtime overrides.

```ini
# =============================================================================
# infected global runtime roots
# =============================================================================
# .env and infected.config.json are loaded from INFECTED_INSTALL_ROOT.
# Tool execution runs in INFECTED_WORKSPACE_ROOT (defaults to current shell cwd).
INFECTED_INSTALL_ROOT=
INFECTED_WORKSPACE_ROOT=

# =============================================================================
# core config (maps to infected.config.json)
# =============================================================================
TRANSPORT=http
PORT=3001
MODULES=shell,filesystem,memory,sequentialthinking,fetch
HOT_RELOAD=true
TOOLS_DIR=./tools
PLUGINS_DIR=./plugins

# =============================================================================
# module config
# =============================================================================
SHELL_ALLOWLIST=
MEMORY_FILE_PATH=.infected/memory.jsonl
FETCH_DOMAIN_WHITELIST=

# =============================================================================
# shell/process behavior
# =============================================================================
MCP_SHELL_DEFAULT_WORKDIR=
MCP_SHELL_ALLOWED_WORKDIRS=
MCP_SHELL_ENABLE_STREAMING=true

# security manager legacy envs
MCP_SHELL_SECURITY_MODE=permissive
MCP_SHELL_MAX_EXECUTION_TIME=300
MCP_SHELL_MAX_MEMORY_MB=1024
MCP_SHELL_ENABLE_NETWORK=true
MCP_SHELL_ENHANCED_MODE=false
MCP_SHELL_LLM_EVALUATION=false
MCP_SHELL_SKIP_SAFE_COMMANDS=true
MCP_SHELL_ENABLE_PATTERN_FILTERING=false
MCP_SHELL_ELICITATION=false
MCP_SHELL_BASIC_SAFE_CLASSIFICATION=true
MCP_SHELL_LLM_PROVIDER=
MCP_SHELL_LLM_MODEL=
MCP_SHELL_LLM_API_KEY=
MCP_SHELL_LLM_TIMEOUT=

# =============================================================================
# misc runtime
# =============================================================================
EXECUTION_BACKEND=
EXECUTOR_URL=
EXECUTOR_HOST=127.0.0.1
EXECUTOR_PORT=4030
EXECUTOR_TOKEN=
PYTHON_FETCH_MICROSERVICE_URL=http://localhost:5000
DISABLE_THOUGHT_LOGGING=false
LOG_LEVEL=debug
```

## 2. `infected.config.json.example`

Use this file for primary server configuration.

```json
{
  // Main server transport: 'stdio' for CLI, 'http' for REST API, 'sse' for real-time events.
  "transport": "http",
  // List of modules to load. Agents can use tools from these modules.
  "modules": ["shell", "filesystem", "memory", "sequentialthinking", "fetch", "ssh"],
  // Port for HTTP/SSE transport.
  "port": 3000,
  // Directory where external tools are automatically discovered.
  "toolsDir": "./tools",
  // Directory where external plugins are automatically discovered.
  "pluginsDir": "./plugins",

  // Enable/disable hot-reloading for tools and modules. Useful for development.
  "hotReload": true,
  "shell": {
    // List of specific commands allowed for the shell module. Empty means all are allowed by default for agent autonomy.
    // Example: ["ls", "echo"]
    "allowlist": []
  },
  "memory": {
    // File path for storing the agent's knowledge graph.
    "filePath": ".infected/memory.jsonl"
  },
  "fetch": {
    // Whitelist of domains allowed for 'fetch' tools. Empty means all are allowed for agent autonomy.
    // Example: ["example.com", "api.github.com"]
    "domainWhitelist": [],
    // Prevent 'fetch' tools from accessing local network resources. Set to false for agents needing local access.
    "blockLocalNetwork": false
  },
  "plugins": [
    // Define external plugins to load, with optional plugin-specific configurations.
    {
      "name": "./plugins/example-plugin",
      "config": {
        "greeting": "Hello from config!" // Example plugin configuration.
      }
    }
  ],
  "cache": {
    // Enable/disable caching of tool execution results to improve performance.
    "enabled": true,
    // Default time-to-live (milliseconds) for cached entries.
    "defaultTTL": 300000,
    // Maximum number of entries in the cache.
    "maxSize": 1000
  },
  "auth": {
    // Enable/disable API Key authentication. If true AND apiKey is set, it will be enforced.
    "enabled": false,
    // API Keys for authenticating requests to HTTP/SSE transports.
    // Can be a single string or an array of strings. Each key must be at least 8 characters long.
    // If empty, authentication is disabled if 'enabled' is true and 'randomAuthTokenEnabled' is false.
    "apiKey": [], // Example: ["your-super-secret-key-123"]
    // If true, a random API key is generated at server startup, overriding any static API keys.
    // Useful for temporary sessions; disable for persistent keys.
    "randomAuthTokenEnabled": false
  },
  "permissions": {
    // Default policy for tool execution: 'allow' (default for agents) or 'deny'.
    // 'allow' grants maximum autonomy to agents by permitting all tools unless explicitly blocked.
    "defaultPolicy": "allow",
    // List of tool names that are always allowed, overriding the default policy. Empty for agents to use all tools.
    // Example: ["shell_execute", "list_directory"]
    "toolAllowlist": [],
    // List of tool names that are always blocked, overriding the allowlist. Empty for agents to use all tools.
    // Example: ["rm_rf"]
    "toolBlocklist": []
  },
  "llmSecurity": {
    // Enable LLM-based security evaluation for shell commands. (Default: false for agent autonomy).
    "enabled": false,
    // LLM provider for security evaluation (e.g., "openai", "gemini").
    "provider": "",
    // Specific LLM model to use (e.g., "gpt-4-turbo", "gemini-pro").
    "model": "",
    // API key for the LLM provider.
    "apiKey": "",
    // Enable interactive elicitation by LLM for potentially unsafe commands.
    "elicitationEnabled": false,
    // Optimize: Skip LLM checks for commands pre-identified as safe patterns.
    "skipSafeCommands": true
  }
}
```
