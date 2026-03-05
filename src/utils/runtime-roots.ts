import path from 'node:path';

/**
 * Runtime roots might come from environment overrides.
 * - `INFECTED_WORKSPACE_ROOT` is the recommended root during development.
 * - `INFECTED_INSTALL_ROOT` represents the global installation location.
 * Both are populated by ConfigManager before modules/tools run.
 * When neither is set, fall back to the current working directory (shell where infected was launched).
 */
export function getRuntimeModuleRoot(): string {
  const workspaceRoot = process.env['INFECTED_WORKSPACE_ROOT']?.trim();
  const installRoot = process.env['INFECTED_INSTALL_ROOT']?.trim();
  const runtimeMode = process.env['INFECTED_RUNTIME_MODE']?.trim().toLowerCase();

  if (runtimeMode === 'production') {
    if (installRoot) {
      return path.resolve(installRoot);
    }
    if (workspaceRoot) {
      return path.resolve(workspaceRoot);
    }
    return process.cwd();
  }

  if (workspaceRoot) {
    return path.resolve(workspaceRoot);
  }

  if (installRoot) {
    return path.resolve(installRoot);
  }

  return process.cwd();
}

export function resolveRuntimePath(relativeOrAbsolute?: string): string {
  if (!relativeOrAbsolute?.trim()) {
    return getRuntimeModuleRoot();
  }

  const cleaned = relativeOrAbsolute.trim();
  return path.isAbsolute(cleaned)
    ? path.resolve(cleaned)
    : path.resolve(getRuntimeModuleRoot(), cleaned);
}
