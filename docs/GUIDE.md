# Developer's Guide: Extending the @infected/infected Server

This guide provides comprehensive instructions on how to extend the `@infected/infected` server by creating custom tools and plugins using its new unified, dynamic module system. This system, orchestrated by the `ModuleManager` and `ModuleWatcher`, enables seamless integration of new functionalities conforming to the `IUnifiedModule` interface, often without requiring a full server restart due to hot-reloading capabilities. The server's modular and extensible design allows developers to seamlessly integrate new functionalities without modifying its core codebase.

## Quickstart (Recommended)

If you want the fastest path to working modules, use this workflow:

1. Create a folder under `tools/` or `plugins/`.
2. Add an `index.ts` that exports a default class implementing `IUnifiedTool` or `IUnifiedPlugin`.
3. Define `manifest` directly in code (recommended).
4. For tools, define `manifest.inputs` using a Zod shape for reliable validation and Inspector compatibility.
5. Start the server with `npm run dev`.
6. Verify from logs that your module loaded.
7. Test with MCP Inspector CLI.

Inspector examples:

```bash
# List tools
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3001/mcp --transport http --method tools/list

# Call a tool
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3001/mcp --transport http --method tools/call --tool-name tool.my_tool --tool-arg key=value
```

Notes from real-world usage:
- Prefer code-first `manifest` over `module.json` when iterating quickly.
- Keep tool IDs stable (`tool.*`, `plugin.*`) to avoid collisions.
- If using Inspector in HTTP mode, run one CLI command per fresh session when your server enforces single active stream sessions.

## 1. Creating External Tools

External tools are now a specific `type: 'tool'` of unified modules. They are standalone scripts (TypeScript or JavaScript) that the `@infected/infected` server can discover, load, and register dynamically. They are ideal for adding new specific functionalities that can be called by an MCP client or other modules.

### Fast Demo (Code-First, Minimal)

This is the easiest production-friendly pattern.

Directory:

```text
tools/echo-plus/index.ts
```

`tools/echo-plus/index.ts`:

```typescript
import { z } from 'zod';
import { IUnifiedTool, UnifiedModuleContext, UnifiedModuleManifest } from '../../src/core/module-system/module-types.js';

const EchoInputs = {
  text: z.string().min(1),
  uppercase: z.boolean().optional(),
};

class EchoPlusTool implements IUnifiedTool {
  manifest: UnifiedModuleManifest = {
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

  async execute(args: { text: string; uppercase?: boolean }): Promise<{ output: string }> {
    const output = args.uppercase ? args.text.toUpperCase() : args.text;
    return { output };
  }
}

export default EchoPlusTool;
```

