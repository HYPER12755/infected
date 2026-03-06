# Developer's Guide: Extending the @infected/infected Server

This comprehensive guide explains how to extend the Infected MCP Server by creating custom tools and plugins using its unified, dynamic module system.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Quickstart](#2-quickstart)
3. [Creating Tools](#3-creating-tools)
4. [Creating Plugins](#4-creating-plugins)
5. [The UnifiedModuleContext](#5-the-unifiedmodulecontext)
6. [Configuration](#6-configuration)
7. [Hot Reloading](#7-hot-reloading)
8. [Best Practices](#8-best-practices)
9. [Complete Examples](#9-complete-examples)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Architecture Overview

The Infected server uses a unified module system that supports two types of extensions:

### Tools vs Plugins

| Aspect | Tools | Plugins |
|--------|-------|---------|
| **Definition** | Single-purpose stateless functions | Multi-tool packages with state |
| **Interface** | `IUnifiedTool` | `IUnifiedPlugin` |
| **Registration** | Implements `execute()` method | Uses `context.moduleManager.registerToolExecution()` |
| **Location** | `tools/` directory | `plugins/` directory |
| **Purpose** | Simple operations (read, write, compute) | Complex features, multiple tools, orchestration |

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     InfectedServer                           │
├─────────────────────────────────────────────────────────────┤
│  ModuleManager                                              │
│  ├── ToolLoader → Discovers & registers tools              │
│  └── PluginLoader → Discovers & loads plugins              │
├─────────────────────────────────────────────────────────────┤
│  tools/                    plugins/                         │
│  ├── hello-world/          ├── my-plugin/                  │
│  ├── calculator/           ├── database/                    │
│  └── ...                   └── ...                          │
├─────────────────────────────────────────────────────────────┤
│  ModuleWatcher → Monitors for file changes (hot reload)    │
└─────────────────────────────────────────────────────────────┘
```

### Module Discovery Flow

```
Server Startup
     │
     ▼
ModuleManager.loadModules()
     │
     ├──► Read config: toolsDir, pluginsDir
     │
     ├──► Scan directories for subdirectories
     │
     ├──► For each subdirectory:
     │    │
     │    ├──► Check for index.ts or index.js
     │    │
     │    ├──► Check for module.json (or use manifest in code)
     │    │
     │    ├──► Validate manifest (type: 'tool' or 'plugin')
     │    │
     │    └──► Import and instantiate class
     │
     └──► Call onLoad() for each module
```

---

## 2. Quickstart

### Fastest Path to Working Modules

1. Create a folder under `tools/` or `plugins/`
2. Add an `index.ts` exporting a class implementing `IUnifiedTool` or `IUnifiedPlugin`
3. Define `manifest` in code (recommended for quick iteration)
4. For tools, define `manifest.inputs` using Zod
5. Start server: `npm run dev`
6. Verify loading in logs
7. Test with MCP Inspector

### Inspector Testing Commands

```bash
# List all available tools
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3001/mcp --transport http --method tools/list

# Call a tool
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3001/mcp --transport http --method tools/call --tool-name tool.my_tool --tool-arg key=value
```

---

## 3. Creating Tools

### What is a Tool?

A tool is a **stateless function** that performs a specific operation. Tools are ideal for:
- Data retrieval (read files, fetch URLs, query databases)
- Data transformation (format, convert, compute)
- Simple actions (send notification, update status)

### Interface: IUnifiedTool

```typescript
interface IUnifiedTool {
  manifest: UnifiedModuleManifest;
  
  // Lifecycle
  onLoad(context: UnifiedModuleContext): Promise<void>;
  execute(args: any, context: UnifiedModuleContext): Promise<any>;
  onUnload?(): Promise<void>;
  onError?(error: Error, context: UnifiedModuleContext): Promise<void>;
}
```

### Manifest Structure

```typescript
interface UnifiedModuleManifest {
  id: string;           // Unique: "tool.my_tool" or "plugin.my_plugin"
  name: string;         // Human readable: "My Tool"
  version: string;      // "1.0.0"
  type: 'tool' | 'plugin';
  entry: string;        // "index.ts"
  description?: string;
  inputs?: ZodSchema;  // For tools: input validation
  outputs?: ZodSchema; // For tools: output schema
  provides?: string[]; // For plugins: ["tools", "resources"]
  dependencies?: string[]; // Module IDs this depends on
}
```

### Minimal Tool Example

**Directory:** `tools/echo-plus/index.ts`

```typescript
import { z } from 'zod';
import { IUnifiedTool, UnifiedModuleContext } from '../../src/core/module-system/module-types.js';

const EchoInputs = z.object({
  text: z.string().min(1).describe("Text to echo"),
  uppercase: z.boolean().optional().describe("Convert to uppercase"),
});

class EchoPlusTool implements IUnifiedTool {
  manifest = {
    id: 'tool.echo_plus',
    name: 'echo_plus',
    version: '1.0.0',
    type: 'tool',
    entry: 'index.ts',
    description: 'Echoes text with optional uppercase formatting.',
    inputs: EchoInputs,
  };

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    context.logger.info('EchoPlus tool loaded.', { component: this.manifest.id });
  }

  async execute(args: z.infer<typeof EchoInputs>): Promise<{ output: string }> {
    return { 
      output: args.uppercase ? args.text.toUpperCase() : args.text 
    };
  }
}

export default EchoPlusTool;
```

### Tool Output Format

All tools should return MCP `CallToolResult` format:

```typescript
return {
  content: [
    {
      type: 'text',
      text: 'Human-readable result summary'
    }
  ],
  structuredContent: {
    // Machine-parsable data
    key: 'value'
  }
};
```

---

## 4. Creating Plugins

### What is a Plugin?

A plugin is a **multi-tool package** that can:
- Register multiple MCP tools
- Maintain state between tool calls
- Access server configuration
- Integrate with external services
- Orchestrate complex workflows

### Interface: IUnifiedPlugin

```typescript
interface IUnifiedPlugin {
  manifest: UnifiedModuleManifest;
  
  // Lifecycle
  onLoad(context: UnifiedModuleContext): Promise<void>;
  onUnload?(): Promise<void>;
  onError?(error: Error, context: UnifiedModuleContext): Promise<void>;
}
```

### Minimal Plugin Example

**Directory:** `plugins/time-utils/index.ts`

```typescript
import { z } from 'zod';
import { IUnifiedPlugin, UnifiedModuleContext } from '../../src/core/module-system/module-types.js';

class TimeUtilsPlugin implements IUnifiedPlugin {
  manifest = {
    id: 'plugin.time_utils',
    name: 'Time Utilities',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.ts',
    description: 'Utility tools for time and date operations.',
  };

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    // Register first tool
    context.moduleManager.registerToolExecution(
      'tool.time_now',
      async () => ({ 
        iso: new Date().toISOString(),
        timestamp: Date.now() 
      }),
      'time_now',
      'Returns current timestamp',
      {}, // No input schema
      this.manifest.id
    );

    // Register second tool
    context.moduleManager.registerToolExecution(
      'tool.date_add_days',
      async (args: { date: string; days: number }) => {
        const d = new Date(args.date);
        d.setDate(d.getDate() + args.days);
        return { result: d.toISOString().slice(0, 10) };
      },
      'date_add_days',
      'Adds days to a date',
      {
        date: z.string(),
        days: z.number(),
      },
      this.manifest.id
    );

    context.logger.info('Time Utils plugin loaded.', { component: this.manifest.id });
  }
}

export default TimeUtilsPlugin;
```

---

## 5. The UnifiedModuleContext

The `UnifiedModuleContext` provides access to all server functionality:

```typescript
interface UnifiedModuleContext {
  // MCP Server instance
  server: McpServer;
  
  // Server configuration
  config: InfectedConfig;
  
  // All manager instances
  managers: ManagerInstances;
  
  // Centralized logger
  logger: Logger;
  
  // Module registration & discovery
  moduleManager: ModuleManager;
}
```

### Accessing Managers

```typescript
async onLoad(context: UnifiedModuleContext): Promise<void> {
  // Access specific managers
  const { processManager, terminalManager, fileManager } = context.managers;
  
  // Use ProcessManager to execute commands
  const result = await processManager.executeCommand({
    command: 'ls -la',
    executionMode: 'foreground',
    timeoutSeconds: 30,
  });
  
  // Use logger
  context.logger.info('Plugin initialized', { component: this.manifest.id });
}
```

### ManagerInstances Type

```typescript
interface ManagerInstances {
  processManager?: ProcessManager;
  terminalManager?: TerminalManager;
  fileManager?: FileManager;
  monitoringManager?: MonitoringManager;
  securityManager?: SecurityManager;
  commandHistoryManager?: CommandHistoryManager;
  shellConfigManager?: McpShellConfigManager;
}
```

---

## 6. Configuration

### Server Configuration File

`infected.config.json`:

```json
{
  "toolsDir": "./tools",
  "pluginsDir": "./plugins",
  "transports": {
    "stdio": { "enabled": true },
    "http": { "enabled": true, "port": 3001 }
  },
  "auth": {
    "enabled": true,
    "apiKey": "your-secret-key"
  },
  "permissions": {
    "defaultPolicy": "allow",
    "toolBlocklist": ["dangerous_tool"]
  }
}
```

### Plugin-Specific Configuration

Add to `infected.config.json`:

```json
{
  "plugins": {
    "plugin.my_plugin": {
      "config": {
        "apiKey": "plugin-specific-key",
        "option": "value"
      }
    }
  }
}
```

Access in plugin:

```typescript
const myConfig = context.config.plugins?.[this.manifest.id]?.config;
```

---

## 7. Hot Reloading

The server automatically monitors for file changes:

1. **ModuleWatcher** observes `toolsDir` and `pluginsDir`
2. On file change, triggers debounced reload
3. **ModuleManager** calls `onUnload()` on old module
4. Reloads and calls `onLoad()` on new module

### Behavior

| Event | Action |
|-------|--------|
| File added | Load new module |
| File modified | Reload module |
| File removed | Unload module |
| `module.json` changed | Full reload |

### Configuration

Hot reloading is enabled by default. To disable:

```json
{
  "modules": {
    "hotReload": false
  }
}
```

---

## 8. Best Practices

### For Tools

1. **Single Responsibility** - One clear purpose per tool
2. **Idempotency** - Running multiple times yields same result
3. **Input Validation** - Use Zod schemas for all inputs
4. **Error Handling** - Return structured errors
5. **Logging** - Use context.logger with component ID
6. **Documentation** - Clear description in manifest

### For Plugins

1. **Unique IDs** - Use `plugin.<name>` prefix
2. **Lazy Initialization** - Avoid heavy work in `onLoad`
3. **Cleanup** - Implement `onUnload()` for resources
4. **Configuration** - Support config from infected.config.json
5. **Error Boundaries** - Implement `onError()` handler

### General

1. **TypeScript** - Use TypeScript for type safety
2. **Zod** - Use Zod for all input/output validation
3. **Structured Logging** - Include component metadata
4. **Graceful Degradation** - Handle missing dependencies

---

## 9. Complete Examples

### Example 1: Calculator Tool

**File:** `tools/calculator/index.ts`

```typescript
import { z } from 'zod';
import { IUnifiedTool, UnifiedModuleContext } from '../../src/core/module-system/module-types.js';

const CalculatorInput = z.object({
  operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe("Math operation"),
  a: z.number().describe("First operand"),
  b: z.number().describe("Second operand"),
});

class CalculatorTool implements IUnifiedTool {
  manifest = {
    id: 'tool.calculator',
    name: 'Calculator',
    version: '1.0.0',
    type: 'tool',
    entry: 'index.ts',
    description: 'Performs basic arithmetic operations.',
    inputs: CalculatorInput,
  };

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    context.logger.info('Calculator tool loaded', { component: this.manifest.id });
  }

  async execute(args: z.infer<typeof CalculatorInput>) {
    const { operation, a, b } = args;
    let result: number;
    let error: string | undefined;

    switch (operation) {
      case 'add':
        result = a + b;
        break;
      case 'subtract':
        result = a - b;
        break;
      case 'multiply':
        result = a * b;
        break;
      case 'divide':
        if (b === 0) {
          error = 'Division by zero';
          result = 0;
        } else {
          result = a / b;
        }
        break;
    }

    return {
      content: [{
        type: 'text' as const,
        text: error 
          ? `Error: ${error}`
          : `${a} ${operation} ${b} = ${result}`
      }],
      structuredContent: { operation, a, b, result, error }
    };
  }
}

export default CalculatorTool;
```

### Example 2: File Search Plugin

**File:** `plugins/file-search/index.ts`

```typescript
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IUnifiedPlugin, UnifiedModuleContext } from '../../src/core/module-system/module-types.js';

const SearchSchema = z.object({
  directory: z.string().describe("Directory to search"),
  pattern: z.string().describe("Glob pattern (e.g., *.ts)"),
});

class FileSearchPlugin implements IUnifiedPlugin {
  manifest = {
    id: 'plugin.file_search',
    name: 'File Search',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.ts',
    description: 'Search for files matching glob patterns.',
  };

  private async glob(dir: string, pattern: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const subResults = await this.glob(fullPath, pattern);
          results.push(...subResults);
        } else if (this.matchPattern(entry.name, pattern)) {
          results.push(fullPath);
        }
      }
    } catch {
      // Skip inaccessible directories
    }
    return results;
  }

  private matchPattern(filename: string, pattern: string): boolean {
    const regex = new RegExp(
      pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')
    );
    return regex.test(filename);
  }

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    context.moduleManager.registerToolExecution(
      'tool.file_search',
      async (args: z.infer<typeof SearchSchema>) => {
        const files = await this.glob(args.directory, args.pattern);
        return {
          content: [{
            type: 'text' as const,
            text: `Found ${files.length} matching files:\n${files.join('\n')}`
          }],
          structuredContent: { files, count: files.length }
        };
      },
      'file_search',
      'Search for files matching a glob pattern',
      SearchSchema,
      this.manifest.id
    );

    context.logger.info('File Search plugin loaded', { component: this.manifest.id });
  }
}

