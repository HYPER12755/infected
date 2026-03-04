# Project Structure: @infected/infected Unified MCP Server

This document outlines the architecture and file organization of the `@infected/infected` unified Model Context Protocol (MCP) server. The server is designed to be modular, extensible, and production-ready, integrating functionalities from multiple original MCP servers.

## Top-Level Files and Directories

- **`.env.example`**: Provides an example of environment variables that can be set to configure the server. This includes settings for core server operation, caching, authentication, tool permissions, and specific MCP Shell server parameters, as well as LLM security configuration.
- **`index.js`**: JS entrypoint shim for global CLI execution; forwards to `dist/index.js` after build.
- **`.gitignore`**: Specifies intentionally untracked files that Git should ignore.
- **`infected.config.json.example`**: An example configuration file for the server, demonstrating how to set up transports, modules, tool directories, caching, authentication (API Key, random token generation), tool permissions, and LLM security features. This file is parsed by the `ConfigManager` and defines the server's runtime behavior.
- **`package.json`**: Defines the project metadata (name, version, description), dependencies, and scripts. It declares the `infected` command-line tool via `bin` pointing to `dist/index.js`.
- **`package-lock.json`**: Records the exact versions of dependencies installed, ensuring consistent builds.
- **`README.md`**: Provides a high-level overview of the server, its features, and how to get started.
- **`GUIDE.md`**: Explains how to create plugins and external tools for the server, including robust examples.
- **`tsconfig.json`**: TypeScript configuration file, specifying compiler options and project settings.
- **`plugins/`**: Directory for dynamically loadable plugins. Each plugin resides in its own subdirectory and includes an `index.ts` (or `index.js`) and `module.json` for metadata, conforming to the `IUnifiedModule` interface.

Extensions now live exclusively under `tools/` or `plugins/`; the legacy `prompts/` directory and the associated skill examples have been removed.

- **`src/`**: The main source code directory for the unified server.

## `src/` Directory Breakdown

The `src/` directory is the heart of the `infected` server, organizing its functionalities into core components, modules, and utilities.

- **`index.ts`**: The primary entry point for the `infected` command-line interface (CLI). It handles initial CLI argument parsing (e.g., `--configure`, `plugin add/remove`) and orchestrates the startup of the `InfectedServer`.
- **`server.ts`**: Contains the core `InfectedServer` class, which is responsible for initializing the MCP server, loading configurations, orchestrating module and tool loading, setting up transport mechanisms (STDIO, HTTP, SSE), and managing the server's lifecycle (start, cleanup). It also integrates global functionalities like API Key authentication (with optional random token generation) and centralizes tool permission checks.

### `src/cli/`

Handles command-line interface related functionalities.

- **`configure.ts`**: Provides the interactive CLI configuration tool (`infected --configure`). This tool guides users through setting up modules, transports, ports, tool directories, and saving the configuration.
- **`plugin-cli.ts`**: Manages plugin operations from the CLI, such as adding or removing plugins from the server's configuration.

### `src/config/`

Manages server configuration.

- **`index.ts`**: Implements the `ConfigManager` class, responsible for loading the server's configuration from various sources (environment variables, `infected.config.json`) and providing it to other components.
- **`schema.ts`**: Defines the `InfectedConfigSchema` using Zod, which validates the structure and types of the server's configuration. This includes detailed schemas for `auth` (with `enabled`, `apiKey` supporting single/multiple keys and 8-character minimum length, `randomAuthTokenEnabled`), `permissions` (with `defaultPolicy`, `toolAllowlist`, `toolBlocklist`), and `llmSecurity` (with `enabled`, `provider`, `model`, `apiKey`, `elicitationEnabled`, `skipSafeCommands`), among other settings.

### `src/core/`

Contains core server functionalities and managers.

