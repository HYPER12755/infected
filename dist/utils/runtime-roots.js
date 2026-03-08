import path from 'node:path';
/**
 * Tool execution should always target the directory where the user invoked
 * the `infected` command, not the global install path.
 */
export function getRuntimeModuleRoot() {
    return path.resolve(process.cwd());
}
export function resolveRuntimePath(relativeOrAbsolute) {
    if (!relativeOrAbsolute?.trim()) {
        return getRuntimeModuleRoot();
    }
    const cleaned = relativeOrAbsolute.trim();
    return path.isAbsolute(cleaned)
        ? path.resolve(cleaned)
        : path.resolve(getRuntimeModuleRoot(), cleaned);
}