export default FileSearchPlugin;
```

### Example 3: Weather Plugin with External API

**File:** `plugins/weather/index.ts`

```typescript
import { z } from 'zod';
import { IUnifiedPlugin, UnifiedModuleContext } from '../../src/core/module-system/module-types.js';

const WeatherSchema = z.object({
  city: z.string().describe("City name"),
  unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius'),
});

class WeatherPlugin implements IUnifiedPlugin {
  manifest = {
    id: 'plugin.weather',
    name: 'Weather',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.ts',
    description: 'Get weather information for cities.',
  };

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    // Get API key from plugin config
    const config = context.config.plugins?.[this.manifest.id]?.config as { apiKey?: string } | undefined;
    const apiKey = config?.apiKey || process.env.WEATHER_API_KEY;

    if (!apiKey) {
      context.logger.warn('Weather plugin: No API key configured', { component: this.manifest.id });
    }

    context.moduleManager.registerToolExecution(
      'tool.get_weather',
      async (args: z.infer<typeof WeatherSchema>) => {
        if (!apiKey) {
          return {
            content: [{ type: 'text', text: 'Weather API key not configured' }],
            isError: true
          };
        }

        // Simulated API call - replace with actual weather API
        const temp = Math.round(Math.random() * 30 + 10);
        const unit = args.unit === 'fahrenheit' ? '°F' : '°C';
        const displayTemp = args.unit === 'fahrenheit' ? temp * 9/5 + 32 : temp;

        return {
          content: [{
            type: 'text',
            text: `Weather in ${args.city}: ${displayTemp}${unit}`
          }],
          structuredContent: { city: args.city, temperature: displayTemp, unit: args.unit }
        };
      },
      'get_weather',
      'Get current weather for a city',
      WeatherSchema,
      this.manifest.id
    );

