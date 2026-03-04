Here are the available API endpoints for the `@infected/infected` server:

### Main MCP Communication Endpoints

These endpoints are used by MCP clients (like autonomous agents) to communicate with the server, send tool calls, and receive notifications.

*   **`POST /mcp`** (for `http` transport)
    *   **Purpose**: The primary endpoint for sending MCP messages and tool call requests via HTTP.
    *   **Authentication**: Requires API Key if `auth.enabled` is true and `apiKey` is configured.
*   **`GET /sse`** (for `sse` transport)
    *   **Purpose**: Provides a Server-Sent Events stream for real-time MCP notifications.
    *   **Authentication**: Requires API Key if `auth.enabled` is true and `apiKey` is configured.
*   **STDIO Transport**: When using `stdio` transport, communication occurs over standard input/output, not via HTTP/SSE endpoints.

### Monitoring And Management API Endpoints

These endpoints are available for monitoring and management of the MCP server. If `auth.enabled` is true and `apiKey` is configured, these endpoints require authentication via the `X-API-Key` HTTP header.

*   **`GET /api/monitor/status`**
    *   **Purpose**: Provides comprehensive health status of the main MCP server, including its transport, configured port, uptime, system metrics, and summary of tool execution and cache.
    *   **Example Response**:
        ```json
        {
          "status": "healthy",
          "transport": "http",
          "serverPort": 3001,
          "uptime_s": 123.45,
          "uptime_h": "0.03",
          "metrics": {
            "system": {
              "hostname": "localhost",
              "osType": "linux",
              "architecture": "arm64",
              "cpus": [ { "model": "Cortex-A55", "speed": 2000, "times": { /* ... */ } } ],
              "totalMemoryMB": 3649,
              "freeMemoryMB": 717,
              "uptimeSeconds": 124,
              "loadAverage": [0.12, 0.07, 0.02],
              "collectedAt": "2026-02-25T06:00:22.834Z"
            },
            "toolExecution": {
              "totalToolCalls": 0,
              "avgExecutionTimeMs": 0,
              "successfulCalls": 0,
              "failedCalls": 0,
              "successRate": 100,
              "recentlyExecuted": []
            },
            "cache": {
              "totalRequests": 0,
              "hits": 0,
              "misses": 0,
              "hitRate": 0,
              "enabled": true,
              "size": 0,
              "maxSize": 1000
            },
            "activeMonitors": 0
          }
        }
        ```
*   **`GET /api/monitor/alerts`**
    *   **Purpose**: Provides a list of any active alerts or warnings detected by the monitoring system.
    *   **Example Response**:
        ```json
        {
          "alerts": []
        }
        ```
*   **`GET /api/executions`**
    *   **Purpose**: Lists currently active or recently completed command executions (from `ProcessManager`).
    *   **Query Parameters**: `status` (`running`, `completed`, `failed`, `timeout`, `all`).
    *   **Example Response**:
        ```json
        {
          "processes": {
            "executions": [
              {
                "execution_id": "a1b2c3d4",
                "command": "ls -la",
                "status": "running",
                "process_id": 1234,
                "startTime": "2026-02-22T10:00:00Z"
              }
            ],
            "total": 1
          }
        }
        ```
*   **`GET /api/config-summary`**
    *   **Purpose**: Returns a summarized overview of the main `infected` server's current configuration.
    *   **Example Response**:
        ```json
        {
          "transport": "http",
          "port": 3001,
          "toolsDir": "./tools",
          "auth": { "enabled": false },
          "permissions": { "defaultPolicy": "allow" },
          "cache": { "enabled": true },
          "llmSecurity": { "enabled": false }
        }
        ```
*   **`GET /api/metrics`**
    *   **Purpose**: Provides real-time system, tool execution, and cache performance metrics.
    *   **Example Response**:
        ```json
        {
          "system": {
            "hostname": "my-server",
            "osType": "Linux",
            "architecture": "x64",
            "cpus": [ { "model": "Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz" } ],
            "totalMemoryMB": 16384,
            "freeMemoryMB": 8192,
            "loadAverage": [0.5, 0.4, 0.3],
            "collectedAt": "2026-02-25T06:00:55.752Z"
          },
          "toolExecution": {
            "totalToolCalls": 0,
            "successfulCalls": 0,
            "failedCalls": 0,
            "avgExecutionTimeMs": 0,
            "successRate": 100,
            "recentlyExecuted": []
          },
          "cache": {
            "enabled": true,
            "totalRequests": 0,
            "hits": 0,
            "misses": 0,
            "hitRate": 0,
            "size": 0,
            "maxSize": 1000
          },
          "activeMonitors": 0
        }
        ```
*   **`GET /api/logs/stream`** (SSE)
    *   **Purpose**: Provides a Server-Sent Events stream for real-time structured log entries from the server.
    *   **Authentication**: Requires API Key if `auth.enabled` is true.
    *   **Event Data**: Each event is a JSON object representing a log entry (timestamp, level, message, component, etc.).
*   **`GET /api/modules`**
    *   **Purpose**: Lists all currently loaded unified modules (tools and plugins) with their core manifest data.
    *   **Example Response**:
        ```json
        {
          "modules": [
            { "id": "tool.my_custom_tool", "name": "My Custom Tool", "type": "tool", "version": "0.1.0", "description": "A custom tool for specific tasks." },
            { "id": "plugin.my_utility_plugin", "name": "My Utility Plugin", "type": "plugin", "version": "1.2.0", "description": "Provides various utility functions." }
          ]
        }
        ```
*   **`GET /api/tools`**
    *   **Purpose**: Lists all registered tools with their schemas, including those provided by dynamically loaded plugins and internal modules.
    *   **Example Response**:
        ```json
        {
          "tools": [
            { "name": "my_test_tool", "description": "A simple test tool.", "parameters": { /* ... */ } },
            { "name": "plugin_tool_one", "description": "First tool from a plugin.", "parameters": { /* ... */ } },
            { "name": "shell_execute", "description": "Executes shell commands.", "parameters": { /* ... */ } }
          ]
        }
        ```
*   **`GET /api/plugins`**
    *   **Purpose**: Lists all discovered and loaded plugins with their metadata.
    *   **Example Response**:
        ```json
        {
          "plugins": [
            {
              "id": "plugin.my_test_plugin",
              "name": "My Test Plugin",
              "version": "1.0.0",
              "description": "A test plugin with sample tools and resources."
            }
          ]
        }
        ```
*   **`POST /api/modules/:moduleId/reload`**
    *   **Purpose**: Reloads a specific module by its ID. Useful for applying changes to a module without restarting the entire server.
    *   **Path Parameters**:
    *   `moduleId` (string, required): The unique ID of the module to reload (e.g., `plugin.my_utility_plugin`).
    *   **Example Usage (using `curl`)**:
        ```bash
        curl -X POST http://localhost:3001/api/modules/plugin.my_utility_plugin/reload
        ```
    *   **Example Response**:
        ```json
        {
          "message": "Module 'plugin.my_utility_plugin' reloaded."
        }
        ```

*   **`GET /api/executions/:id`**, **`/api/executions/:id/outputs`** etc.: (Existing endpoints, descriptions remain the same)
*   **`GET /api/history`**, **`/api/history/:id`**: (Existing endpoints, descriptions remain the same)
*   **`GET /api/terminals`**, **`/api/terminals/:id`**, **`/api/terminals/:id/sse`**, **`/api/terminals/:id/output`**: (Existing endpoints, descriptions remain the same)
*   **`GET /api/remote-exec/:id`**, etc.: (Existing endpoints, descriptions remain the same)
