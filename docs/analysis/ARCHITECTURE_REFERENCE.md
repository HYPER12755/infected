# Infected MCP Server - Architecture Reference Guide

## System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                    MCP Protocol Layer                          │
│                   (stdio/HTTP/WebSocket)                       │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│              Transport Adapters (5 implementations)             │
│  ┌─────────┬──────────┬──────────┬──────────────┬────────────┐ │
│  │ stdio   │ http     │ sse      │ websocket    │ websocket  │ │
│  │         │          │          │              │ -sse       │ │
│  └─────────┴──────────┴──────────┴──────────────┴────────────┘ │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│              Authentication & Authorization                     │
│  ┌──────────────────┬──────────────────┐                       │
│  │ Token Validation │ Auth Middleware  │                       │
│  └──────────────────┴──────────────────┘                       │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│                  Security Manager                              │
│  ┌──────────────┬──────────────┬──────────────┐               │
│  │ Enhanced     │ Chat         │ Security     │               │
│  │ Evaluator    │ Completion   │ Prompt Gen   │               │
│  │              │ Adapter      │              │               │
│  └──────────────┴──────────────┴──────────────┘               │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│                 ServiceContainer (DI)                          │
│  Central dependency registry with lazy initialization          │
└──────────────┬──────────────────┬──────────────────────────────┘
               │                  │
    ┌──────────▼──────────┐    ┌──▼──────────────┐
    │  Core Services      │    │  Module Manager │
    │  (12 managers)      │    │  (Registry)     │
    │                     │    │                 │
    │ • ProcessManager    │    │ • Load modules  │
    │ • TerminalManager   │    │ • Register tools│
    │ • FileManager       │    │ • Hot-reload    │
    │ • SSHConnectionPool │    │ • Manifest val. │
    │ • ResourceMonitor   │    │                 │
    │ • ResourceLimiter   │    │                 │
    │ • ErrorSystem       │    │                 │
    │ • And 5+ more       │    │                 │
    └────────────┬────────┘    └────────┬────────┘
                 │                      │
                 └──────────────┬───────┘
                                │
                 ┌──────────────▼──────────────┐
                 │   Feature Modules (7)      │
                 │ ┌────┬────┬────┬────┬─────┐│
                 │ │SSH │Shell│FS  │Mem │Others││
                 │ │    │     │    │    │     ││
                 │ └────┴────┴────┴────┴─────┘│
                 │                            │
                 │ • Sessions/Connections    │
                 │ • Command execution       │
                 │ • File operations         │
                 │ • Memory persistence      │
                 │ • Utilities               │
                 └────────────────────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │   System APIs              │
                 │ • child_process            │
                 │ • fs (file system)         │
                 │ • net (network)            │
                 │ • os (operating system)    │
                 └────────────────────────────┘
```

## Module Dependency Chains

### Chain 1: Command Execution Flow

```
User Request
    ↓
MCP Tool Handler (module)
    ↓
SecurityManager.validate()
    ├─→ Enhanced Evaluator
    └─→ LLM API
    ↓ [IF APPROVED]
ModuleManager.getTool()
    ↓
Module.executeTool()
    ├─→ ProcessManager.executeCommand()
    │   ├─→ TerminalManager.getTerminal()
    │   ├─→ ExecutionStrategy[adaptive/background/fg]
    │   ├─→ ResourceMonitor.checkAvailable()
    │   └─→ ResourceLimiter.enforce()
    │
    ├─→ FileManager.readFile() [if needed]
    │
    └─→ SSHConnectionPool.getConnection() [if SSH]
        ├─→ SSHSessionManager.execute()
        └─→ SSHPromptDetector.detect()
    ↓
StreamPublisher.emit()
    ├─→ RealtimeStreamSubscriber
    └─→ TransportAdapter.send()
    ↓
Response back to client
```

### Chain 2: Error Handling Path

```
Operation throws Error
    ↓
Catch block
    ↓
ErrorSystem.classify()
    ├─→ ErrorTaxonomy.getCategory()
    └─→ ErrorMetadata.collect()
    ↓
ErrorMetrics.record()
    ├─→ Count by category
    ├─→ Duration tracking
    └─→ Context capture
    ↓