Test:

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3001/mcp --transport http --method tools/call --tool-name tool.echo_plus --tool-arg text=hello --tool-arg uppercase=true
```

### Basic Tool Structure

A tool is defined by a **subdirectory** containing an `index.ts` (or `index.js`) file that exports a **default class** implementing the `IUnifiedTool` interface. Metadata can be supplied via `module.json` or directly in the class `manifest`.

The `IUnifiedTool` interface requires:

-   **`manifest: UnifiedModuleManifest`**: An object containing the tool's metadata (from class manifest or `module.json`). This includes:
    -   **`id` (string)**: A unique identifier for the tool (e.g., `tool.my_tool_name`).
    -   **`name` (string)**: A human-readable name for the tool.
    -   **`version` (string)**: The tool's version.
    -   **`type` (string)**: Must be `'tool'`.
    -   **`entry` (string)**: The relative path to the tool's main file (e.g., `index.ts`).
    -   **`description` (string, optional)**: A clear, concise explanation of what the tool does.
    -   **`inputs` (Zod schema, optional)**: A Zod schema defining the expected input arguments for the tool's `execute` function.
    -   **`outputs` (Zod schema, optional)**: A Zod schema defining the expected output of the tool.
-   **`onLoad(context: UnifiedModuleContext): Promise<void>`**: An asynchronous method called when the tool is loaded. Perform any setup here.
-   **`execute(args: any, context: UnifiedModuleContext): Promise<any>`**: The core logic of your tool. It receives the validated arguments and returns a result.
-   **`onUnload?(): Promise<void>` (optional)**: An asynchronous method called when the tool is being unloaded (e.g., during server shutdown or hot-reload). Use this for cleanup.
-   **`onError?(error: Error, context: UnifiedModuleContext): Promise<void>` (optional)**: An asynchronous method called if an error occurs within the tool's lifecycle methods.

The `UnifiedModuleContext` object provides access to the `McpServer` instance, `InfectedConfig`, `ManagerInstances`, `logger`, and the `ModuleManager` itself.

### Tool Output Format

All MCP tools should return their results using the MCP `CallToolResult` structure so clients can render both unstructured logs and structured data. The `content` array carries human-readable text (or embedded resources) that the model or UI can display, while `structuredContent` exposes JSON-friendly data for downstream parsing. When you also provide an `outputSchema` inside the manifest, the server must return structured data that matches the schema, and for backwards compatibility you should mirror that payload in a `TextContent` block inside `content`. `isError` should be set only if the tool itself failed but the MCP call still succeeded, letting agents react without the call turning into a protocol-level error. citeturn0search0turn0search3

Here is the minimal pattern that mirrors what other tools (e.g., `write_file`) already use:

```ts
return {
  content: [
    {
      type: 'text',
      text: 'Wrote 1 file successfully. Use `read_file` to verify.',
    },
  ],
  structuredContent: {
    filesWritten: 1,
    path: args.path,
  },
};
```

If your tool returns more than simple text, you can mix other content blocks (`image`, `resource`, `embeddedResource`) or include annotations for priority/audience while still supplying a final `text` summary so the model output does not lose context. For tools that already expose `outputSchema`, `structuredContent` must conform to the schema, and returning the same payload inside a `TextContent` block keeps older clients compatible. Use this format when you return Git or GitHub log output so agents can display the same log block that `write_file`, `read_file`, and the standard MCP examples produce. citeturn0search3turn0search5

### Example: `hello-world/module.json` and `hello-world/index.ts` (located in `infected/tools/hello-world/`)

**`infected/tools/hello-world/module.json`:**
```json
{
  "id": "tool.hello_world",
  "name": "Hello World Tool",
  "version": "1.0.0",
  "type": "tool",
  "entry": "index.ts",
  "description": "Greets a specified name, optionally in uppercase.",
  "inputs": {
    "name": { "type": "string", "optional": true, "default": "World", "description": "The name to greet." },
    "loud": { "type": "boolean", "optional": true, "default": false, "description": "If true, the greeting will be in uppercase." }
  },
  "outputs": {
    "greetingMessage": { "type": "string", "description": "The generated greeting message." }
  }
}
```

**`infected/tools/hello-world/index.ts`:**
```typescript
import { IUnifiedTool, UnifiedModuleContext, UnifiedModuleManifest } from '../../src/core/module-system/module-types.js';
import { z } from "zod";

// Define the input schema for the hello_world tool
const HelloWorldInputSchema = z.object({
  name: z.string().optional().default("World").describe("The name to greet."),
  loud: z.boolean().optional().default(false).describe("If true, the greeting will be in uppercase.")
});

class HelloWorldTool implements IUnifiedTool {
  public manifest: UnifiedModuleManifest; // This will be set by ModuleManager from module.json

  constructor() {
    // Manifest is typically loaded from module.json, but a fallback or default can be here
    this.manifest = {
      id: "tool.hello_world",
      name: "Hello World Tool",
      version: "1.0.0",
      type: "tool",
      entry: "index.ts",
      description: "Greets a specified name, optionally in uppercase.",
      inputs: {
        name: { type: "string", optional": true, "default": "World", "description": "The name to greet." },
        loud: { type: "boolean", "optional": true, "default": false, "description": "If true, the greeting will be in uppercase." }
      },
      outputs: {
        greetingMessage: { type: "string", "description": "The generated greeting message." }
      }
    };
  }

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    context.logger.info(`Tool '${this.manifest.name}' loaded.`, { component: this.manifest.id });
  }

  async execute(args: z.infer<typeof HelloWorldInputSchema>, context: UnifiedModuleContext): Promise<{ greetingMessage: string }> {
    const { name, loud } = args;
    let greeting = `Hello, ${name}!`;

    if (loud) {
      greeting = greeting.toUpperCase();
    }

    context.logger.info(`'${this.manifest.name}' tool executed. Greeting: ${greeting}`, { component: this.manifest.id });

    return { greetingMessage: greeting };
  }

  async onUnload(): Promise<void> {
    // Perform any cleanup
    console.log(`Tool '${this.manifest.name}' unloaded.`);
  }

  async onError(error: Error, context: UnifiedModuleContext): Promise<void> {
    context.logger.error(`Tool '${this.manifest.name}' encountered an error: ${error.message}`, { error, component: this.manifest.id });
  }
}

