import logger from '../../core/logger.js'; // Use our central logger
import type { Root } from '@modelcontextprotocol/sdk/types.js'; // Adapted SDK import
import { getValidRootDirectories } from './roots-utils.js'; // Adapted import
import { setAllowedDirectories } from './lib.js'; // Adapted import
/**
 * Formats error message for directory validation failures.
 * @param dir - Directory path that failed validation
 * @param error - Error that occurred during validation
 * @param reason - Specific reason for failure
 * @returns Formatted error message
 */
export function formatDirectoryError(dir: string, error?: unknown, reason?: string): string {
  if (reason) {
    return `Skipping ${reason}: ${dir}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Skipping invalid directory: ${dir} due to error: ${message}`;
}

// Updates allowed directories based on MCP client roots
export async function updateAllowedDirectoriesFromRoots(requestedRoots: Root[]) {
  const validatedRootDirs = await getValidRootDirectories(requestedRoots);
  if (validatedRootDirs.length > 0) {
    setAllowedDirectories(validatedRootDirs); // Update the global state in lib.ts
    logger.info(`Updated allowed directories from MCP roots: ${validatedRootDirs.length} valid directories`);
  } else {
    logger.warn("No valid root directories provided by client");
  }
}