ErrorHealthCheck.evaluate()
    ├─→ Aggregator.summarize()
    └─→ Recovery decision
    ↓
RecoveryHandler.recover()
    ├─→ CircuitBreaker[open/closed/half-open]
    ├─→ RetryStrategy.shouldRetry()
    │   ├─→ BackoffCalculator.calculate()
    │   └─→ Exponential backoff delay
    └─→ Re-execute or fail
    ↓
Return error response with context
```

### Chain 3: Module Loading Flow

```
Server Startup
    ↓
ModuleManager.start()
    ├─→ initialScanAndLoad()
    │   ├─→ workspaceSrcModulesDir scan
    │   ├─→ workspacePluginsDir scan
    │   ├─→ installDistModulesDir scan
    │   └─→ Validate manifest
    │
    ├─→ moduleWatcher.start()
    │   ├─→ Watch src/modules/
    │   ├─→ Watch tools/
    │   └─→ Watch plugins/
    │
    └─→ For each module:
        ├─→ Dynamic import()
        ├─→ Validate IUnifiedModule interface
        ├─→ module.register(server, config, managers)
        │   └─→ Tool registration
        │       └─→ ToolLoader.registerTool()
        └─→ Add to loadedModules map
    ↓
ModuleWatcher events
    ├─→ moduleAdded → loadModule()
    ├─→ moduleChanged → reloadModule()
    │   └─→ unloadModule() + loadModule()
    └─→ moduleRemoved → unloadModule()
    ↓
All tools available for execution
```

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ 1. TRANSPORT LAYER (5 implementations)                      │
│    - stdio, HTTP, SSE, WebSocket, WebSocket-SSE            │
├─────────────────────────────────────────────────────────────┤
│ 2. PROTOCOL LAYER (MCP)                                     │
│    - Tool registration                                       │
│    - Request/response handling                               │
├─────────────────────────────────────────────────────────────┤
│ 3. SECURITY LAYER                                            │
│    - Authentication                                          │
│    - LLM-based evaluation                                    │
│    - Permission management                                   │
├─────────────────────────────────────────────────────────────┤
│ 4. ORCHESTRATION LAYER                                       │
│    - ServiceContainer (DI)                                   │
│    - ModuleManager (registry)                                │
│    - Request routing                                         │
├─────────────────────────────────────────────────────────────┤
│ 5. FEATURE LAYER (7 modules)                                 │
│    - SSH, Shell, Filesystem, Memory, etc.                    │
├─────────────────────────────────────────────────────────────┤
│ 6. CORE SERVICES LAYER (12 managers)                         │
│    - Process, Terminal, File, Resource, etc.                 │
├─────────────────────────────────────────────────────────────┤
│ 7. ERROR & MONITORING LAYER                                  │
│    - Error system (8 files)                                  │
│    - Recovery handlers                                       │
│    - Resource limits                                         │
├─────────────────────────────────────────────────────────────┤
│ 8. SYSTEM API LAYER                                          │
│    - Node.js system APIs                                     │
│    - External services                                       │
└─────────────────────────────────────────────────────────────┘
```

## Core Manager Interactions

```
ServiceContainer
    │
    ├─→ ProcessManager ─────────┐
    │   └─→ EventEmitter        │
    │       └─→ Async queue     │ (Execution)
    │
    ├─→ TerminalManager ────────┤
    │   └─→ Terminal state      │
    │
    ├─→ FileManager ────────────┤
    │   └─→ File I/O            │ (I/O Operations)
    │
    ├─→ SSHConnectionPool ──────┤
    │   └─→ Object pool         │
    │
    ├─→ ResourceMonitor ────────┤
    │   ├─→ CPU tracking        │ (Resource Management)
    │   ├─→ Memory tracking     │
    │   └─→ FH tracking         │
    │
    ├─→ ResourceLimiter ────────┤
    │   └─→ Enforcement         │
    │
    ├─→ MonitoringManager ──────┤
    │   ├─→ Metrics aggregation │ (Monitoring)
    │   └─→ Performance tracking│
    │
    ├─→ SecurityManager ────────┤
    │   └─→ LLM integration     │ (Security)
    │
    ├─→ PermissionManager ──────┤
    │   └─→ RBAC               │
    │
    ├─→ EnhancedHistoryManager ─┤
    │   └─→ Command dedup      │ (History)
    │
    ├─→ ToolCacheManager ───────┤
    │   └─→ Metadata caching   │ (Caching)
    │
    ├─→ ModuleManager ──────────┤
    │   ├─→ Loading            │ (Module System)
    │   ├─→ Unloading          │
    │   └─→ Hot-reload         │
    │
    ├─→ ToolLoader ─────────────┤
    │   └─→ Tool registration  │
    │
    └─→ PluginLoader ───────────┘
        └─→ Plugin registration
```

