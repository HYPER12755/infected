import * as fs from "node:fs/promises"; // Use node:fs/promises
import { createReadStream } from "node:fs"; // Use node:fs for createReadStream
import * as path from "node:path"; // Use node:path
import { z } from "zod";
import { minimatch } from "minimatch";
import { normalizePath } from './path-utils.js'; // Adapted import
import { getValidRootDirectories } from './roots-utils.js'; // Adapted import
import { formatSize, validatePath, getFileStats, readFileContent, writeFileContent, createUnifiedDiff, formatDiffAsMarkdown, searchFilesWithValidation, applyFileEdits, tailFile, headFile, setAllowedDirectories, } from './lib.js'; // Adapted import
import logger from '../../core/logger.js'; // Import the new logger
import { getRuntimeModuleRoot, resolveRuntimePath } from '../../utils/runtime-roots.js';
export class FilesystemModule {
    constructor() {
        this.name = 'filesystem';
        this.allowedDirectories = [];
        this.deregisterFunctions = []; // Store SDK tool handles/deregister functions
    }
    async register(server, config) {
        // Check if config.shell is defined before accessing its properties
        const shellAllowlist = config.shell?.allowlist;
        logger.info(`  FilesystemModule: Registering with allowed directories from config: ${shellAllowlist ? shellAllowlist.join(', ') : 'N/A'}`);
        // Use a single allowed directory from config, which is the current working directory
        // or a specific root if provided by the config.
        // Align the module root with the runtime workspace/install root so the filesystem tools stay
        // inside the project that launched the server instead of defaulting to toolsDir.
        const runtimeRoot = getRuntimeModuleRoot();
        const allowedSet = new Set([normalizePath(runtimeRoot)]);
        const toolsDirResolved = config.toolsDir ? resolveRuntimePath(config.toolsDir) : null;
        if (toolsDirResolved) {
            allowedSet.add(normalizePath(toolsDirResolved));
        }
        this.allowedDirectories = Array.from(allowedSet);
        setAllowedDirectories(this.allowedDirectories);
        // Schema definitions
        const ReadTextFileArgsSchema = z.object({
            path: z.string(),
            tail: z.number().optional().describe('If provided, returns only the last N lines of the file'),
            head: z.number().optional().describe('If provided, returns only the first N lines of the file'),
            start_line: z.number().int().min(1).optional().describe('Line number to start reading from (1-indexed)'),
            end_line: z.number().int().min(1).optional().describe('Line number to end reading at (1-indexed, inclusive)')
        });
        // Deprecated schema
        const ReadTextFileArgsSchemaDeprecated = z.object({
            path: z.string(),
            tail: z.number().optional().describe('If provided, returns only the last N lines of the file'),
            head: z.number().optional().describe('If provided, returns only the first N lines of the file'),
            start_line: z.number().int().min(1).optional().describe('Line number to start reading from (1-indexed)'),
            end_line: z.number().int().min(1).optional().describe('Line number to end reading at (1-indexed, inclusive)')
        });
        const ReadMediaFileArgsSchema = z.object({
            path: z.string()
        });
        const ReadMultipleFilesArgsSchema = z.object({
            paths: z
                .array(z.string())
                .min(1, "At least one file path must be provided")
                .describe("Array of file paths to read. Each path must be a string pointing to a valid file within allowed directories.")
        });
        const WriteFileArgsSchema = z.object({
            path: z.string(),
            content: z.string(),
            base_dir: z.string().optional().describe("Base directory for relative paths. Defaults to the current working directory where the server was started.")
        });
        const EditOperation = z.object({
            oldText: z.string().describe('Text to search for - must match exactly'),
            newText: z.string().describe('Text to replace with')
        });
        const EditFileArgsSchema = z.object({
            path: z.string(),
            edits: z.array(EditOperation),
            dryRun: z.boolean().default(false).describe('Preview changes using git-style diff format')
        });
        const CreateDirectoryArgsSchema = z.object({
            path: z.string().min(1, "Directory path cannot be empty"),
        });
        const ListDirectoryArgsSchema = z.object({
            path: z.string(),
        });
        const ListDirectoryWithSizesArgsSchema = z.object({
            path: z.string(),
            sortBy: z.enum(["name", "size"]).optional().default("name").describe("Sort entries by name or size")
        });
        const DirectoryTreeArgsSchema = z.object({
            path: z.string(),
            excludePatterns: z.array(z.string()).optional().default([])
        });
        const MoveFileArgsSchema = z.object({
            source: z.string(),
            destination: z.string(),
            overwrite: z.boolean().default(false).describe("Overwrite destination if it exists"),
        });
        const SearchFilesArgsSchema = z.object({
            path: z.string(),
            pattern: z.string(),
            excludePatterns: z.array(z.string()).optional().default([])
        });
        const GetFileInfoArgsSchema = z.object({
            path: z.string(),
        });
        // Reads a file as a stream of buffers, concatenates them, and then encodes
        // the result to a Base64 string. This is a memory-efficient way to handle
        // binary data from a stream before the final encoding.
        async function readFileAsBase64Stream(filePath) {
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
                stream.on('error', (err) => reject(err));
            });
        }
        // Helper function - kept for potential future use but not currently applied
        // function formatContentWithLineNumbers(content: string): string {
        //   const lines = content.split('\n');
        //   return lines.map((line, index) => `${index + 1}+- ${line}`).join('\n');
        // }
        // Tool registrations
        // read_file (deprecated) and read_text_file
        const readTextFileHandler = async (args) => {
            const validPath = await validatePath(args.path);
            if (args.head && args.tail) {
                throw new Error("Cannot specify both head and tail parameters simultaneously");
            }
            if (args.start_line !== undefined && args.end_line !== undefined && args.start_line > args.end_line) {
                throw new Error("start_line must be less than or equal to end_line");
            }
            let content;
            if (args.tail) {
                content = await tailFile(validPath, args.tail);
            }
            else if (args.head) {
                content = await headFile(validPath, args.head);
            }
            else if (args.start_line !== undefined || args.end_line !== undefined) {
                // Read specific line range
                const fullContent = await readFileContent(validPath);
                const lines = fullContent.split('\n');
                const start = args.start_line ? args.start_line - 1 : 0;
                const end = args.end_line ? args.end_line : lines.length;
                content = lines.slice(start, end).join('\n');
            }
            else {
                content = await readFileContent(validPath);
            }
            return {
                content: [{ type: "text", text: content }],
                structuredContent: { content: content }
            };
        };
        // Handler for deprecated read_file
        const readFileDeprecatedHandler = async (args) => {
            const validPath = await validatePath(args.path);
            if (args.head && args.tail) {
                throw new Error("Cannot specify both head and tail parameters simultaneously");
            }
            if (args.start_line !== undefined && args.end_line !== undefined && args.start_line > args.end_line) {
                throw new Error("start_line must be less than or equal to end_line");
            }
            let content;
            if (args.tail) {
                content = await tailFile(validPath, args.tail);
            }
            else if (args.head) {
                content = await headFile(validPath, args.head);
            }
            else if (args.start_line !== undefined || args.end_line !== undefined) {
                const fullContent = await readFileContent(validPath);
                const lines = fullContent.split('\n');
                const start = args.start_line ? args.start_line - 1 : 0;
                const end = args.end_line ? args.end_line : lines.length;
                content = lines.slice(start, end).join('\n');
            }
            else {
                content = await readFileContent(validPath);
            }
            return {
                content: [{ type: "text", text: content }],
                structuredContent: { content: content }
            };
        };
        this.deregisterFunctions.push(server.registerTool("read_file", {
            title: "Read File (Deprecated)",
            description: "Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.",
            inputSchema: ReadTextFileArgsSchemaDeprecated.shape,
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: true }
        }, readFileDeprecatedHandler));
        this.deregisterFunctions.push(server.registerTool("read_text_file", {
            title: "Read Text File",
            description: "Read the complete contents of a file from the file system as text. " +
                "Handles various text encodings and provides detailed error messages " +
                "if the file cannot be read. Use this tool when you need to examine " +
                "the contents of a single file. Use the 'head' parameter to read only " +
                "the first N lines of a file, or the 'tail' parameter to read only " +
                "the last N lines of a file. Use 'start_line' and 'end_line' to read " +
                "a specific range of lines. Only works within allowed directories.",
            inputSchema: {
                path: z.string(),
                tail: z.number().optional().describe("If provided, returns only the last N lines of the file"),
                head: z.number().optional().describe("If provided, returns only the first N lines of the file"),
                start_line: z.number().int().min(1).optional().describe("Line number to start reading from (1-indexed)"),
                end_line: z.number().int().min(1).optional().describe("Line number to end reading at (1-indexed, inclusive)")
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: true }
        }, readTextFileHandler));
        this.deregisterFunctions.push(server.registerTool("read_media_file", {
            title: "Read Media File",
            description: "Read an image or audio file. Returns the base64 encoded data and MIME type. " +
                "Only works within allowed directories.",
            inputSchema: {
                path: z.string()
            },
            outputSchema: {
                content: z.array(z.object({
                    type: z.enum(["image", "audio", "blob"]),
                    data: z.string(),
                    mimeType: z.string()
                }))
            },
            annotations: { readOnlyHint: true }
        }, async (args) => {
            const validPath = await validatePath(args.path);
            const extension = path.extname(validPath).toLowerCase();
            const mimeTypes = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
                ".bmp": "image/bmp",
                ".svg": "image/svg+xml",
                ".mp3": "audio/mpeg",
                ".wav": "audio/wav",
                ".ogg": "audio/ogg",
                ".flac": "audio/flac",
            };
            const mimeType = mimeTypes[extension] || "application/octet-stream";
            const data = await readFileAsBase64Stream(validPath);
            const type = mimeType.startsWith("image/")
                ? "image"
                : mimeType.startsWith("audio/")
                    ? "audio"
                    : "blob";
            const contentItem = { type: type, data, mimeType };
            return {
                content: [contentItem],
                structuredContent: { content: [contentItem] }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("read_multiple_files", {
            title: "Read Multiple Files",
            description: "Read the contents of multiple files simultaneously. This is more " +
                "efficient than reading files one by one when you need to analyze " +
                "or compare multiple files. Each file's content is returned with its " +
                "path as a reference. Failed reads for individual files won't stop " +
                "the entire operation. Non-text files (images, binaries) will return " +
                "an error as they require specialized tools. Only works within allowed directories.",
            inputSchema: {
                paths: z.array(z.string())
                    .min(1)
                    .describe("Array of file paths to read. Each path must be a string pointing to a valid file within allowed directories.")
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: true }
        }, async (args) => {
            const results = await Promise.all(args.paths.map(async (filePath) => {
                try {
                    const validPath = await validatePath(filePath);
                    // Check if file is likely binary
                    const ext = filePath.toLowerCase().split('.').pop();
                    const binaryExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'mp3', 'mp4', 'wav', 'ogg', 'zip', 'tar', 'gz', 'rar', '7z', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
                    if (ext && binaryExtensions.includes(ext)) {
                        return `${filePath}: Error - Binary file detected (${ext}). Use read_media_file tool for images/audio, or download the file directly.`;
                    }
                    const content = await readFileContent(validPath);
                    // Check for binary content (null bytes)
                    if (content.includes('\0')) {
                        return `${filePath}: Error - Binary file detected. Contains null bytes. Use read_media_file tool for media files.`;
                    }
                    return `${filePath}:\n${content}\n`;
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return `${filePath}: Error - ${errorMessage}`;
                }
            }));
            const text = results.join("\n---\n");
            return {
                content: [{ type: "text", text }],
                structuredContent: { content: text }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("write_file", {
            title: "Write File",
            description: "Create a new file or completely overwrite an existing file with new content. " +
                "Will create parent directories if they don't exist. " +
                "Use with caution as it will overwrite existing files without warning. " +
                "Handles text content with proper encoding. Only works within allowed directories. " +
                "Use 'base_dir' parameter to specify the base directory for relative paths.",
            inputSchema: {
                path: z.string().min(1, "File path cannot be empty"),
                content: z.string(),
                base_dir: z.string().optional().describe("Base directory for relative paths. Defaults to the server's root directory.")
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true }
        }, async (args) => {
            // If base_dir is provided, resolve relative paths against it
            // Otherwise, resolve against current working directory
            let validPath;
            if (args.base_dir) {
                // Resolve against provided base_dir
                const baseDirValid = await validatePath(args.base_dir);
                validPath = path.resolve(baseDirValid, args.path);
                // Verify the resolved path is still within allowed directories
                validPath = await validatePath(validPath);
            }
            else {
                // Resolve against current working directory for relative paths
                const cwd = process.cwd();
                if (path.isAbsolute(args.path)) {
                    validPath = await validatePath(args.path);
                }
                else {
                    const resolvedPath = path.resolve(cwd, args.path);
                    validPath = await validatePath(resolvedPath);
                }
            }
            let previousContent = '';
            try {
                previousContent = await readFileContent(validPath);
            }
            catch (error) {
                const errorCode = error.code;
                if (errorCode !== 'ENOENT') {
                    throw error;
                }
            }
            await writeFileContent(validPath, args.content);
            const diff = createUnifiedDiff(previousContent, args.content, args.path);
            const text = formatDiffAsMarkdown(diff);
            return {
                content: [{ type: "text", text }],
                structuredContent: { content: text }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("edit_file", {
            title: "Edit File",
            description: "Make line-based edits to a text file. Each edit replaces exact line sequences " +
                "with new content. Returns a git-style diff showing the changes made. " +
                "Only works within allowed directories.",
            inputSchema: {
                path: z.string(),
                edits: z.array(z.object({
                    oldText: z.string().describe("Text to search for - must match exactly"),
                    newText: z.string().describe("Text to replace with")
                })),
                dryRun: z.boolean().default(false).describe("Preview changes using git-style diff format")
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true }
        }, async (args) => {
            const validPath = await validatePath(args.path);
            const result = await applyFileEdits(validPath, args.edits, args.dryRun);
            return {
                content: [{ type: "text", text: result }],
                structuredContent: { content: result }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("create_directory", {
            title: "Create Directory",
            description: "Create a new directory or ensure a directory exists. Can create multiple " +
                "nested directories in one operation. If the directory already exists, " +
                "this operation will succeed silently. Perfect for setting up directory " +
                "structures for projects or ensuring required paths exist. Only works within allowed directories.",
            inputSchema: {
                path: z.string()
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false }
        }, async (args) => {
            const validPath = await validatePath(args.path);
            await fs.mkdir(validPath, { recursive: true });
            const text = `Successfully created directory ${args.path}`;
            return {
                content: [{ type: "text", text }],
                structuredContent: { content: text }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("list_directory", {
            title: "List Directory",
            description: "Get a detailed listing of all files and directories in a specified path. " +
                "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
                "prefixes. This tool is essential for understanding directory structure and " +
                "finding specific files within a directory. Only works within allowed directories.",
            inputSchema: {
                path: z.string()
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: true }
        }, async (args) => {
            const validPath = await validatePath(args.path);
            const entries = await fs.readdir(validPath, { withFileTypes: true });
            const text = entries
                .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
                .join("\n");
            return {
                content: [{ type: "text", text }],
                structuredContent: { content: text }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("list_directory_with_sizes", {
            title: "List Directory with Sizes",
            description: "Get a detailed listing of all files and directories in a specified path, including sizes. " +
                "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
                "prefixes. This tool is essential for understanding directory structure and " +
                "finding specific files within a directory. Only works within allowed directories.",
            inputSchema: {
                path: z.string(),
                sortBy: z.enum(["name", "size"]).optional().default("name").describe("Sort entries by name or size")
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: true }
        }, async (args) => {
            const validPath = await validatePath(args.path);
            const entries = await fs.readdir(validPath, { withFileTypes: true });
            // Get detailed information for each entry
            const detailedEntries = await Promise.all(entries.map(async (entry) => {
                const entryPath = path.join(validPath, entry.name);
                try {
                    const stats = await fs.stat(entryPath);
                    return {
                        name: entry.name,
                        isDirectory: entry.isDirectory(),
                        size: stats.size,
                        mtime: stats.mtime
                    };
                }
                catch (error) {
                    return {
                        name: entry.name,
                        isDirectory: entry.isDirectory(),
                        size: 0,
                        mtime: new Date(0)
                    };
                }
            }));
            // Sort entries based on sortBy parameter
            const sortedEntries = [...detailedEntries].sort((a, b) => {
                if (args.sortBy === 'size') {
                    return b.size - a.size; // Descending by size
                }
                // Default sort by name
                return a.name.localeCompare(b.name);
            });
            // Format the output
            const formattedEntries = sortedEntries.map(entry => `${entry.isDirectory ? "[DIR]" : "[FILE]"} ${entry.name.padEnd(30)} ${entry.isDirectory ? "" : formatSize(entry.size).padStart(10)}`);
            // Add summary
            const totalFiles = detailedEntries.filter(e => !e.isDirectory).length;
            const totalDirs = detailedEntries.filter(e => e.isDirectory).length;
            const totalSize = detailedEntries.reduce((sum, entry) => sum + (entry.isDirectory ? 0 : entry.size), 0);
            const summary = [
                "",
                `Total: ${totalFiles} files, ${totalDirs} directories`,
                `Combined size: ${formatSize(totalSize)}`
            ];
            const text = [...formattedEntries, ...summary].join("\n");
            const contentBlock = { type: "text", text };
            return {
                content: [contentBlock],
                structuredContent: { content: text }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("directory_tree", {
            title: "Directory Tree",
            description: "Get a recursive tree view of files and directories as a JSON structure. " +
                "Each entry includes 'name', 'type' (file/directory), and 'children' for directories. " +
                "Files have no children array, while directories always have a children array (which may be empty). " +
                "The output is formatted with 2-space indentation for readability. Only works within allowed directories.",
            inputSchema: {
                path: z.string(),
                excludePatterns: z.array(z.string()).optional().default([])
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: true }
        }, async (args) => {
            const rootPath = args.path;
            const rootLabel = path.basename(path.resolve(rootPath)) || rootPath;
            function renderTree(entries, prefix = "") {
                const lines = [];
                entries.forEach((entry, index) => {
                    const isLast = index === entries.length - 1;
                    const connector = isLast ? "└── " : "├── ";
                    lines.push(`${prefix}${connector}${entry.name}`);
                    if (entry.type === 'directory' && entry.children && entry.children.length > 0) {
                        const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;
                        lines.push(...renderTree(entry.children, childPrefix));
                    }
                });
                return lines;
            }
            async function buildTree(currentPath, excludePatterns = []) {
                const validPath = await validatePath(currentPath);
                const entries = await fs.readdir(validPath, { withFileTypes: true });
                const result = [];
                for (const entry of entries) {
                    const relativePath = path.relative(rootPath, path.join(currentPath, entry.name));
                    const shouldExclude = excludePatterns.some(pattern => {
                        if (pattern.includes('*')) {
                            return minimatch(relativePath, pattern, { dot: true });
                        }
                        // For files: match exact name or as part of path
                        // For directories: match as directory path
                        return minimatch(relativePath, `**/${pattern}`, { dot: true }) ||
                            minimatch(relativePath, `**/${pattern}/**`, { dot: true });
                    });
                    if (shouldExclude)
                        continue;
                    const entryData = {
                        name: entry.name,
                        type: entry.isDirectory() ? 'directory' : 'file'
                    };
                    if (entry.isDirectory()) {
                        const subPath = path.join(currentPath, entry.name);
                        entryData.children = await buildTree(subPath, excludePatterns);
                    }
                    result.push(entryData);
                }
                return result;
            }
            const treeData = await buildTree(rootPath, args.excludePatterns);
            const treeLines = [rootLabel, ...renderTree(treeData)];
            const text = treeLines.join("\n");
            const contentBlock = { type: "text", text };
            return {
                content: [contentBlock],
                structuredContent: { content: text }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("move_file", {
            title: "Move File",
            description: "Move or rename files and directories. Can move files between directories " +
                "and rename them in a single operation. Use overwrite=true to replace existing files. " +
                "Works across different directories and can be used for simple renaming within " +
                "the same directory. Both source and destination must be within allowed directories.",
            inputSchema: {
                source: z.string(),
                destination: z.string(),
                overwrite: z.boolean().default(false).describe("Overwrite destination if it exists")
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true }
        }, async (args) => {
            const validSourcePath = await validatePath(args.source);
            const validDestPath = await validatePath(args.destination);
            // Check if destination exists
            try {
                await fs.access(validDestPath);
                if (!args.overwrite) {
                    throw new Error(`Destination already exists: ${args.destination}. Use overwrite=true to replace.`);
                }
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
                // ENOENT is fine - destination doesn't exist
            }
            if (args.overwrite) {
                await fs.unlink(validDestPath);
            }
            await fs.rename(validSourcePath, validDestPath);
            const text = `Successfully moved ${args.source} to ${args.destination}`;
            const contentBlock = { type: "text", text };
            return {
                content: [contentBlock],
                structuredContent: { content: text }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("search_files", {
            title: "Search Files",
            description: "Recursively search for files and directories matching a pattern. " +
                "The patterns should be glob-style patterns that match paths relative to the working directory. " +
                "Use pattern like '*.ext' to match files in current directory, and '**/*.ext' to match files in all subdirectories. " +
                "Returns full paths to all matching items. Great for finding files when you don't know their exact location. " +
                "Only searches within allowed directories.",
            inputSchema: {
                path: z.string(),
                pattern: z.string(),
                excludePatterns: z.array(z.string()).optional().default([])
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: true }
        }, async (args) => {
            const validPath = await validatePath(args.path);
            const excludePatterns = args.excludePatterns.length > 0 ? args.excludePatterns : undefined;
            const results = await searchFilesWithValidation(validPath, args.pattern, this.allowedDirectories, {
                excludePatterns
            }); // Use this.allowedDirectories
            const maxShown = 200;
            const shown = results.slice(0, maxShown);
            const lines = [`matches: ${results.length}`];
            if (shown.length > 0) {
                lines.push(...shown);
            }
            else {
                lines.push("No matches found");
            }
            if (results.length > maxShown) {
                lines.push(`...and ${results.length - maxShown} more`);
            }
            const text = lines.join("\n");
            return {
                content: [{ type: "text", text }],
                structuredContent: { content: text }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("get_file_info", {
            title: "Get File Info",
            description: "Retrieve detailed metadata about a file or directory. Returns comprehensive " +
                "information including size, creation time, last modified time, permissions, " +
                "and type. This tool is perfect for understanding file characteristics " +
                "without reading the actual content. Only works within allowed directories.",
            inputSchema: {
                path: z.string()
            },
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: true }
        }, async (args) => {
            const validPath = await validatePath(args.path);
            const info = await getFileStats(validPath);
            const text = Object.entries(info)
                .map(([key, value]) => `${key}: ${value}`)
                .join("\n");
            return {
                content: [{ type: "text", text }],
                structuredContent: { content: text }
            };
        }));
        this.deregisterFunctions.push(server.registerTool("list_allowed_directories", {
            title: "List Allowed Directories",
            description: "Returns the list of directories that this server is allowed to access. " +
                "Subdirectories within these allowed directories are also accessible. " +
                "Use this to understand which directories and their nested paths are available " +
                "before trying to access files.",
            inputSchema: {},
            outputSchema: { content: z.string() },
            annotations: { readOnlyHint: true }
        }, async () => {
            const text = `Allowed directories:\n${this.allowedDirectories.join('\n')}`; // Use this.allowedDirectories
            return {
                content: [{ type: "text", text }],
                structuredContent: { content: text }
            };
        }));
        // Updates allowed directories based on MCP client roots
        const updateAllowedDirectoriesFromRoots = async (requestedRoots) => {
            const validatedRootDirs = await getValidRootDirectories(requestedRoots);
            if (validatedRootDirs.length > 0) {
                this.allowedDirectories = [...validatedRootDirs]; // Update module's state
                setAllowedDirectories(this.allowedDirectories); // Update the global state in lib.ts
                logger.info(`Updated allowed directories from MCP roots: ${validatedRootDirs.length} valid directories`);
            }
            else {
                logger.warn("No valid root directories provided by client");
            }
        };
        // Handles post-initialization setup, specifically checking for and fetching MCP roots.
        server.server.oninitialized = async () => {
            const clientCapabilities = server.server.getClientCapabilities();
            if (clientCapabilities?.roots) {
                try {
                    const response = await server.server.listRoots();
                    if (response && 'roots' in response) {
                        await updateAllowedDirectoriesFromRoots(response.roots);
                    }
                    else {
                        logger.warn("Client returned no roots set, keeping current settings");
                    }
                }
                catch (error) {
                    logger.error("Failed to request initial roots from client:", error instanceof Error ? error.message : String(error));
                }
            }
            else {
                if (this.allowedDirectories.length > 0) { // Use this.allowedDirectories
                    logger.warn("Client does not support MCP Roots, using allowed directories set from server args:", this.allowedDirectories);
                }
                else {
                    logger.error(`Server cannot operate: No allowed directories available. Server was started without command-line directories and client either does not support MCP roots protocol or provided empty roots. Please either: 1) Start server with directory arguments, or 2) Use a client that supports MCP roots protocol and provides valid root directories.`);
                }
            }
        };
    }
    async shutdown() {
        logger.info('  FilesystemModule: Shutting down, deregistering tools...');
        this.deregisterFunctions.forEach((deregister) => {
            if (typeof deregister === 'function') {
                deregister();
            }
            else if (deregister && typeof deregister.remove === 'function') {
                deregister.remove();
            }
        });
        this.deregisterFunctions = []; // Clear the array
        // IMPORTANT: McpServer.server.oninitialized handler cannot be directly deregistered.
        // This could lead to multiple handlers being active if the module is reloaded.
        // A robust solution would require McpServer to expose a method to remove specific handlers.
        logger.warn('  FilesystemModule: McpServer.server.oninitialized handler cannot be deregistered.');
        logger.info('  FilesystemModule: All tools deregistered.');
    }
}
export default FilesystemModule;
