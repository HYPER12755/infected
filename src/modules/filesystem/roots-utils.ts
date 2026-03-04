import { promises as fs, type Stats } from 'node:fs'; // Use node:fs/promises
import * as path from 'node:path'; // Use node:path
import * as os from 'node:os'; // Use node:os
import { normalizePath } from './path-utils.js'; // Adapted import
import type { Root } from '@modelcontextprotocol/sdk/types'; // Adapted SDK import
import logger from '../../core/logger.js'; // Use our central logger

/**
 * Converts a root URI to a normalized directory path with basic security validation.
 * @param rootUri - File URI (file://...) or plain directory path
 * @returns Promise resolving to validated path or null if invalid
 */
async function parseRootUri(rootUri: string): Promise<string | null> {
  try {
    const rawPath = rootUri.startsWith('file://') ? rootUri.slice(7) : rootUri;
    const expandedPath = rawPath.startsWith('~/') || rawPath === '~' 
      ? path.join(os.homedir(), rawPath.slice(1)) 
      : rawPath;
    const absolutePath = path.resolve(expandedPath);
    const resolvedPath = await fs.realpath(absolutePath);
    return normalizePath(resolvedPath);
  } catch (error) {
    logger.debug(`Failed to parse root URI: ${rootUri}`, { error: error instanceof Error ? error.message : String(error) });
    return null; // Path doesn't exist or other error
  }
}

/**
 * Formats error message for directory validation failures.
 * @param dir - Directory path that failed validation
 * @param error - Error that occurred during validation
 * @param reason - Specific reason for failure
 * @returns Formatted error message
 */
function formatDirectoryError(dir: string, error?: unknown, reason?: string): string {
  if (reason) {
    return `Skipping ${reason}: ${dir}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Skipping invalid directory: ${dir} due to error: ${message}`;
}

/**
 * Resolves requested root directories from MCP root specifications.
 * 
 * Converts root URI specifications (file:// URIs or plain paths) into normalized
 * directory paths, validating that each path exists and is a directory.
 * Includes symlink resolution for security.
 * 
 * @param requestedRoots - Array of root specifications with URI and optional name
 * @returns Promise resolving to array of validated directory paths
 */
export async function getValidRootDirectories(
  requestedRoots: readonly Root[]
): Promise<string[]> {
  const validatedDirectories: string[] = [];
  
  for (const requestedRoot of requestedRoots) {
    const resolvedPath = await parseRootUri(requestedRoot.uri);
    if (!resolvedPath) {
      logger.error(formatDirectoryError(requestedRoot.uri, undefined, 'invalid path or inaccessible'));
      continue;
    }
    
    try {
      const stats: Stats = await fs.stat(resolvedPath);
      if (stats.isDirectory()) {
        validatedDirectories.push(resolvedPath);
      } else {
        logger.error(formatDirectoryError(resolvedPath, undefined, 'non-directory root'));
      }
    } catch (error) {
      logger.error(formatDirectoryError(resolvedPath, error));
    }
  }
  
  return validatedDirectories;
}