## Data Flow Examples

### Example 1: SSH Command Execution

```
User: "ssh-execute --command 'ls -la' --host example.com --port 22 --user admin"
    ↓
Module Router (SSH)
    ↓
SecurityManager validates command
    ├─→ Sends to LLM: "Evaluate: ls -la on example.com"
    └─→ LLM responds: "APPROVED" / "DENIED"
    ↓
SSHModule.register()
    ├─→ Check existing session
    └─→ Or create new via SSHSessionManager
    ↓
SSHCommandExecutor.execute()
    ├─→ Get connection from SSHConnectionPool
    ├─→ Execute: ssh -i key admin@example.com "ls -la"
    ├─→ Monitor with SSHPromptDetector
    └─→ Stream output via StreamPublisher
    ↓
ProcessManager tracks execution
    ├─→ ResourceMonitor.checkCPU()
    ├─→ ResourceLimiter.enforce()
    └─→ MonitoringManager.record()
    ↓
Stream to client via Transport
    ├─→ RealtimeStreamSubscriber emits chunks
    └─→ HTTP/WebSocket/SSE sends to client
```

### Example 2: File Operation with Error Handling

```
User: "filesystem-read --path /sensitive/file.txt"
    ↓
SecurityManager validates
    └─→ LLM: "Allow reading /sensitive/file.txt?" → "DENIED"
    ↓
SecurityError thrown
    ↓
Catch → ErrorSystem.classify()
    ├─→ ErrorTaxonomy: This is a "SecurityError"
    ├─→ ErrorCategories: Create SecurityError instance
    └─→ ErrorMetadata: Capture user, timestamp, path
    ↓
ErrorMetrics.record()
    ├─→ securityErrors++
    ├─→ recordDuration(0ms)
    └─→ recordContext({user, path, decision})
    ↓
ErrorHealthCheck.evaluate()
    ├─→ Check if too many security denials
    └─→ Possible circuit breaker activation
    ↓
RecoveryHandler.recover()
    ├─→ Cannot retry security error
    └─→ Return: { status: 'denied', reason: '...' }
    ↓
Response to client with error details
```

## Configuration Flow

```
Server Start
    ↓
ConfigManager.loadConfig()
    ├─→ Load infected.config.json
    ├─→ Load environment variables
    └─→ Merge with defaults
    ↓
Configuration applied to:
    │
    ├─→ ServiceContainer
    │   ├─→ ProcessManager: maxConcurrentProcesses
    │   ├─→ ResourceMonitor: thresholds
    │   ├─→ SSHConnectionPool: pool settings
    │   └─→ ResourceLimiter: limits
    │
    ├─→ SecurityManager
    │   ├─→ LLM provider (OpenAI/Claude)
    │   ├─→ API keys
    │   └─→ Security policies
    │
    ├─→ ModuleManager
    │   ├─→ toolsDir
    │   ├─→ pluginsDir
    │   └─→ Module paths
    │
    └─→ Transports
        ├─→ Port
        ├─→ Authentication
        └─→ SSL/TLS settings
```

## Error Recovery Flow

```
Operation fails
    ↓
RecoveryHandler checks:
    ├─→ CircuitBreaker.canAttempt()
    │   ├─→ If OPEN: fail fast
    │   └─→ If CLOSED: continue
    │
    ├─→ RetryStrategy.shouldRetry(error)
    │   ├─→ Transient errors: YES
    │   └─→ Permanent errors: NO
    │
    └─→ BackoffCalculator.nextDelay()
        └─→ exponential: 100ms → 200ms → 400ms → ...
    ↓
Retry after delay
    ├─→ Check ResourceMonitor again
    ├─→ Verify circuit breaker state
    └─→ Execute again
    ↓
Success OR fail after max retries
    ↓
Record in ErrorMetrics
    ├─→ Recovery success/failure
    └─→ Total attempts
```