- **`config.ts`**: (Might be deprecated or merged into `config/index.ts` or `server.ts`) Historically could have contained generic configuration logic.
- **`enhanced-history-manager.ts`**: Manages the command history, potentially with enhanced features like context and security-related metadata. Ported from `mcp-shell-server`.
- **`file-manager.ts`**: Manages file-related operations for the process manager, including handling execution outputs. Ported from `mcp-shell-server`.
- **`file-storage-subscriber.ts`**: A subscriber for the streaming pipeline that stores process outputs to files. Part of the real-time output system from `mcp-shell-server`.
- **`logger.ts`**: Centralized logging utility based on `winston`, used consistently across the entire server for structured and configurable logging. Overrides global console methods.
- **`monitoring-manager.ts`**: Manages server and process monitoring, providing insights into resource usage and performance.
- **`permission-manager.ts`**: Enforces tool execution permissions based on the `permissions` configuration.
- **`process-manager.ts`**: Manages the execution of shell commands, including foreground, background, and detached modes, orchestrating real-time output streaming.
- **`plugin-loader.ts`**: Acts as an adapter, listening to `ModuleManager` events to initialize and shut down plugins, ensuring their `onLoad` and `onUnload` lifecycle methods are invoked.
- **`tool-loader.ts`**: Acts as an adapter, listening to `ModuleManager` events to register and deregister tools with the `McpServer`, wrapping their execution with security, caching, and monitoring.
- **`tool-cache-manager.ts`**: Implements an in-memory caching system for tool execution results.

### `src/core/module-system/`

This directory contains the core implementation of the new unified, dynamic module system.

-   **`module-manager.ts`**: The central orchestrator for all unified modules (tools and plugins). It extends `EventEmitter` and is responsible for module discovery, loading, unloading, hot-reloading (debounced), and validation. It uses `ModuleWatcher` for file system events and provides methods for module access and tool registration with added security, caching, and monitoring wrappers.
-   **`module-watcher.ts`**: A generic file system watcher that monitors specified directories for file `added`, `changed`, or `removed` events. It uses `fs.watch` with recursive monitoring and debounces events to prevent excessive notifications, providing a reliable source of file system changes to the `ModuleManager`.
-   **`module-types.ts`**: Defines the foundational TypeScript interfaces and Zod schemas for the unified module system, including:
    *   `ModuleType` (`tool`, `plugin`).
    *   `UnifiedModuleContext`: The standardized context passed to all module lifecycle methods.
    *   `UnifiedModuleManifestSchema`: The Zod schema for `module.json` files, defining required metadata (`id`, `name`, `version`, `type`, `entry`) and optional properties.
    *   `IUnifiedModule`, `IUnifiedTool`, `IUnifiedPlugin`: Base interfaces for all modules and their specific types, including lifecycle methods (`onLoad`, `onUnload`, `onError`) and an `execute` method for tools.
    *   Type guards (`isUnifiedTool`, `isUnifiedPlugin`) for safe type checking.

### `src/modules/`

Contains the implementations of individual server modules. Each module is a self-contained unit that registers its own tools and functionalities.

- **`fetch/`**: Implements the Fetch module for making HTTP requests.
  - **`index.ts`**: The main entry point for the Fetch module, registering `fetch` and `fetch_html` tools. It acts as a Node.js wrapper for an assumed Python microservice, handling security validations (robots.txt, domain whitelist, local network block).
- **`filesystem/`**: Implements the Filesystem module for file and directory operations.
  - **`filesystem-helpers.ts`**: Contains helper functions for filesystem operations, extracted from original `src/filesystem/index.ts`.
  - **`index.ts`**: The main entry point for the Filesystem module, registering tools like `read_text_file`, `write_file`, `list_directory`, etc. It manages allowed directories based on server configuration and client roots.
  - **`lib.ts`**: Core logic for various file operations, including reading, writing, editing, and listing.
  - **`path-utils.ts`**: Utility functions for path manipulation and normalization.
  - **`path-validation.ts`**: Logic for validating file paths against allowed directories to enforce sandboxing.
  - **`roots-utils.ts`**: Utility functions for managing root directories and their validation.
- **`memory/`**: Implements the Memory module for knowledge graph management.
  - **`index.ts`**: The main entry point for the Memory module, registering tools for creating, reading, updating, and deleting entities and relations in a knowledge graph.
  - **`memory-core.ts`**: Contains the core logic for the `KnowledgeGraphManager`, defining data structures for entities and relations, and handling persistence.
- **`sequentialthinking/`**: Implements the Sequential Thinking module for step-by-step reasoning.
  - **`index.ts`**: The main entry point for the Sequential Thinking module, registering the `sequentialthinking` tool.
  - **`lib.ts`**: Contains the core `SequentialThinkingServer` logic for processing thoughts, managing thought history, and emitting real-time notifications.