export default HelloWorldTool;
```

### Placement and Discovery

1.  Create a new **subdirectory** for your tool (e.g., `infected/tools/my-new-tool/`).
2.  Inside this directory, create an `index.ts` (or `index.js`) file that exports your tool class as default.
3.  Add metadata either in `module.json` or directly in class `manifest`.
4.  The `ModuleManager` automatically discovers and loads modules from subdirectories within the directory configured by `toolsDir` in `infected.config.json` (defaults to `./tools`).
5.  **Hot-reloading is supported**: Changes to tool files (both `module.json` and `index.ts/js`) will be detected by the `ModuleWatcher`, and the `ModuleManager` will automatically unload and reload the tool without requiring a server restart.

### Best Practices for Tools

-   **Unified Module Structure**: Always use the `IUnifiedTool` interface and define metadata in class `manifest` or `module.json`.
-   **Descriptive `name` and `description`**: These are crucial for discoverability and proper usage by MCP clients and LLMs.
-   **Strict `inputs` (parameters) and `outputs` schemas**: Use Zod (or equivalent if used directly in manifest) to define clear and robust input/output validation in `module.json`.
-   **Idempotency**: Design tools to be idempotent where possible (running multiple times yields the same result) for reliability.
-   **Error Handling**: Implement `onError` and return clear error messages and structured error content for failures.
-   **Logging**: Use the `UnifiedModuleContext`'s `logger` for consistent logging, always including a `component` property (e.g., `this.manifest.id`).
-   **Security**: Tools do not need to implement their own permission checks. The server's `PermissionManager` centrally enforces tool execution policies (allowlists, blocklists, default policy) based on the server's configuration. Be aware that a `SecurityError` might be thrown if the tool is not permitted.
-   **`onLoad` for setup, `onUnload` for cleanup**: Use these lifecycle hooks for any resource management.

Tool-specific practical tips:
- Keep the tool surface small: one clear responsibility per tool.
- Always include deterministic return fields (`ok`, `message`, `data`) for easier agent use.
- Validate and normalize optional args early (defaults, type conversion).
- If a tool wraps external CLIs/APIs, enforce timeouts and return stderr in failures.

## 2. Creating Plugins

Plugins are now a specific `type: 'plugin'` of unified modules. They are more comprehensive extensions than tools, capable of adding multiple tools, modifying server behavior, or integrating with external services.

### Fast Demo Plugin (Registers Two Tools)

Directory:

```text
plugins/time-utils/module.json
plugins/time-utils/index.ts
```

`plugins/time-utils/module.json`:

```json
{
  "id": "plugin.time_utils",
  "name": "Time Utilities",
  "version": "1.0.0",
  "type": "plugin",
  "entry": "index.ts",
  "description": "Registers utility tools for time and date operations."
}
```

`plugins/time-utils/index.ts`:

```typescript
import { z } from 'zod';
import { IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest } from '../../src/core/module-system/module-types.js';

class TimeUtilsPlugin implements IUnifiedPlugin {
  manifest: UnifiedModuleManifest = {
    id: 'plugin.time_utils',
    name: 'Time Utilities',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.ts',
    description: 'Registers utility tools for time and date operations.',
  };

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    context.moduleManager.registerToolExecution(
      'tool.time_now',
      async () => ({ iso: new Date().toISOString() }),
      'time_now',
      'Returns current ISO timestamp',
      {},
      this.manifest.id
    );

    context.moduleManager.registerToolExecution(
      'tool.date_add_days',
      async (args: { date: string; days: number }) => {
        const d = new Date(args.date);
        d.setDate(d.getDate() + args.days);
        return { result: d.toISOString().slice(0, 10) };
      },
      'date_add_days',
      'Adds days to a YYYY-MM-DD date',
      {
        date: z.string(),
        days: z.number(),
      },
      this.manifest.id
    );

    context.logger.info('Time Utils plugin loaded and tools registered.', { component: this.manifest.id });
  }
}

export default TimeUtilsPlugin;
```

Test:

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3001/mcp --transport http --method tools/call --tool-name tool.time_now
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:3001/mcp --transport http --method tools/call --tool-name tool.date_add_days --tool-arg date=2026-03-02 --tool-arg days=5
```

> **Tip:** Pass your plugin's manifest ID as the optional sixth argument when calling `registerToolExecution`. If you need to bypass ModuleManager’s timeout wrapper (for long-running helpers such as the Git/GH tools), set the optional seventh argument (`skipTimeout`) to `true` so the tool runs without the generic 30 s guard while still honoring permissions and caching.

### Plugin Structure

A plugin is defined by a **subdirectory** containing an `index.ts` (or `index.js`) file that exports a **default class** implementing the `IUnifiedPlugin` interface. Metadata can be supplied via `module.json` or directly in the class `manifest`.

