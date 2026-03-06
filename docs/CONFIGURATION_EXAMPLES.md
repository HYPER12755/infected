# Configuration Examples for Infected MCP Server

This comprehensive guide provides detailed configuration examples for the Infected MCP Server, covering all aspects from basic setup to advanced security and performance tuning.

---

## Table of Contents

1. [Environment Variables (.env)](#1-environment-variables-env)
2. [Configuration File (infected.config.json)](#2-configuration-file-infectedconfigjson)
3. [Basic Configurations](#3-basic-configurations)
4. [Security Configurations](#4-security-configurations)
5. [Performance Configurations](#5-performance-configurations)
6. [Module-Specific Configurations](#6-module-specific-configurations)
7. [Plugin Configurations](#7-plugin-configurations)
8. [Complete Examples](#8-complete-examples)

---

## 1. Environment Variables (.env)

Environment variables provide runtime overrides and are typically stored in `.env` file. Copy from `.env.example` to get started.

### Global Runtime Roots

```ini
# Installation root directory (where infected is installed)
INFECTED_INSTALL_ROOT=/opt/infected

# Workspace root for command execution (defaults to shell cwd)
INFECTED_WORKSPACE_ROOT=/home/user/projects
```

### Core Configuration

```ini
# Transport mode: stdio, http, or sse
TRANSPORT=http

# HTTP server port
PORT=3001

# Comma-separated list of modules to load
MODULES=shell,filesystem,memory,sequentialthinking,fetch,ssh

# Enable hot-reloading for tools and plugins
HOT_RELOAD=true

# Directory for external tools
TOOLS_DIR=./tools

# Directory for external plugins
PLUGINS_DIR=./plugins
```

### Shell/Process Configuration

```ini
# Default working directory for shell commands
MCP_SHELL_DEFAULT_WORKDIR=/home/user

# Allowed working directories (comma-separated)
MCP_SHELL_ALLOWED_WORKDIRS=/home/user,/tmp

# Enable real-time output streaming
MCP_SHELL_ENABLE_STREAMING=true

# Maximum execution time in seconds
MCP_SHELL_MAX_EXECUTION_TIME=300

# Maximum memory per process in MB
MCP_SHELL_MAX_MEMORY_MB=1024

# Enable network access for commands
MCP_SHELL_ENABLE_NETWORK=true
```

### Security Configuration (Environment)

```ini
# Security mode: permissive, restrictive, or custom
MCP_SHELL_SECURITY_MODE=permissive

# Enable enhanced security evaluation
MCP_SHELL_ENHANCED_MODE=false

# Enable LLM-based command evaluation
MCP_SHELL_LLM_EVALUATION=false

# Skip evaluation for known safe commands
MCP_SHELL_SKIP_SAFE_COMMANDS=true

# Enable interactive confirmation for risky commands
MCP_SHELL_ELICITATION=false

# LLM Provider Settings
MCP_SHELL_LLM_PROVIDER=openai
MCP_SHELL_LLM_MODEL=gpt-4
MCP_SHELL_LLM_API_KEY=sk-...
MCP_SHELL_LLM_TIMEOUT=30000
```

### Module Configuration

```ini
# Shell command allowlist (comma-separated)
SHELL_ALLOWLIST=ls,cat,echo,grep,find

# Memory file path
MEMORY_FILE_PATH=.infected/memory.jsonl

# Fetch domain whitelist (comma-separated)
FETCH_DOMAIN_WHITELIST=api.github.com,example.com
```

### Logging & Miscellaneous

```ini
# Log level: error, warn, info, debug
LOG_LEVEL=info

# Disable thought logging for sequential thinking
DISABLE_THOUGHT_LOGGING=false

# Python microservice URL for fetch module
PYTHON_FETCH_MICROSERVICE_URL=http://localhost:5000

# Execution backend: local or remote
EXECUTION_BACKEND=local
```

---

## 2. Configuration File (infected.config.json)

The main configuration file uses JSON format. Here are all available options:

### Full Schema Reference

```json
{
  "transport": "http",
  "port": 3000,
  "modules": ["shell", "filesystem", "memory", "sequentialthinking", "fetch", "ssh"],
  "toolsDir": "./tools",
  "pluginsDir": "./plugins",
  "hotReload": true,
  
  "shell": {
    "allowlist": []
  },
  
  "memory": {
    "filePath": ".infected/memory.jsonl"
  },
  
  "fetch": {
    "domainWhitelist": [],
    "blockLocalNetwork": true
  },
  
  "plugins": [],
  
  "cache": {
    "enabled": true,
    "defaultTTL": 300000,
    "maxSize": 1000
  },
  
  "auth": {
    "enabled": false,
    "apiKey": [],
    "randomAuthTokenEnabled": false
  },
  
  "permissions": {
    "defaultPolicy": "allow",
    "toolAllowlist": [],
    "toolBlocklist": []
  },
  
  "llmSecurity": {
    "enabled": false,
    "provider": "",
    "model": "",
    "apiKey": "",
    "elicitationEnabled": false,
    "skipSafeCommands": true
  }
}
```

---

## 3. Basic Configurations

### Minimal Development Setup

```json
{
  "transport": "stdio",
  "hotReload": true
}
```

### Local HTTP Server

```json
{
  "transport": "http",
  "port": 3001,
  "modules": ["shell", "filesystem", "memory"],
  "hotReload": true
}
```

### Full Stack with SSE

```json
{
  "transport": "http",
  "port": 3001,
  "modules": ["shell", "filesystem", "memory", "sequentialthinking", "fetch", "ssh"],
  "hotReload": true,
  "cache": {
    "enabled": true
  }
}
```

---

## 4. Security Configurations

### API Key Authentication

```json
{
  "auth": {
    "enabled": true,
    "apiKey": ["your-secret-api-key-123"],
    "randomAuthTokenEnabled": false
  }
}
```

### Auto-Generated API Key (for temporary sessions)

```json
{
  "auth": {
    "enabled": true,
    "randomAuthTokenEnabled": true
  }
}
```

### Deny-by-Default with Allowlist

```json
{
  "permissions": {
    "defaultPolicy": "deny",
    "toolAllowlist": ["read_text_file", "list_directory", "shell_execute"],
    "toolBlocklist": []
  }
}
```

### Allow-by-Default with Blocklist

```json
{
  "permissions": {
    "defaultPolicy": "allow",
    "toolAllowlist": [],
    "toolBlocklist": ["delete_file", "rm_rf", "format_disk"]
  }
}
```

### LLM-Powered Security Evaluation

```json
{
  "llmSecurity": {
    "enabled": true,
    "provider": "openai",
    "model": "gpt-4-turbo",
    "apiKey": "sk-...",
    "elicitationEnabled": true,
    "skipSafeCommands": true
  }
}
```

### Complete Security Setup

```json
{
  "auth": {
    "enabled": true,
    "apiKey": ["prod-api-key-xyz789"]
  },
  "permissions": {
    "defaultPolicy": "deny",
    "toolAllowlist": [
      "shell_execute",
      "read_text_file", 
      "write_file",
      "list_directory",
      "search_files",
      "create_entities",
      "search_nodes",
      "get_weather"
    ],
    "toolBlocklist": [
      "rm_rf",
      "delete_file",
      "drop_database"
    ]
  },
  "llmSecurity": {
    "enabled": true,
    "provider": "openai",
    "model": "gpt-4",
    "apiKey": "sk-...",
    "elicitationEnabled": true,
    "skipSafeCommands": true
  }
}
```

---

## 5. Performance Configurations

### Caching Enabled

```json
{
  "cache": {
    "enabled": true,
    "defaultTTL": 300000,
    "maxSize": 1000
  }
}
```

### Aggressive Caching

```json
{
  "cache": {
    "enabled": true,
    "defaultTTL": 600000,
    "maxSize": 5000
  }
}
```

### No Caching (for development)

```json
{
  "cache": {
    "enabled": false
  }
}
```

---

## 6. Module-Specific Configurations

### Shell Module - Restricted Commands

```json
{
  "shell": {
    "allowlist": ["ls", "cat", "echo", "grep", "find", "git", "npm"]
  }
}
```

### Shell Module - Full Access

```json
{
  "shell": {
    "allowlist": []
  }
}
```

### Memory Module - Custom Path

```json
{
  "memory": {
    "filePath": "/var/data/infected-memory.jsonl"
  }
}
```

### Fetch Module - Domain Restriction

```json
{
  "fetch": {
    "domainWhitelist": [
      "api.github.com",
      "raw.githubusercontent.com",
      "api.openweathermap.org"
    ],
    "blockLocalNetwork": true
  }
}
```

### Fetch Module - Full Access

```json
{
  "fetch": {
    "domainWhitelist": [],
    "blockLocalNetwork": false
  }
}
```

---

## 7. Plugin Configurations

### Loading a Plugin with Config

```json
{
  "plugins": [
    {
      "name": "./plugins/weather",
      "config": {
        "apiKey": "weather-api-key-123"
      }
    }
  ]
}
```

### Loading Multiple Plugins

```json
{
  "plugins": [
    {
      "name": "./plugins/weather",
      "config": {
        "apiKey": "weather-key"
      }
    },
    {
      "name": "./plugins/database",
      "config": {
        "connectionString": "postgres://user:pass@localhost:5432/mydb"
      }
    },
    {
      "name": "./plugins/slack",
      "config": {
        "webhookUrl": "https://hooks.slack.com/..."
      }
    }
  ]
}
```

---

## 8. Complete Examples

### Development Configuration

```json
{
  "transport": "http",
  "port": 3001,
  "modules": ["shell", "filesystem", "memory", "sequentialthinking", "fetch", "ssh"],
  "toolsDir": "./tools",
  "pluginsDir": "./plugins",
  "hotReload": true,
  "shell": {
    "allowlist": []
  },
  "memory": {
    "filePath": ".infected/memory.jsonl"
  },
  "fetch": {
    "domainWhitelist": [],
    "blockLocalNetwork": false
  },
  "cache": {
    "enabled": true,
    "defaultTTL": 60000,
    "maxSize": 100
  },
  "auth": {
    "enabled": false
  },
  "permissions": {
    "defaultPolicy": "allow",
    "toolAllowlist": [],
    "toolBlocklist": []
  },
  "llmSecurity": {
    "enabled": false
  }
}
```

### Production Configuration (Secure)

```json
{
  "transport": "http",
  "port": 3001,
  "modules": ["shell", "filesystem", "memory", "sequentialthinking", "fetch"],
  "toolsDir": "./tools",
  "pluginsDir": "./plugins",
  "hotReload": false,
  "shell": {
    "allowlist": ["ls", "cat", "echo", "grep", "find", "git", "npm", "node"]
  },
  "memory": {
    "filePath": "/var/lib/infected/memory.jsonl"
  },
  "fetch": {
    "domainWhitelist": ["api.github.com", "api.openweathermap.org"],
    "blockLocalNetwork": true
  },
  "cache": {
    "enabled": true,
    "defaultTTL": 300000,
    "maxSize": 1000
  },
  "auth": {
    "enabled": true,
    "apiKey": ["prod-api-key-secure-123"],
    "randomAuthTokenEnabled": false
  },
  "permissions": {
    "defaultPolicy": "deny",
    "toolAllowlist": [
      "shell_execute",
      "read_text_file",
      "write_file",
      "list_directory",
      "create_entities",
      "search_nodes"
    ],
    "toolBlocklist": [
      "rm_rf",
      "delete_file",
      "delete_directory"
    ]
  },
  "llmSecurity": {
    "enabled": true,
    "provider": "openai",
    "model": "gpt-4-turbo",
    "apiKey": "sk-prod-...",
    "elicitationEnabled": true,
    "skipSafeCommands": true
  }
}
```

### API Key + Restricted Shell + Custom Memory

```json
{
  "transport": "http",
  "port": 8080,
  "modules": ["shell", "memory"],
  "hotReload": false,
  "shell": {
    "allowlist": ["ls", "cat", "echo"]
  },
  "memory": {
    "filePath": "/data/agent-memory.jsonl"
  },
  "cache": {
    "enabled": true
  },
  "auth": {
    "enabled": true,
    "apiKey": ["secure-key-12345"]
  },
  "permissions": {
    "defaultPolicy": "allow"
  }
}
```

### SSE Real-Time Configuration

```json
{
  "transport": "http",
  "port": 3001,
  "modules": ["shell", "filesystem", "memory", "sequentialthinking"],
  "hotReload": true,
  "cache": {
    "enabled": true,
    "defaultTTL": 120000
  },
  "auth": {
    "enabled": true,
    "apiKey": ["sse-key-abc"]
  },
  "permissions": {
    "defaultPolicy": "allow"
  }
}
```

---

## Environment Variable Mapping

| Config File Key | Environment Variable |
|-----------------|---------------------|
| `transport` | `TRANSPORT` |
| `port` | `PORT` |
| `hotReload` | `HOT_RELOAD` |
| `toolsDir` | `TOOLS_DIR` |
| `pluginsDir` | `PLUGINS_DIR` |
| `shell.allowlist` | `SHELL_ALLOWLIST` |
| `memory.filePath` | `MEMORY_FILE_PATH` |
| `fetch.domainWhitelist` | `FETCH_DOMAIN_WHITELIST` |
| `cache.enabled` | - |
| `auth.enabled` | - |
| `auth.apiKey` | `API_KEY` |
| `permissions.defaultPolicy` | - |
| `llmSecurity.enabled` | `MCP_SHELL_LLM_EVALUATION` |
| `llmSecurity.provider` | `MCP_SHELL_LLM_PROVIDER` |
| `llmSecurity.model` | `MCP_SHELL_LLM_MODEL` |
| `llmSecurity.apiKey` | `MCP_SHELL_LLM_API_KEY` |

---

## Configuration Precedence

Configuration is loaded in the following order (later overrides earlier):

1. **Default values** - Built-in defaults
2. **Environment variables** - Runtime overrides
3. **Configuration file** - `infected.config.json`
4. **Plugin-specific config** - Per-plugin settings

---

*Last updated: March 2026*
