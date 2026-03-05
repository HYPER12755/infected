# Infected MCP Platform

A unified Model Context Protocol (MCP) server for modular operations. Infected is a powerful runtime that combines shell execution, filesystem operations, memory management, sequential thinking, HTTP fetching, and plugin extensibility into a single, production-ready server. Designed for autonomous agents, DevOps automation, and rapid prototyping, Infected provides a secure and scalable foundation for building AI-powered applications.

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Running Infected](#running-infected)
7. [Usage](#usage)
8. [Tools Reference](#tools-reference)
9. [Security](#security)
10. [Extensibility](#extensibility)
11. [Troubleshooting](#troubleshooting)
12. [API Reference](#api-reference)
13. [Contributing](#contributing)
14. [License](#license)

---

## Overview

Infected bridges the gap between traditional server architectures and modern AI agent workflows. By implementing the Model Context Protocol specification, it provides a standardized interface for Large Language Models (LLMs) to interact with system resources safely and efficiently. The platform acts as a gateway, enabling AI models to execute commands, manage files, persist data, and integrate with external services through a well-defined security model.

The Model Context Protocol (MCP) represents a significant advancement in how AI systems interact with external tools and data sources. Rather than hardcoding integrations or relying on fragile adapters, MCP provides a universal specification that both AI models and service providers can implement. This standardization means that once Infected is integrated into your workflow, any MCP-compatible client can leverage its capabilities without additional configuration.

The platform follows a unified module architecture where all tools—whether built-in or custom—register through the same ModuleManager. This design ensures consistent lifecycle management, hot-reloading capabilities, and comprehensive observability across your entire toolchain. Each module receives consistent lifecycle hooks for initialization, execution, and cleanup, creating a predictable behavior pattern that simplifies debugging and maintenance.

Infected was built with production deployments in mind. It includes comprehensive logging, configurable caching, multiple transport mechanisms, and enterprise-grade security features. Whether you're running a single development instance or deploying a cluster of Infected servers for high availability, the platform scales to meet your requirements.

---

## Features

### Unified Module Runtime

All tools and plugins operate through a centralized ModuleManager system. This approach eliminates code duplication, standardizes error handling, and provides a single point of control for permissions, caching, and logging. When a new tool is added to the platform, it automatically inherits all the benefits of this unified system without requiring custom implementation of these cross-cutting concerns.

The ModuleManager maintains a registry of all available tools, tracking their capabilities, input schemas, and output formats. This registry serves as the source of truth for what operations are available and how they should be invoked. The registry is dynamically updated when tools are added, removed, or modified, enabling real-time reflection of the platform's capabilities.

Each module in the system implements a standard interface that includes initialization, execution, and cleanup phases. The initialization phase allows modules to establish connections, load configuration, and prepare resources. The execution phase handles the actual tool invocation, accepting parameters and returning results. The cleanup phase ensures proper resource disposal, preventing memory leaks and connection exhaustion.

Hot-reloading is a first-class concern in the module system. When a tool is modified in the tools directory or a plugin is updated in the plugins directory, the ModuleManager detects these changes and reloads the affected modules without requiring a full server restart. This capability dramatically improves development velocity, allowing developers to iterate on tools and see their changes reflected immediately.

The unified module system also provides consistent observability features. Every tool execution generates structured logs that include timing information, parameter details, success/failure status, and optional performance metrics. This data is invaluable for debugging issues, optimizing performance, and understanding how tools are being used in your applications.

### Security & Compliance

Security is built into every layer of the Infected platform. Modern AI systems have unprecedented power to interact with system resources, and with that power comes responsibility. Infected provides multiple layers of security controls to ensure that AI interactions remain safe, auditable, and controlled.

Structured logging is the foundation of Infected's security posture. Every operation is logged with configurable detail levels, capturing not just the outcome but the context surrounding each request. These logs can be directed to various outputs including files, syslog, or external logging services. Log entries include timestamps, user identifiers, operation types, parameters (sanitized for sensitive data), and results.

API Key authentication provides an additional layer of security for network-based transports. When enabled, all HTTP requests must include a valid API key in the Authorization header. This prevents unauthorized access to your Infected instance, particularly important when the server is exposed on networks beyond localhost. API keys are stored securely and can be rotated without downtime.

The LLM Security Gate represents an innovative approach to AI safety within the platform. When enabled, certain commands can be flagged for additional review before execution. The skipSafeCommands configuration allows administrators to define patterns that bypass this gate, enabling fast paths for known-safe operations while requiring extra scrutiny for potentially dangerous actions.

The permission system provides granular controls for filesystem access, shell commands, and network operations. Permissions can be scoped to specific users, groups, or API keys, enabling multi-tenant deployments where different clients have different capability sets. Permissions are evaluated before any operation executes, ensuring that unauthorized access is prevented at the earliest possible point.

Command filtering allows administrators to blacklist specific commands or patterns. For example, you might prevent rm -rf commands from executing, or restrict access to system configuration utilities. This filtering happens before the command reaches the execution layer, providing a proactive security boundary.

### Extensibility

Infected supports multiple extension mechanisms, allowing you to tailor the platform to your specific needs. The extension system is designed for flexibility while maintaining the security and observability guarantees of the core platform.

Tools represent the primary extension mechanism. A tool is a self-contained package that provides one or more capabilities through the MCP interface. Tools are stored in the tools directory and are automatically discovered when the server starts. Each tool includes a module.json descriptor that defines its name, version, capabilities, and configuration requirements.

The tool authoring experience is designed to be straightforward. Tools are implemented as JavaScript or TypeScript modules that export standard functions for each capability. The ModuleManager handles the complexity of parameter validation, result formatting, and error handling, allowing tool authors to focus on their core functionality.

Plugins extend the platform beyond individual tools. While tools typically provide a single focused capability, plugins can bundle multiple tools together, include server-side extensions, or provide integration with external services. Plugins are loaded from the plugins directory and can be enabled or disabled through configuration without requiring code changes.

The auto-discovery feature means that adding new functionality is as simple as copying files to the appropriate directory. The server monitors these directories for changes, automatically loading new modules and unloading removed ones. This approach enables zero-downtime deployments and simplifies operational workflows.

### Multiple Transport Modes

Infected supports three transport mechanisms, each optimized for different use cases. The transport layer handles the mechanics of receiving requests and returning responses, abstracting this complexity away from the tool implementation.

STDIO transport is designed for local integration scenarios. When Infected runs in STDIO mode, it communicates through standard input and output streams, making it ideal for embedding within larger applications or shell scripts. This mode has minimal overhead and requires no network configuration.

HTTP transport provides RESTful access over standard web protocols. Running in HTTP mode exposes the full MCP API through HTTP endpoints, enabling remote client connections. This mode supports authentication, TLS encryption, and all the features expected of modern web services.

Server-Sent Events (SSE) transport enables streaming responses. Unlike traditional request-response patterns, SSE allows the server to push data to clients as it becomes available. This is particularly useful for long-running operations where progress updates improve the user experience.

### Hot Reload

Development velocity is improved with automatic module reloading. Changes to tools and plugins are detected and applied immediately, eliminating manual restarts. The hot reload system uses file system watchers to monitor changes in the tools and plugins directories, triggering reconfiguration when modifications are detected.

The reloading process is designed to be safe and non-disruptive. In-flight operations are allowed to complete before the reload occurs, preventing partial executions or inconsistent states. New requests after the reload point to the updated modules, while the system maintains stability throughout the transition.

---

## Architecture

### Core Components

The platform consists of several interconnected systems, each responsible for a specific aspect of platform operation. Understanding these components helps when debugging issues or extending the platform.

The Module Loader is responsible for discovering and loading tools and plugins from designated directories. It maintains the registry of available modules, handles dependency resolution, and ensures that each module is properly initialized before it becomes available for execution. The module loader also manages the hot-reload lifecycle, detecting changes and coordinating graceful transitions.

The Security Manager enforces permission policies and command filtering across all operations. It intercepts requests before they reach tool execution, validating permissions, checking command patterns against blacklists, and ensuring that API key authentication requirements are satisfied. The security manager is highly configurable, allowing fine-grained control over what operations are permitted.

The Transport Handler manages the various connection mechanisms supported by the platform. It abstracts the differences between STDIO, HTTP, and SSE transports, providing a consistent interface for request handling regardless of how the client connects. The transport handler also manages connection lifecycle, timeouts, and error recovery.

The Cache Manager reduces latency and improves throughput by caching tool responses. Caching is particularly valuable for operations that fetch external data or perform expensive computations. The cache manager supports configurable TTL values, cache invalidation strategies, and size limits to prevent unbounded memory growth.

The Logger provides structured logging with multiple output formats. Logs can be configured to include varying levels of detail, from minimal operational summaries to full request/response dumps for debugging. The logger integrates with standard logging frameworks and can direct output to files, syslog, or external services.

The Process Manager handles subprocess creation and lifecycle for shell execution. It manages command timeouts, captures output streams, and ensures proper cleanup of child processes. The process manager also implements resource limits to prevent runaway processes from consuming excessive system resources.

### Data Flow

Understanding how requests flow through the system helps with debugging and performance optimization. The data flow follows a consistent pattern regardless of which transport is used.

When a request arrives, the Transport Handler first accepts and parses the incoming data. For HTTP requests, this involves parsing the request body and headers. For STDIO, it involves reading from standard input. The transport handler normalizes these different formats into a standard internal representation.

After parsing, the request enters the Security Check phase. Here, the Security Manager validates API keys (if required), checks permissions for the requested operation, and evaluates command filters. If any security check fails, an error response is returned immediately without proceeding further.

Valid requests then pass to the Module Loader, which resolves the requested tool name to the appropriate module. The module loader validates that the requested capability exists and that the provided parameters match the expected schema.

The Tool Execution phase invokes the actual tool implementation with the validated parameters. This phase includes any module-specific initialization, the core operation, and result formatting. Errors during execution are caught and converted to standardized error responses.

After execution, the Result Processing phase formats the response according to the MCP specification. This includes serializing the result, adding metadata, and preparing the response for transmission.

Finally, the Transport Handler sends the response back to the client and the Logger records the complete request lifecycle for auditing purposes.

---

## Installation

Getting Infected running requires a few straightforward steps. This section covers the complete installation process from cloning the repository to your first successful server start.

First, clone the repository using git:

```bash
git clone https://github.com/HYPER12755/infected.git
cd infected
```

The repository contains the complete source code, configuration templates, and documentation. After cloning, you'll have a directory structure ready for configuration.

Next, install the required dependencies using npm:

```bash
npm install
```

This command reads the package.json file and installs all required dependencies. The installation includes both runtime dependencies (the libraries needed for the server to function) and development dependencies (tools used for building and testing). Installation time varies depending on network speed and system performance.

After installation completes, you need to configure the environment. Copy the example environment file:

```bash
cp .env.example .env
```

Edit the .env file to customize runtime behavior. The example file contains sensible defaults, but you'll want to review and adjust settings like the server port, transport mode, and logging level to match your requirements.

Also copy the configuration template:

```bash
cp infected.config.json.example infected.config.json
```

The infected.config.json file controls advanced settings including caching behavior, authentication configuration, permission policies, and plugin loading. The example provides documentation for each option.

---

## Configuration

Infected uses a two-tier configuration system: environment variables for simple settings and a JSON configuration file for advanced options. This section covers both approaches in detail.

### Environment Variables

Environment variables are the primary configuration mechanism for runtime settings. They are loaded from the .env file at startup and can also be provided by the parent process.

The following environment variables control core server behavior:

PORT specifies the network port where the server listens for connections. The default value is 3001. When using HTTP transport, the server binds to this port and accepts incoming connections.

TRANSPORT determines which transport mechanism the server uses. Valid values include http for HTTP transport, stdio for standard input/output, and sse for Server-Sent Events. The default is http.

HOT_RELOAD enables or disables automatic module reloading. Set to true to enable hot reloading during development, or false for production deployments where stability is prioritized.

LOG_LEVEL controls the verbosity of logging output. Valid values range from error for minimal output through warn, info, and debug for detailed debugging information. The default is info.

API_KEY enables API key authentication. When this variable is set, all HTTP requests must include the key in the Authorization header. Leave unset to disable authentication.

LLM_SECURITY_ENABLED enables the LLM security gate. When set to true, certain commands require additional review before execution. The default is false.

### Configuration File

The infected.config.json file provides fine-grained control over platform behavior. This JSON file is loaded at startup and overrides default values for all configurable options.

The configuration file supports the following top-level sections:

CACHING controls response caching behavior. Options include enabled to toggle caching globally, ttl to set default time-to-live in seconds, and maxSize to limit cache memory usage.

AUTHENTICATION configures API key management. Options include enabled to require authentication, keys to list valid API keys, and bypassPaths to specify URL paths that don't require authentication.

PERMISSIONS defines access control policies. Options include default to set baseline permissions, overrides to define specific rules for certain tools or users, and mode to choose between permissive and restrictive defaults.

PLUGINS controls which plugins are loaded. Options include enabled to list of plugin names to load, disabled to list of plugins to skip, and order to specify initialization sequence.

DOCUMENTATION configures auto-discovery of documentation. Options include paths to specify directories to scan, exclude to list patterns to skip, and indexTitle to set the documentation index heading.

---

## Running Infected

Infected supports multiple runtime modes optimized for different scenarios. This section covers both development and production deployment approaches.

### Development Mode

For active development with hot-reload enabled, use the dev script:

```bash
npm run dev
```

This command starts the server in development mode with debug logging enabled. File changes trigger automatic reloads, allowing you to modify tools and plugins and see changes reflected immediately. The dev mode also enables source maps, making debugging easier when issues arise.

Output from the development server is directed to both the console and a log file. The log file location is logs/dev.log, allowing you to review past sessions while still seeing real-time output in your terminal.

### Production Mode

For production deployments, first build the TypeScript source:

```bash
npm run build
```

The build process compiles all TypeScript files to JavaScript, generates type definitions, and prepares the distribution directory. This step is required before running in production mode.

To start the server:

```bash
npm start
```

The start script runs the built JavaScript with production-appropriate settings. Logging is directed to files rather than console, and hot reloading is disabled for stability.

---

## Usage

### HTTP API

Make tool calls via HTTP by sending POST requests to the server endpoint:

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tool_code/shell_execute",
    "params": {
      "command": "ls -la",
      "executionMode": "foreground"
    }
  }'
```

The request format follows the MCP specification. The method field identifies which tool and operation to invoke. The params field contains operation-specific parameters.

### Health Check

Verify server status by calling the health endpoint:

 http://localhost:3001/health
```bash
curl```

A successful health check returns a JSON response indicating the server is operational.

---

## Tools Reference

Infected includes several built-in tools that provide core capabilities. This section describes each tool and its available operations.

### Shell Tool

The shell tool provides shell command execution capabilities. It supports foreground execution (waiting for completion) and background execution (returning immediately while the command runs).

Parameters include command (the shell command to execute), executionMode (foreground or background), timeout (maximum execution time in milliseconds), and workingDirectory (optional directory for command execution).

### Filesystem Tool

The filesystem tool enables file and directory operations. It provides capabilities for reading, writing, copying, moving, and deleting files, as well as directory listing and navigation.

Operations include read, write, copy, move, delete, list, and stat. Each operation supports path validation to ensure operations stay within allowed directories.

### Memory Tool

The memory tool provides persistent key-value storage. It's useful for maintaining conversation context, caching results, or sharing state between operations.

Operations include get, set, delete, and list. Values can be any JSON-serializable data type.

### Sequentialthinking Tool

The sequentialthinking tool enables multi-step reasoning with thought chaining. It helps AI models break complex problems into manageable steps and track their reasoning process.

### Fetch Tool

The fetch tool provides HTTP request capabilities. It supports GET, POST, PUT, DELETE, and other HTTP methods, with automatic response parsing.

### SSH Tool

The ssh tool enables remote SSH execution. It connects to remote servers and executes commands, providing secure access to distributed systems.

---

## Security

The security system in Infected provides defense in depth through multiple layers of protection. Understanding these layers helps you configure the platform appropriately for your threat model.

Authentication verifies the identity of clients making requests. When API key authentication is enabled, each request must include a valid key. Keys can be rotated without downtime by updating the configuration.

Authorization determines what operations authenticated clients are permitted to perform. The permission system can restrict access based on tool name, operation type, and client identity.

Input validation ensures that parameters provided to tools conform to expected schemas. Invalid parameters are rejected before they reach tool execution, preventing injection attacks.

Command filtering provides proactive protection against dangerous operations. Administrators can define patterns that trigger additional review or are outright blocked.

Logging and auditing create a complete record of all operations. These logs support security analysis, incident investigation, and compliance requirements.

---

## Extending Infected

Infected is designed to be extended. This section covers the various extension points and how to use them effectively.

### Creating Custom Tools

Custom tools are placed in the tools directory. Each tool requires a module.json descriptor and a JavaScript implementation file.

The module.json defines the tool's name, version, description, and the operations it provides. Each operation includes parameter schemas and return type definitions.

### Creating Plugins

Plugins bundle multiple capabilities together and can include server-side extensions. Place plugins in the plugins directory for auto-discovery.

### Configuration Management

Use the configure command to interactively adjust settings:

```bash
npx infected --configure
```

This launches an interactive configuration editor.

---

## Troubleshooting

When issues arise, systematic debugging ensures quick resolution. This section covers common problems and their solutions.

### Server Won't Start

Check that all required configuration files exist. Verify that the port specified in configuration is not in use by another process. Review logs in the logs directory for error messages.

### Tools Not Available

Ensure that tool directories contain properly formatted module.json files. Check that the module loader has discovered the tools by reviewing startup logs.

### Authentication Failures

Verify that the API key matches exactly what's configured. Check that the Authorization header is formatted correctly. Ensure the key hasn't expired if using time-limited tokens.

### Performance Issues

Enable debug logging to identify slow operations. Review cache hit rates. Check system resources including memory, CPU, and disk I/O.

---

## API Reference

The MCP API provides consistent interfaces for all operations. This section provides quick reference for common API patterns.

### Tool Invocation

Invoke tools by sending POST requests with JSON bodies containing method and params fields.

### Error Responses

Errors follow the MCP specification with code, message, and optional details fields.

### Streaming Responses

For long operations, SSE transport provides progressive results.

---

## Contributing

Contributions to Infected are welcome. This section outlines how to contribute effectively.

### Reporting Issues

Use GitHub Issues to report bugs, request features, or ask questions. Provide detailed information including steps to reproduce for bugs.

### Pull Requests

Submit pull requests for bug fixes and new features. Include tests and update documentation as appropriate.

### Code Style

Follow existing code patterns and conventions. Use TypeScript for new code.

---

## License

MIT License — See LICENSE file for details.

---

Built with the [Model Context Protocol](https://spec.modelcontextprotocol.io/) specification.
