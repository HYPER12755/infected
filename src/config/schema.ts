import { z } from 'zod';

// Configuration constants
const DEFAULT_PORT = 3000;
const MIN_PORT = 1;
const MAX_PORT = 65535;
const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Custom schema for API Key validation
const ApiKeySchema = z.string().min(8, "API Key must be at least 8 characters long.");

// Add this new schema definition
export const ProcessManagerConfigSchema = z.object({
  maxConcurrentProcesses: z.number().int().positive().default(50).describe("Maximum number of concurrent background processes."),
  outputDir: z.string().default('/tmp/mcp-shell-outputs').describe("Directory for storing background process outputs."),
}).default({});

// Phase 1 Integration: ExecutionStrategy configuration
export const ExecutionStrategyConfigSchema = z.object({
  defaultTimeoutMs: z.number().int().positive().default(300000).describe("Default timeout for command execution (5 minutes)."),
  defaultKillGracePeriodMs: z.number().int().positive().default(5000).describe("Grace period for process termination before force kill."),
}).optional().describe("Execution strategy configuration.");

// Phase 1 Integration: SSH Connection Pool configuration
export const SSHConnectionPoolConfigSchema = z.object({
  maxConnections: z.number().int().positive().default(50).describe("Maximum number of concurrent SSH connections."),
  maxIdleTime: z.number().int().positive().default(300000).describe("Maximum idle time before connection is closed (5 minutes)."),
  maxConnectionAge: z.number().int().positive().default(3600000).describe("Maximum age of a connection before it must be recreated (1 hour)."),
  maxReusesPerConnection: z.number().int().positive().default(100).describe("Maximum number of times a single connection can be reused."),
  staleCheckInterval: z.number().int().positive().default(30000).describe("Interval for checking stale connections (30 seconds)."),
  enableCredentialCaching: z.boolean().default(true).describe("Enable credential caching with hashing."),
}).optional().describe("SSH connection pool configuration.");

// Phase 1 Integration: Resource configuration
export const ResourcesConfigSchema = z.object({
  maxMemoryMB: z.number().int().positive().default(4096).describe("Maximum memory limit in MB."),
  maxCPUPercent: z.number().int().min(1).max(100).default(80).describe("Maximum CPU usage percentage."),
  maxFileHandles: z.number().int().positive().default(2048).describe("Maximum open file handles."),
  maxConnections: z.number().int().positive().default(50).describe("Maximum concurrent connections."),
  monitoringIntervalMs: z.number().int().positive().default(5000).describe("Resource monitoring interval in milliseconds."),
  thresholdPercent: z.number().int().min(1).max(100).default(85).describe("Memory threshold percentage for alerts."),
  cpuThresholdPercent: z.number().int().min(1).max(100).default(80).describe("CPU threshold percentage for alerts."),
  fileHandleThresholdPercent: z.number().int().min(1).max(100).default(90).describe("File handle threshold percentage for alerts."),
  enableLimiting: z.boolean().default(true).describe("Enable resource limit enforcement."),
  enableMonitoring: z.boolean().default(true).describe("Enable resource monitoring."),
}).optional().describe("Resource monitoring and limiting configuration.");


