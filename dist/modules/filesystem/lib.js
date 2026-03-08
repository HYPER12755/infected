import * as fs from 'node:fs/promises'; // Use node:fs/promises
import * as path from 'node:path'; // Use node:path
import { randomBytes } from 'node:crypto'; // Use node:crypto
import { createTwoFilesPatch } from 'diff'; // External dependency
import { minimatch } from 'minimatch'; // External dependency
import { normalizePath, expandHome } from './path-utils.js'; // Adapted import
import { isPathWithinAllowedDirectories } from './path-validation.js'; // Adapted import
import { getRuntimeModuleRoot } from '../../utils/runtime-roots.js';
import { ERROR_CODES, getErrorSuggestion } from '../../core/tool-error.js';
// Global allowed directories - set by the main module
let allowedDirectories = [];
// Function to set allowed directories from the main module
export function setAllowedDirectories(directories) {
    allowedDirectories = [...directories];
}
// Function to get current allowed directories
export function getAllowedDirectories() {
    return [...allowedDirectories];
}
// Pure Utility Functions
export function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0)
        return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i < 0 || i === 0)
        return `${bytes} ${units[0]}`;
    const unitIndex = Math.min(i, units.length - 1);
    return `${(bytes / Math.pow(1024, unitIndex)).toFixed(2)} ${units[unitIndex]}`;
}
export function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, '\n');
}
export function createUnifiedDiff(originalContent, newContent, filepath = 'file') {
    // Ensure consistent line endings for diff
    const normalizedOriginal = normalizeLineEndings(originalContent);
    const normalizedNew = normalizeLineEndings(newContent);
    return createTwoFilesPatch(filepath, filepath, normalizedOriginal, normalizedNew, 'original', 'modified');
}
export function formatDiffAsMarkdown(diff) {
    let numBackticks = 3;
    while (diff.includes('`'.repeat(numBackticks))) {
        numBackticks++;
    }
    return `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`;
}
// Helper function to resolve relative paths against allowed directories
function resolveRelativePathAgainstAllowedDirectories(relativePath) {
    if (allowedDirectories.length === 0) {
        // Fallback to the runtime root if no allowed directories are set
        return path.resolve(getRuntimeModuleRoot(), relativePath);
    }
    // Try to resolve relative path against each allowed directory
    for (const allowedDir of allowedDirectories) {
        const candidate = path.resolve(allowedDir, relativePath);
        const normalizedCandidate = normalizePath(candidate);
        // Check if the resulting path lies within any allowed directory
        if (isPathWithinAllowedDirectories(normalizedCandidate, allowedDirectories)) {
            return candidate;
        }
    }
    // If no valid resolution found, use the first allowed directory as base
    // This provides a consistent fallback behavior
    return path.resolve(allowedDirectories[0], relativePath);
}
// Security & Validation Functions
export class FilesystemError extends Error {
    constructor(message, code, suggestion) {
        super(message);
        this.code = code;
        this.suggestion = suggestion;
        this.name = 'FilesystemError';
    }
}
function throwFilesystemError(message, code, customSuggestion) {
    throw new FilesystemError(message, code, customSuggestion || getErrorSuggestion(code));
}
export async function validatePath(requestedPath) {
    const expandedPath = expandHome(requestedPath);
    const absolute = path.isAbsolute(expandedPath)
        ? path.resolve(expandedPath)
        : resolveRelativePathAgainstAllowedDirectories(expandedPath);
    const normalizedRequested = normalizePath(absolute);
    // Security: Check if path is within allowed directories before any file operations
    const isAllowed = isPathWithinAllowedDirectories(normalizedRequested, allowedDirectories);
    if (!isAllowed) {
        throwFilesystemError(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`, ERROR_CODES.PATH_OUTSIDE_ALLOWED);
    }
    // Security: Handle symlinks by checking their real path to prevent symlink attacks
    // This prevents attackers from creating symlinks that point outside allowed directories
    try {
        const realPath = await fs.realpath(absolute);
        const normalizedReal = normalizePath(realPath);
        if (!isPathWithinAllowedDirectories(normalizedReal, allowedDirectories)) {
            throwFilesystemError(`Access denied - symlink target outside allowed directories: ${realPath} not in ${allowedDirectories.join(', ')}`, ERROR_CODES.PATH_OUTSIDE_ALLOWED);
        }
        return realPath;
    }
    catch (error) {
        // Security: For new files that don't exist yet, verify parent directory
        // Skip this check for operations that use recursive creation (like mkdir with recursive: true)
        if (error.code === 'ENOENT') {
            const parentDir = path.dirname(absolute);
            try {
                const realParentPath = await fs.realpath(parentDir);
                const normalizedParent = normalizePath(realParentPath);
                if (!isPathWithinAllowedDirectories(normalizedParent, allowedDirectories)) {
                    throwFilesystemError(`Access denied - parent directory outside allowed directories: ${realParentPath} not in ${allowedDirectories.join(', ')}`, ERROR_CODES.PATH_OUTSIDE_ALLOWED);
                }
                return absolute;
            }
            catch (parentError) {
                // Parent doesn't exist - let the caller handle with recursive creation
                // Don't throw here since tools like create_directory with recursive: true handle this
                return absolute;
            }
        }
        throw error;
    }
}
// File Operations
export async function getFileStats(filePath) {
    const stats = await fs.stat(filePath);
    return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: stats.mode.toString(8).slice(-3),
    };
}
export async function readFileContent(filePath, encoding = 'utf-8') {
    return await fs.readFile(filePath, encoding);
}
export async function writeFileContent(filePath, content) {
    try {
        // Security: 'wx' flag ensures exclusive creation - fails if file/symlink exists,
        // preventing writes through pre-existing symlinks
        await fs.writeFile(filePath, content, { encoding: "utf-8", flag: 'wx' });
    }
    catch (error) {
        if (error.code === 'EEXIST') {
            // Security: Use atomic rename to prevent race conditions where symlinks
            // could be created between validation and write. Rename operations
            // replace the target file atomically and don't follow symlinks.
            const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
            try {
                await fs.writeFile(tempPath, content, 'utf-8');
                await fs.rename(tempPath, filePath);
            }
            catch (renameError) {
                try {
                    await fs.unlink(tempPath);
                }
                catch { }
                throw renameError;
            }
        }
        else {
            throw error;
        }
    }
}
export async function applyFileEdits(filePath, edits, dryRun = false) {
    // Read file content and normalize line endings
    const content = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));
    // Apply edits sequentially
    let modifiedContent = content;
    for (const edit of edits) {
        const normalizedOld = normalizeLineEndings(edit.oldText);
        const normalizedNew = normalizeLineEndings(edit.newText);
        // If exact match exists, use it
        if (modifiedContent.includes(normalizedOld)) {
            modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
            continue;
        }
        // Otherwise, try line-by-line matching with flexibility for whitespace
        const oldLines = normalizedOld.split('\n');
        const contentLines = modifiedContent.split('\n');
        let matchFound = false;
        for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
            const potentialMatch = contentLines.slice(i, i + oldLines.length);
            // Compare lines with normalized whitespace
            const isMatch = oldLines.every((oldLine, j) => {
                const contentLine = potentialMatch[j];
                return oldLine.trim() === contentLine.trim();
            });
            if (isMatch) {
                // Preserve original indentation of first line
                const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
                const newLines = normalizedNew.split('\n').map((line, j) => {
                    if (j === 0)
                        return originalIndent + line.trimStart();
                    // For subsequent lines, try to preserve relative indentation
                    const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || '';
                    const newIndent = line.match(/^\s*/)?.[0] || '';
                    if (oldIndent && newIndent) {
                        const relativeIndent = newIndent.length - oldIndent.length;
                        return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
                    }
                    return line;
                });
                contentLines.splice(i, oldLines.length, ...newLines);
                modifiedContent = contentLines.join('\n');
                matchFound = true;
                break;
            }
        }
        if (!matchFound) {
            throwFilesystemError(`Could not find exact match for edit. The old text may have already been modified or doesn't exist in the file.`, ERROR_CODES.INVALID_INPUT, 'Make sure the exact text exists in the file before editing');
        }
    }
    // Create unified diff
    const diff = createUnifiedDiff(content, modifiedContent, filePath);
    const formattedDiff = formatDiffAsMarkdown(diff);
    if (!dryRun) {
        // Security: Use atomic rename to prevent race conditions where symlinks
        // could be created between validation and write. Rename operations
        // replace the target file atomically and don't follow symlinks.
        const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
        try {
            await fs.writeFile(tempPath, modifiedContent, 'utf-8');
            await fs.rename(tempPath, filePath);
        }
        catch (error) {
            try {
                await fs.unlink(tempPath);
            }
            catch { }
            throw error;
        }
    }
    return formattedDiff;
}
// Memory-efficient implementation to get the last N lines of a file
export async function tailFile(filePath, numLines) {
    const CHUNK_SIZE = 1024; // Read 1KB at a time
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    if (fileSize === 0)
        return '';
    // Open file for reading
    const fileHandle = await fs.open(filePath, 'r');
    try {
        const lines = [];
        let position = fileSize;
        let chunk = Buffer.alloc(CHUNK_SIZE);
        let linesFound = 0;
        let remainingText = '';
        // Read chunks from the end of the file until we have enough lines
        while (position > 0 && linesFound < numLines) {
            const size = Math.min(CHUNK_SIZE, position);
            position -= size;
            const { bytesRead } = await fileHandle.read(chunk, 0, size, position);
            if (!bytesRead)
                break;
            // Get the chunk as a string and prepend any remaining text from previous iteration
            const readData = chunk.slice(0, bytesRead).toString('utf-8');
            const chunkText = readData + remainingText;
            // Split by newlines and count
            const chunkLines = normalizeLineEndings(chunkText).split('\n');
            // If this isn't the end of the file, the first line is likely incomplete
            // Save it to prepend to the next chunk
            if (position > 0) {
                remainingText = chunkLines[0];
                chunkLines.shift(); // Remove the first (incomplete) line
            }
            // Add lines to our result (up to the number we need)
            for (let i = chunkLines.length - 1; i >= 0 && linesFound < numLines; i--) {
                lines.unshift(chunkLines[i]);
                linesFound++;
            }
        }
        return lines.join('\n');
    }
    finally {
        await fileHandle.close();
    }
}
// New function to get the first N lines of a file
export async function headFile(filePath, numLines) {
    const fileHandle = await fs.open(filePath, 'r');
    try {
        const lines = [];
        let buffer = '';
        let bytesRead = 0;
        const chunk = Buffer.alloc(1024); // 1KB buffer
        // Read chunks and count lines until we have enough or reach EOF
        while (lines.length < numLines) {
            const result = await fileHandle.read(chunk, 0, chunk.length, bytesRead);
            if (result.bytesRead === 0)
                break; // End of file
            bytesRead += result.bytesRead;
            buffer += chunk.slice(0, result.bytesRead).toString('utf-8');
            const newLineIndex = buffer.lastIndexOf('\n');
            if (newLineIndex !== -1) {
                const completeLines = buffer.slice(0, newLineIndex).split('\n');
                buffer = buffer.slice(newLineIndex + 1);
                for (const line of completeLines) {
                    lines.push(line);
                    if (lines.length >= numLines)
                        break;
                }
            }
        }
        // If there is leftover content and we still need lines, add it
        if (buffer.length > 0 && lines.length < numLines) {
            lines.push(buffer);
        }
        return lines.join('\n');
    }
    finally {
        await fileHandle.close();
    }
}
export async function searchFilesWithValidation(rootPath, pattern, allowedDirectories, options = {}) {
    const { excludePatterns = ['**/node_modules/**', '**/.git/**'], maxResults = 1000, timeoutMs = 15000 } = options;
    const results = [];
    const startedAt = Date.now();
    const normalizedRoot = await validatePath(rootPath);
    const normalizedPattern = pattern.includes('/') || pattern.includes('**')
        ? pattern
        : `**/${pattern}`;
    const stack = [normalizedRoot];
    while (stack.length > 0) {
        if (Date.now() - startedAt > timeoutMs) {
            break;
        }
        if (results.length >= maxResults) {
            break;
        }
        const currentPath = stack.pop();
        if (!currentPath) {
            continue;
        }
        let entries = [];
        try {
            entries = await fs.readdir(currentPath, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const rawEntry of entries) {
            const entry = rawEntry;
            if (Date.now() - startedAt > timeoutMs || results.length >= maxResults) {
                break;
            }
            if (entry.isSymbolicLink()) {
                continue;
            }
            const fullPath = path.join(currentPath, entry.name);
            const relativePath = path.relative(normalizedRoot, fullPath);
            if (!relativePath || relativePath.startsWith('..')) {
                continue;
            }
            const shouldExclude = excludePatterns.some((excludePattern) => minimatch(relativePath, excludePattern, { dot: true }));
            if (shouldExclude) {
                continue;
            }
            if (minimatch(relativePath, normalizedPattern, { dot: true }) ||
                minimatch(entry.name, pattern, { dot: true })) {
                results.push(fullPath);
            }
            if (entry.isDirectory()) {
                stack.push(fullPath);
            }
        }
    }
    return results;
}