- **`ssh/`**: Implements the ShellKeeper-inspired terminal module for persistent PTY sessions and SSH-friendly tooling.
  - **`index.ts`**: Registers tools such as `terminal_execute`, `terminal_new_session`, and helpers that keep a PTY session alive across commands.
  - Provides clean command output, structured responses, and session utilities so agents can maintain long-lived shells or SSH bridges.
- **`shell/`**: Implements the Shell module for executing system commands.
  - **`entrypoint.ts`**: The original entry point of the `mcp-shell-server`, now integrated as part of the Shell module.
  - **`index.ts`**: The main entry point for the Shell module, registering tools like `shell_execute`, `process_get_execution`, etc. It integrates with `ProcessManager` for real-time output and `SecurityManager` for command allowlisting.
  - **`main.ts`**: Contains the core logic of the original `mcp-shell-server`, now adapted to fit within the unified server architecture.
  - **`schemas.ts`**: Defines Zod schemas specific to shell tools.
  - **`shell-tools.ts`**: Contains the implementation of the shell-related tool handlers, encapsulating the logic for executing commands and managing processes.

### `src/security/`

Handles security-related functionalities, primarily ported from `mcp-shell-server`.

- **`chat-completion-adapter.ts`**: Adapts chat completion APIs for security evaluation.
- **`enhanced-evaluator.ts`**: Implements an enhanced security evaluator, which utilizes the `llmSecurity` configuration (provider, model, API key, elicitation settings) for its LLM-driven analysis of shell commands.
- **`evaluator-types.ts`**: Defines types related to the security evaluator.
- **`manager.ts`**: Implements the `SecurityManager`, which orchestrates security checks and evaluations for command execution. It is initialized with both `mcpShellConfigManager`'s enhanced security config and the `llmSecurity` configuration, consolidating LLM-related settings for consistent use.
- **`security-llm-prompt-generator.ts`**: Generates prompts for LLM-based security evaluations.
- **`security-tools.ts`**: Defines security-related tools (if any).
- **`validator-criteria-manager.ts`**: Manages criteria used by the security validator.

### `src/transports/`

Contains implementations for different MCP transport mechanisms.

- **`http.ts`**: Implements the HTTP stream transport factory, allowing clients to interact with the server over HTTP.
- **`sse.ts`**: Implements the Server-Sent Events (SSE) transport factory, enabling real-time event streaming to clients.
- **`stdio.ts`**: Implements the standard input/output (STDIO) transport, typically used for local CLI interactions.

### `src/types/`

Defines TypeScript interfaces and types used across the project.

- **`index.ts`**: Contains core interfaces like `ManagerInstances`, which define the collection of all instantiated managers. It now references unified module types (`IUnifiedModule`, `UnifiedModuleManifest`) from `src/core/module-system/module-types.ts`, replacing older, specific `Module`, `Plugin`, and `Skill` interfaces.
- **`shell-server/`**: Directory containing types specific to the original `mcp-shell-server`, now re-exported for convenience or directly used.
  - **`enhanced-security.ts`**: Types related to enhanced security features.
  - **`index.ts`**: Main index for `shell-server` types.
  - **`quick-schemas.ts`**: Quick Zod schemas for shell-server responses.
  - **`response-schemas.ts`**: Zod schemas for various shell-server responses.
  - **`schemas.ts`**: General Zod schemas for shell-server operations.

### `src/utils/`

Contains general utility functions.

- **`criteria-manager.ts`**: Manages criteria for various evaluations.
- **`json-repair.ts`**: Utility for repairing malformed JSON strings.
- **`process-utils.ts`**: Utility functions for process management.
- **`server-helpers.ts`**: Helper functions for server-related tasks, suchs listening and closing servers.
- **`shell-errors.ts`**: Custom error classes specific to shell operations, including `MCPShellError` and `ResourceNotFoundError`. Renamed from `errors.ts` in `mcp-shell-server`.
- **`shell-helpers.ts`**: General helper functions specific to shell operations. Renamed from `helpers.ts` in `mcp-shell-server`.
