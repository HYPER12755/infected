import { z } from 'zod';

// Custom schema for API Key validation
const ApiKeySchema = z.string().min(8, "API Key must be at least 8 characters long.");

// Add this new schema definition
export const ProcessManagerConfigSchema = z.object({
  maxConcurrentProcesses: z.number().int().positive().default(50).describe("Maximum number of concurrent background processes."),
  outputDir: z.string().default('/tmp/mcp-shell-outputs').describe("Directory for storing background process outputs."),
}).default({});

export const InfectedConfigSchema = z.object({
  transport: z.union([z.literal('stdio'), z.literal('http'), z.literal('sse')]).default('stdio'),
  modules: z.array(z.string()).default(['shell', 'filesystem', 'memory', 'sequentialthinking', 'fetch', 'system']),
  port: z.number().int().positive().default(3000),
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
    defaultTTL: z.number().int().min(1000).default(5 * 60 * 1000).describe("Default cache entry time-to-live in milliseconds (min 1 second)."), // 5 minutes
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
});

export type InfectedConfig = z.infer<typeof InfectedConfigSchema>;
