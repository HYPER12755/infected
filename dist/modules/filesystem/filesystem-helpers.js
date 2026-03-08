import { createReadStream } from 'node:fs'; // Use node:fs
import logger from '../../core/logger.js'; // Use our central logger
import { getValidRootDirectories } from './roots-utils.js'; // Adapted import
import { setAllowedDirectories } from './lib.js'; // Adapted import
// Reads a file as a stream of buffers, concatenates them, and then encodes
// the result to a Base64 string. This is a memory-efficient way to handle
// binary data from a stream before the final encoding.
export async function readFileAsBase64Stream(filePath) {
    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        const chunks = [];
        stream.on('data', (chunk) => {
            chunks.push(chunk);
        });
        stream.on('end', () => {
            const finalBuffer = Buffer.concat(chunks);
            resolve(finalBuffer.toString('base64'));
        });
        stream.on('error', (err) => {
            logger.error(`Error reading file stream for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
            reject(err);
        });
    });
}
/**
 * Formats error message for directory validation failures.
 * @param dir - Directory path that failed validation
 * @param error - Error that occurred during validation
 * @param reason - Specific reason for failure
 * @returns Formatted error message
 */
export function formatDirectoryError(dir, error, reason) {
    if (reason) {
        return `Skipping ${reason}: ${dir}`;
    }
    const message = error instanceof Error ? error.message : String(error);
    return `Skipping invalid directory: ${dir} due to error: ${message}`;
}
// Updates allowed directories based on MCP client roots
export async function updateAllowedDirectoriesFromRoots(requestedRoots) {
    const validatedRootDirs = await getValidRootDirectories(requestedRoots);
    if (validatedRootDirs.length > 0) {
        setAllowedDirectories(validatedRootDirs); // Update the global state in lib.ts
        logger.info(`Updated allowed directories from MCP roots: ${validatedRootDirs.length} valid directories`);
    }
    else {
        logger.warn("No valid root directories provided by client");
    }
}
