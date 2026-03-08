import { z } from 'zod';
/**
 * Defines the types of modules supported by the unified system.
 */
export const ModuleTypeSchema = z.enum(['tool', 'plugin']);
/**
 * Unified schema for module manifests (module.json or exported metadata).
 * This combines and extends metadata from existing Tool and Plugin definitions.
 */
export const UnifiedModuleManifestSchema = z.object({
    id: z.string().min(1, 'Module ID cannot be empty'),
    name: z.string().min(1, 'Module name cannot be empty'),
    version: z.string().min(1, 'Module version cannot be empty'),
    type: ModuleTypeSchema,
    entry: z.string().min(1, 'Module entry file cannot be empty'), // Path to the main module file
    description: z.string().optional(),
    timeout: z.number().int().positive().optional(), // General timeout for lifecycle/execution
    // Tool specific
    inputs: z.record(z.any()).optional().describe('Input schema for the module, compatible with ZodRawShapeCompat.'),
    outputs: z.record(z.any()).optional(), // Zod schema for outputs
    // Plugin specific
    provides: z.array(z.string()).optional(), // What the plugin provides (e.g., "tools", "resources")
    dependencies: z.array(z.string()).optional(), // Other modules this plugin depends on
});
// Type guard to check if a module is a tool
export function isUnifiedTool(module) {
    return Boolean(module &&
        module.manifest &&
        module.manifest.type === 'tool' &&
        typeof module.execute === 'function');
}
// Type guard to check if a module is a plugin
export function isUnifiedPlugin(module) {
    return Boolean(module && module.manifest && module.manifest.type === 'plugin');
}