The `IUnifiedPlugin` interface requires:

-   **`manifest: UnifiedModuleManifest`**: An object containing the plugin's metadata (from class manifest or `module.json`). This includes:
    -   **`id` (string)**: A unique identifier for the plugin (e.g., `plugin.my_plugin_name`).
    -   **`name` (string)**: A human-readable name for the plugin.
    -   **`version` (string)**: The plugin's version.
    -   **`type` (string)**: Must be `'plugin'`.
    -   **`entry` (string)**: The relative path to the plugin's main file (e.g., `index.ts`).
    -   **`description` (string, optional)**: A clear, concise explanation of what the plugin does.
    -   **`provides` (string[], optional)**: An array of strings describing what the plugin provides (e.g., "tools", "resources").
    -   **`dependencies` (string[], optional)**: An array of strings representing IDs of other modules this plugin depends on.
-   **`onLoad(context: UnifiedModuleContext): Promise<void>`**: An asynchronous method called when the plugin is loaded. This is where the plugin registers its tools, sets up event listeners, or performs any necessary initialization.
-   **`onUnload?(): Promise<void>` (optional)**: An asynchronous method called when the plugin is being unloaded (e.g., during server shutdown or hot-reload). This is crucial for cleaning up resources, such as deregistering event listeners or closing connections.
-   **`onError?(error: Error, context: UnifiedModuleContext): Promise<void>` (optional)**: An asynchronous method called if an error occurs within the plugin's lifecycle methods.

The `UnifiedModuleContext` object provides access to the `McpServer` instance, `InfectedConfig`, `ManagerInstances`, `logger`, and the `ModuleManager` itself.

### Example: `example-plugin/module.json` and `example-plugin/index.ts` (located in `infected/plugins/example-plugin/`)

**`infected/plugins/example-plugin/module.json`:**
```json
{
  "id": "plugin.example_plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "type": "plugin",
  "entry": "index.ts",
  "description": "An example plugin demonstrating tool registration and configuration access."
}
```

**`infected/plugins/example-plugin/index.ts`:**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InfectedConfig } from '../../src/config/index.js'; // Relative path
import { IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest } from '../../src/core/module-system/module-types.js';
import { z } from 'zod';

// Define a schema for the example plugin's specific configuration
const ExamplePluginConfigSchema = z.object({
  greeting: z.string().default("Hello from default config!").describe("Custom greeting for the plugin."),
});

const helloPluginSchema = z.object({
  name: z.string().describe("The name to say hello to."),
});

class ExamplePlugin implements IUnifiedPlugin {
  public manifest: UnifiedModuleManifest; // This will be set by ModuleManager from module.json

  constructor() {
    this.manifest = {
      id: "plugin.example_plugin",
      name: "Example Plugin",
      version: "1.0.0",
      type: "plugin",
      entry: "index.ts",
      description: "An example plugin demonstrating tool registration and configuration access."
    };
  }

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    context.logger.info(`  ${this.manifest.name}: Initializing...`, { component: this.manifest.id });

    // Access plugin-specific configuration
    const myPluginConfig = ExamplePluginConfigSchema.parse(context.config[this.manifest.id]?.config || {});
    context.logger.info(`  ${this.manifest.name}: Using greeting: "${myPluginConfig.greeting}"`, { component: this.manifest.id });

    // Register a tool from the plugin
    // Tools registered here will automatically be wrapped by ModuleManager for security, caching, and monitoring.
    context.moduleManager.registerToolExecution(
      "plugin_hello", // Tool ID
      async (args: z.infer<typeof helloPluginSchema>) => {
        const { name } = args;
        const message = `${myPluginConfig.greeting}, ${name}!`;
        context.logger.info(`'plugin_hello' tool executed. Message: ${message}`, { component: this.manifest.id });
        return {
          content: [{ type: "text", text: message }],
          structuredContent: { greetingMessage: message },
        };
      },
      "Plugin Hello", // Tool Name
      "A tool provided by the ExamplePlugin to greet a user.", // Tool Description
      helloPluginSchema, // Input Schema
      this.manifest.id
    );
    
    context.logger.info(`  ${this.manifest.name}: 'plugin_hello' tool registered.`, { component: this.manifest.id });
    context.logger.info(`  ${this.manifest.name}: Plugin loaded and initialized.`, { component: this.manifest.id });
  }

  async onUnload(): Promise<void> {
    // Deregistering tools explicitly is now handled by the ModuleManager
    // This method is for plugin-specific cleanup (e.g., closing connections, disposing timers)
    console.log(`Plugin '${this.manifest.name}' shutting down.`);
  }

  async onError(error: Error, context: UnifiedModuleContext): Promise<void> {
    context.logger.error(`Plugin '${this.manifest.name}' encountered an error: ${error.message}`, { error, component: this.manifest.id });
  }
}