export const InfectedConfigSchema = z.object({
  transport: z.union([z.literal('stdio'), z.literal('http'), z.literal('sse'), z.literal('websocket')]).default('stdio'),
  modules: z.array(z.string()).default(['shell', 'filesystem', 'memory', 'sequentialthinking', 'fetch', 'system']),
  port: z.number().int().min(MIN_PORT).max(MAX_PORT).default(DEFAULT_PORT),
  hotReload: z.boolean().default(false),
  toolsDir: z.string().default('./tools'),
  pluginsDir: z.string().default('./plugins'),
  shell: z.object({
    allowlist: z.array(z.string()).default([]),
  }).default({}),
  memory: z.object({
    filePath: z.string().default('.infected/memory.jsonl'),
  }).default({}),
  fetch: z.object({
    domainWhitelist: z.array(z.string()).default([]),
    blockLocalNetwork: z.boolean().default(false), // Changed default to false for agent autonomy
    allowInsecureTls: z.boolean().default(false).describe("Allow HTTPS requests with invalid/self-signed certificates."),
  }).default({}),
  plugins: z.array(z.object({
    name: z.string().describe("The name or path of the plugin."),
    config: z.record(z.string(), z.any()).optional().describe("Plugin-specific configuration."),
  })).default([]),
  cache: z.object({
    enabled: z.boolean().default(true).describe("Enable or disable tool caching."),
    defaultTTL: z.number().int().min(1000).default(DEFAULT_CACHE_TTL).describe("Default cache entry time-to-live in milliseconds (min 1 second)."),
    maxSize: z.number().int().min(1).default(1000).describe("Maximum number of cache entries."),
  }).default({}).describe("Configuration for the tool caching system."),
  auth: z.object({
    enabled: z.boolean().default(false).describe("Enable or disable API Key authentication. If true AND apiKey is set, it will be enforced."),
    // apiKey can be a single string or a comma-separated string, transformed into an array
    apiKey: z.union([
        z.array(ApiKeySchema),
        z.string().transform(s => s.split(',').map(key => key.trim()).filter(key => key.length >= 8))
    ]).default([]).describe("API Keys for authenticating requests. Can be a single key or comma-separated list. Each key must be at least 8 characters long."),
    randomAuthTokenEnabled: z.boolean().default(false).describe("If true, a random API key is generated at server startup, overriding static API keys. Useful for temporary sessions; disable for persistent keys."),
    randomAuthTokenAdvanced: z.object({
        enabled: z.boolean().default(false).describe("Enable the advanced random API key generator."),
        tokenCount: z.number().int().positive().default(1).describe("How many distinct random tokens to create when the advanced generator runs."),
        tokenLength: z.number().int().positive().default(32).describe("Size in bytes for each random token."),
        prefix: z.string().optional().describe("Optional prefix applied to every generated token."),
        includeTimestamp: z.boolean().default(false).describe("Append a timestamp suffix to each token for rotation visibility."),
    }).default({
        enabled: false,
        tokenCount: 1,
        tokenLength: 32,
        includeTimestamp: false,
    })
  }).default({}).describe("Authentication configuration."),
  permissions: z.object({
    defaultPolicy: z.enum(['allow', 'deny']).default('allow').describe("Default policy for tool execution. 'allow' means all tools are allowed unless explicitly blocked. 'deny' means all tools are denied unless explicitly allowed."),
    toolAllowlist: z.array(z.string()).default([]).describe("List of tool names that are always allowed, overriding the default policy. Empty by default for agent autonomy."),
    toolBlocklist: z.array(z.string()).default([]).describe("List of tool names that are always blocked, overriding the allowlist. Empty by default for agent autonomy."),
  }).default({}).describe("Tool permissions configuration."),
  llmSecurity: z.object({
    enabled: z.boolean().default(false).describe("Enable LLM-based security evaluation for shell commands."),
    provider: z.string().optional().describe("LLM provider for security evaluation (e.g., 'openai', 'gemini')."),
    model: z.string().optional().describe("Specific LLM model to use (e.g., 'gpt-4-turbo', 'gemini-pro')."),
    apiKey: z.string().optional().describe("API key for the LLM provider."),
    elicitationEnabled: z.boolean().default(false).describe("Enable interactive elicitation by LLM for potentially unsafe commands."),
    skipSafeCommands: z.boolean().default(true).describe("Optimize: Skip LLM checks for commands pre-identified as safe patterns.")
  }).default({}).describe("Configuration for LLM-based security features."),
  processManager: ProcessManagerConfigSchema.optional(),
  execution: ExecutionStrategyConfigSchema,
  sshConnectionPool: SSHConnectionPoolConfigSchema,
  resources: ResourcesConfigSchema,
});

export type InfectedConfig = z.infer<typeof InfectedConfigSchema>;
