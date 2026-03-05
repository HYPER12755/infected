# Official Model Context Protocol (MCP) TypeScript SDK: Server Overview

This document provides an overview of building and running Model Context Protocol (MCP) servers using the official TypeScript SDK, based on the `docs/server.md` documentation found in the SDK's GitHub repository.

## 1. Core Concepts

The MCP TypeScript SDK provides a robust framework for creating servers that expose tools, manage resources, and define prompt templates for interaction with clients.

### McpServer

The `McpServer` class is the central component for creating an MCP server. It handles the core logic for managing capabilities, transports, and client interactions.

### Transports

MCP servers can communicate with clients over various transports:

*   **Streamable HTTP**: Recommended for remote servers, offering efficient streaming of data.
*   **HTTP + SSE**: Provides HTTP communication with Server-Sent Events for real-time updates, primarily for backward compatibility.
*   **stdio**: Designed for local integrations, allowing communication over standard input/output, typically when the server is spawned as a child process.

## 2. Server Capabilities

An MCP server built with the SDK can expose several capabilities to its clients:

*   **Tools**: Functions or operations that the server can execute on behalf of a client. These are registered using `server.tool()`.
*   **Resources**: Read-only data or assets that the server provides. Registered using `server.resource()`.
*   **Prompts**: Reusable templates for generating prompts, facilitating consistent and structured interactions. Defined using `server.prompt()`.

## 3. Advanced Capabilities

The SDK includes higher-level capabilities to enhance server-client interactions:

*   **Sampling**: Mechanisms for handling probabilistic or sample-based responses.
*   **Form Elicitation**: Tools for guiding clients through structured input forms.
*   **URL Elicitation**: Functionality to prompt clients for URLs or web-based information.
*   **Experimental Task-Based Execution**: Advanced features for managing and executing complex, multi-step tasks.

## 4. Configuration and Deployment

The official documentation covers aspects related to:

*   **CORS (Cross-Origin Resource Sharing)**: Configuring the server to allow or restrict cross-origin requests.
*   **DNS Rebinding Protection**: Safeguarding against DNS rebinding attacks.
*   **Multi-Node Deployment**: Guidance for deploying MCP servers in distributed environments.
*   **OAuth Integration**: Examples and instructions for integrating OAuth for authentication and authorization.

## 5. Examples and Walkthroughs

The SDK repository provides runnable server examples under `src/examples/server`, offering practical demonstrations of various server configurations, including:

*   Stateless servers
*   JSON-only responses
*   SSE compatibility
*   OAuth integration

For guided walkthroughs, refer to `docs/server.md` and `docs/client.md` within the SDK's GitHub repository.