    context.logger.info('Weather plugin loaded', { component: this.manifest.id });
  }
}

export default WeatherPlugin;
```

---

## 10. Troubleshooting

### Tool/Plugin Not Loading

1. **Check directory structure**
   ```
   tools/
   └── my-tool/
       └── index.ts  ✓
   ```

2. **Verify manifest** - Ensure `id`, `type`, `entry` are correct

3. **Check logs** for errors:
   ```
   ModuleManager: Failed to load module
   ```

4. **Verify interface implementation** - Class must implement `IUnifiedTool` or `IUnifiedPlugin`

### Tool Not Appearing in List

1. Run `tools/list` via Inspector
2. Check tool ID matches what you're calling
3. Verify `registerToolExecution` was called in `onLoad`

### Input Validation Failing

1. Check Zod schema matches your call parameters
2. Verify required fields are provided
3. Check types match (string vs number)

### Hot Reload Not Working

1. Ensure running in development mode
2. Check file is in correct directory (toolsDir/pluginsDir)
3. Verify ModuleWatcher is running (check logs)

### Configuration Not Loading

1. Add plugin config under `plugins` key in infected.config.json
2. Access via `context.config.plugins?.[manifest.id]?.config`

---

## Summary

You now have all the knowledge needed to create:

| Type | Use For | Key Method |
|------|---------|------------|
| **Tool** | Stateless operations | `execute()` method |
| **Plugin** | Multi-tool packages, stateful logic | `registerToolExecution()` in `onLoad()` |

### Next Steps

1. Try the quickstart example
2. Create your first tool
3. Expand to a plugin with multiple tools
4. Explore manager access (ProcessManager, FileManager, etc.)
5. Contribute to the community!

---

*Last updated: March 2026*