## Hot-Reload Process

```
Developer saves module file
    ↓
ModuleWatcher detects change
    ├─→ File: src/modules/mymodule/index.ts
    └─→ Event: 'moduleChanged'
    ↓
ModuleManager.handleFileChange()
    ├─→ Set loadingModules[moduleId] = true
    ├─→ Get existing module
    │   └─→ module.shutdown()
    ├─→ Deregister all tools
    │   └─→ Remove from MCP server
    ├─→ Re-import module
    │   └─→ Clear require cache
    ├─→ Re-register
    │   └─→ module.register()
    ├─→ Re-expose tools
    │   └─→ Add back to MCP server
    └─→ Set loadingModules[moduleId] = false
    ↓
New tools available immediately
    ├─→ No server restart needed
    └─→ Existing executions unaffected
```

## Performance Monitoring

```
Every 5 seconds (configurable)
    ↓
ResourceMonitor.poll()
    ├─→ Get CPU usage %
    ├─→ Get memory usage %
    ├─→ Get file handles
    └─→ Get open connections
    ↓
Compare against thresholds
    ├─→ CPU: 80%
    ├─→ Memory: 85%
    ├─→ File Handles: 90%
    └─→ Connections: 100%
    ↓
If threshold exceeded:
    ├─→ Log warning
    ├─→ Trigger ResourceLimiter
    │   ├─→ Limit new processes
    │   ├─→ Kill idle processes
    │   └─→ Close idle connections
    └─→ Record in metrics
    ↓
MonitoringManager aggregates
    ├─→ Peak values
    ├─→ Average values
    └─→ Trend analysis
```

## Type System Architecture

```
ManagerInstances (union of all managers)
    ├─→ ProcessManager
    ├─→ TerminalManager
    ├─→ FileManager
    ├─→ SSHConnectionPool
    ├─→ ResourceMonitor
    ├─→ ResourceLimiter
    ├─→ SecurityManager
    ├─→ MonitoringManager
    ├─→ CommandHistoryManager
    ├─→ ToolCacheManager
    ├─→ ModuleManager
    ├─→ ToolLoader
    ├─→ PluginLoader
    └─→ McpShellConfigManager

Module Interface (IUnifiedModule)
    ├─→ name: string
    ├─→ register()
    ├─→ shutdown()
    └─→ Tools definition

UnifiedModuleContext
    ├─→ server: McpServer
    ├─→ config: InfectedConfig
    └─→ managers: ManagerInstances

ShellError hierarchy
    ├─→ MCPShellError (base)
    ├─→ ResourceNotFoundError
    ├─→ ValidationError
    ├─→ ConfigurationError
    └─→ Specific error types
```

---

## Quick Reference: File Locations

```
Core Framework:
  - DI Container: src/core/service-container.ts
  - Managers: src/core/*-manager.ts (12 files)
  - Error System: src/core/error-system/ (8 files)
  - Strategies: src/core/execution-strategies/ (6 files)
  - Recovery: src/core/recovery/ (4 files)

Feature Modules:
  - SSH: src/modules/ssh/ (6 files, 2.4k LOC)
  - Shell: src/modules/shell/ (5 files, 3.2k LOC)
  - Filesystem: src/modules/filesystem/ (9 files, 1.8k LOC)
  - Memory: src/modules/memory/ (2 files, 0.7k LOC)

Security:
  - Main: src/security/manager.ts
  - Evaluator: src/security/enhanced-evaluator.ts
  - LLM: src/security/chat-completion-adapter.ts

Transports:
  - stdio: src/transports/stdio.ts
  - HTTP: src/transports/http.ts
  - SSE: src/transports/sse.ts
  - WebSocket: src/transports/websocket.ts

Types:
  - Main: src/types/index.ts
  - Shells: src/types/shell-server/ (5 files)

Config & CLI:
  - Config: src/config/
  - CLI: src/cli/
```

---

**Last Updated:** Analysis Date 2024
**Architecture Version:** 1.0
**Status:** Production Ready
