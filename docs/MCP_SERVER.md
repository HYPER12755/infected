# Model Context Protocol (MCP) Server Documentation

This document describes the implementation and usage of the Model Context Protocol (MCP) server within this project. The core server functionality is encapsulated in the `InfectedServer` class, which leverages the `@modelcontextprotocol/sdk` to provide a robust and extensible agent environment.

## 1. Overview of InfectedServer

The `InfectedServer` acts as the main orchestrator, initializing and managing various components that contribute to the overall MCP server functionality. It wraps the `McpServer` instance from the SDK and extends its capabilities with project-specific logic, including:

*   **Configuration Management**: Handles both global project configuration (`ConfigManager`) and MCP-specific shell configuration (`McpShellConfigManager`).
*   **Module and Tool Management**: Dynamically loads modules and tools, allowing for hot-reloading and extensibility.
*   **Security and Permissions**: Implements API key authentication and a granular permission system for tool execution.
*   **Transport Layer**: Supports multiple communication protocols (`stdio`, `http`, `sse`).
*   **Lifecycle Management**: Manages server startup, shutdown, and cleanup processes.

## 2. Core Components and Their Roles

The `InfectedServer` integrates with several key managers and loaders to provide its functionality:

*   **`McpServer` (from SDK)**: The foundational component that provides the MCP interface for tools, resources, and communication.
*   **`ConfigManager`**: Manages the main project configuration (`infected.config.json`).
*   **`McpShellConfigManager`**: Manages configuration specific to the MCP shell server, including enhanced security settings.
*   **`ModuleManager`**: The central orchestrator for all unified modules (tools, plugins, skills). It handles module discovery, loading, unloading, hot-reloading (via `ModuleWatcher`), and validation against `IUnifiedModule` and `UnifiedModuleManifest` schemas. It also provides a robust registration mechanism for tools, wrapping them with security, caching, and monitoring.
*   **`ToolLoader`**: Acts as an adapter, listening to `ModuleManager` events to dynamically register and deregister tools with the `McpServer`. It ensures tools are properly integrated and their lifecycle methods (`onLoad`, `execute`, `onUnload`) are managed.
*   **`PluginLoader`**: Acts as an adapter, listening to `ModuleManager` events to dynamically initialize and shut down plugins. It ensures plugin lifecycle methods (`onLoad`, `onUnload`) are properly invoked.
*   **`SkillLoader`**: Acts as an adapter, listening to `ModuleManager` events to dynamically initialize and shut down skills. It ensures skill lifecycle methods (`onLoad`, `execute`, `onUnload`) are properly invoked.
*   **`ProcessManager`**: Manages background shell processes, including execution, monitoring, and output handling.
*   **`TerminalManager`**: Manages interactive terminal sessions.
*   **`FileManager`**: Provides file system access and management capabilities.
*   **`MonitoringManager`**: Monitors server activity, tool usage, and performance.
*   **`SecurityManager`**: Enforces security policies, including LLM security and an enhanced evaluator.
*   **`CommandHistoryManager`**: Records and manages command execution history.
*   **`ToolCacheManager`**: Caches tool definitions and potentially tool execution results for performance.
*   **`PermissionManager`**: Manages permissions for tool execution, ensuring only authorized actions are performed.

## 3. Transports

The `InfectedServer` can operate over different transports:

*   **`stdio`**: For local, command-line-based interaction. The server connects directly to standard input/output.
*   **`http`**: Provides a streamable HTTP endpoint for client communication. Uses an Express.js application.
*   **`sse` (Server-Sent Events)**: Provides real-time event streaming over HTTP, also via an Express.js application.

### Multi-Session Support (Streamable HTTP)

The Streamable HTTP transport is designed to support multiple independent client sessions at once. Servers can maintain a `Mcp-Session-Id` for each connected client and reuse the same session across HTTP POST requests, optionally combining them with SSE streams for server-initiated notifications. Each SSE stream is owned by one session and servers must send each JSON-RPC message through exactly one stream to prevent duplication. Clients may also keep several SSE streams open simultaneously for high-throughput scenarios, and servers can resume broken streams via the `Last-Event-ID` header so long as they track stream-specific event IDs within the same session. citeturn0search0turn0search9

#### Session Logging and Client Metadata

Each HTTP/SSE session emits structured log entries (`logger.info`) when it is initialized, closed, or when errors occur. The `transports/http.ts` and `transports/sse.ts` components maintain per-session metadata maps, which include the session ID, request origin, client snapshot, and authentication status, and they write those details to the shared logs so operators can track when a client connects, which tools it calls, and how authentication was handled. Authentication events themselves are logged by `auth/index.ts`, so each API key usage, token generation, or authorization failure is tied to the session that triggered it. This makes it straightforward to audit multi-client traffic while keeping each session isolated.