// Export the class
export default ExamplePlugin;
```

### Placement and Loading

1.  Create a new **subdirectory** for your plugin (e.g., `infected/plugins/my-new-plugin/`).
2.  Inside this directory, create an `index.ts` (or `index.js`) file that exports your plugin class as default.
3.  Add metadata either in `module.json` or directly in class `manifest`.
4.  The `ModuleManager` automatically discovers and loads modules from subdirectories within the directory configured by `pluginsDir` in `infected.config.json` (defaults to `./plugins`).
5.  **Hot-reloading is supported**: Changes to plugin files (both `module.json` and `index.ts/js`) will be detected by the `ModuleWatcher`, and the `ModuleManager` will automatically unload and reload the plugin without requiring a server restart.

### Best Practices for Plugins

-   **Unified Module Structure**: Always use the `IUnifiedPlugin` interface and define metadata in class `manifest` or `module.json`.
-   **Unique IDs and Names**: Ensure your plugin's ID (in `module.json`) and any tools it registers are unique.
-   **Configuration**: Leverage the plugin-specific `config` object (from `infected.config.json`) accessible via `UnifiedModuleContext` to make your plugin configurable. Validate this config using Zod schemas.
-   **Resource Management**: Implement the `onUnload()` method to clean up resources (e.g., close connections, dispose of timers). Tool deregistration is now handled centrally by the `ModuleManager`.
-   **Error Handling**: Implement `onError` for graceful error handling during plugin lifecycle and tool execution.
-   **Logging**: Use the `UnifiedModuleContext`'s `logger` for consistent and structured logging, always including a `component` property (e.g., `this.manifest.id`).

Plugin-specific practical tips:
- Register tool IDs with clear ownership prefixes (`tool.<plugin_or_domain>_*`).
- Keep plugin startup fast; avoid heavy network calls in `onLoad`.
- Put long-running setup behind lazy execution inside tools.
- Fail loudly in `onLoad` with actionable errors so startup logs are useful.

## 3. Extending the Platform

The unified runtime now focuses on tools and plugins. Rather than a separate skill or prompt layer, high-level workflows should be implemented as orchestrations within tools/plugins that call other tools, manage state, or run complex processes.

### Placement & Discovery

1.  Drop tool modules under the directory configured by `toolsDir` (defaults to `./tools`) and plugin modules under `pluginsDir` (defaults to `./plugins`).
2.  Ensure each module exports a default class that implements the appropriate interface (`IUnifiedTool` or `IUnifiedPlugin`) and provides a minimal `manifest` (either in the class or via `module.json`) describing `id`, `name`, `version`, `type`, and `entry`.
3.  Keep heavy orchestration logic inside plugin tools or commands rather than a special skill wrapper; plugins can coordinate multiple tools through the `UnifiedModuleContext` provided by the `ModuleManager`.
4.  Hot-reloading is automatic: the `ModuleWatcher` observes `toolsDir` and `pluginsDir`, and the `ModuleManager` reloads changed modules without restarting the server.

### Supervisor Guidance

- Treat plugins as the place for stateful helpers, connectors, or orchestration runners, and keep tools lightweight (stateless handlers for well-defined actions).
- Reuse existing module interfaces for configuration, logging, and permissions; the `UnifiedModuleContext` gives you access to `server`, `config`, `managers`, and `logger`.
- Validate inputs with Zod (as shown earlier for plugins) to keep tool invocations predictable and safe.
- Instrument modules with structured logging and explicit `component` metadata to make troubleshooting easier when the module is reloaded.

## Next Steps

With these guides, you have the foundation to expand the `@infected/infected` server's capabilities. Experiment with creating your own tools and plugins, contributing to a more powerful and versatile MCP ecosystem.

## Troubleshooting Checklist (Tools/Plugins)

If your tool or plugin does not appear or fails to run:

1. Confirm server config points to correct directories: `toolsDir`, `pluginsDir`.
2. Confirm export is `default` class implementing correct interface.
3. Confirm `manifest.id`, `manifest.type`, and `manifest.entry` are valid.
4. Check startup logs for `ModuleManager: Failed to load module`.
5. Verify tool registration logs from `ToolLoader` for tools.
6. Run Inspector `tools/list` first to ensure visibility.
7. If call params are not arriving, check your `manifest.inputs` shape.
8. Use one fresh Inspector CLI session per call when stream-session conflicts occur.