## 4. Authentication and Security

### API Key Authentication

For HTTP and SSE transports, the server supports API key authentication.
*   If enabled, requests must include an `X-API-Key` header or an `apiKey` query parameter with a valid key.
*   The server can generate a random API key for a session if `randomAuthTokenEnabled` is set in the configuration.
*   If authentication is enabled but no API keys are configured, the endpoints become publicly accessible, and a warning is logged.

### Advanced Random Token Generator

For multi-client setups, you can enable the advanced random token generator (`auth.randomAuthTokenAdvanced`). When this feature is enabled, the server creates the configured number of unique tokens at startup, optionally with a prefix or timestamp suffix, and exposes them as the active API keys. This lets each client receive a distinct credential while keeping the entire set valid for the session. The advanced generator is disabled by default and must be explicitly enabled in the configuration, preserving the original static-key behavior unless you opt into the advanced mode.

### Permission-Based Tool Execution

The `PermissionManager` intercepts tool execution requests. Before a tool's `execute` function is called, the `PermissionManager` checks if the requested tool operation is permitted based on the server's configuration. If not, a `SecurityError` is thrown.

## 5. Configuration

The server's behavior is heavily influenced by its configuration, managed by `ConfigManager` and `McpShellConfigManager`. Key configurable aspects include:

*   `INFECTED_INSTALL_ROOT`: Install root used to load `.env` and `infected.config.json` (important for global installs).
*   `INFECTED_WORKSPACE_ROOT`: Workspace root where tools execute (defaults to the current working directory).
*   `transport`: (stdio, http, sse)
*   `port`: For HTTP/SSE transports.
*   `hotReload`: Enables/disables automatic re-loading of modules and tools on file changes.
*   `modules`: This field is primarily for listing initial built-in modules to load. External tools, plugins, and prompts are now automatically discovered from directories configured in `toolsDir`, `pluginsDir`, and `promptsDir` respectively.
*   `toolsDir`: Directory where custom tools are located.
*   `cache`: Configuration for tool caching.
*   `auth`: API key authentication settings.
*   `permissions`: Default permission policies and granular tool permissions.
*   `llmSecurity`: LLM security settings.

### Environment Overrides & Runtime Roots

The `.env` file (see `.env.example`) lives under `INFECTED_INSTALL_ROOT` and shares many of the same keys as `infected.config.json` because `ConfigManager` merges the two sources. If you define `TRANSPORT`, `PORT`, `MODULES`, `HOT_RELOAD`, `TOOLS_DIR`, `SKILLS_DIR`, or `PLUGINS_DIR` in `.env`, you are overriding the corresponding property in `infected.config.json`. The `.env` file also exposes module-specific helpers such as `SHELL_ALLOWLIST`, `MEMORY_FILE_PATH`, and `FETCH_DOMAIN_WHITELIST` so they can be tuned without modifying the JSON file. Finally, the runtime roots `INFECTED_INSTALL_ROOT` and `INFECTED_WORKSPACE_ROOT` are set before tools/modules run, allowing helpers like `src/utils/runtime-roots.ts` to resolve working directories consistently. The workspace root is used for development (the local project directory) while the install root represents the directory where the global `infected` command was invoked, ensuring both environments share the same root resolution behavior.

## 6. Lifecycle

### Startup (`start()` method)

1.  Loads primary and MCP shell configurations.
2.  Initializes `ServiceContainer`, which instantiates all managers and module loaders.
3.  Generates a random authentication token if enabled.
4.  Configures `SecurityManager`, `ToolCacheManager`, and `PermissionManager` with their respective settings.
5.  Starts the `ModuleManager`, which initiates module discovery, loading, and hot-reloading for all module types (tools, plugins, skills).
6.  Starts the individual `ToolLoader`, `PluginLoader`, and `SkillLoader` adapters to listen for events from the `ModuleManager`.
7.  Initializes and connects the configured transport (`stdio`, `http`, or `sse`).

### Shutdown (`cleanup()` method)

The `cleanup()` method is responsible for gracefully shutting down various components:

1.  Cleans up `ProcessManager`, `TerminalManager`, and `FileManager` resources.
2.  Performs `MonitoringManager` cleanup.
3.  Stops the `ModuleManager` (which unloads all modules) and then stops the `ToolLoader`, `PluginLoader`, and `SkillLoader` (which stop listening for events).
4.  Stops the `ToolCacheManager`'s cleanup interval.
