# Filesystem Module Documentation

## Purpose

The Filesystem module (`src/modules/filesystem/index.ts`) is a **secure file operations module** that provides comprehensive filesystem access through MCP tools. It enables reading, writing, editing, searching, and managing files and directories while enforcing strict security boundaries through path validation and allowed directory restrictions. The module is designed to work within a controlled environment, preventing unauthorized access to sensitive system areas.

---

## Main Features

### 1. **Secure File Reading**
- Read text files with optional `head` (first N lines) and `tail` (last N lines) options
- Read multiple files in a single operation
- Read media files (images, audio) as base64-encoded data with MIME type detection
- **Code**: `readTextFileHandler` (lines 142-162), `readFileAsBase64Stream()` (lines 124-137)

### 2. **File Writing & Editing**
- Write new files or overwrite existing files with content
- Edit files using exact text matching or flexible whitespace-normalized matching
- Dry-run mode to preview changes as git-style diffs
- Atomic writes using temp files and rename operations for security
- **Code**: `writeFileContent()` (lib.ts lines 162-186), `applyFileEdits()` (lib.ts lines 195-283)

### 3. **Directory Operations**
- List directory contents with file/directory type indicators
- List directories with file sizes and sorting options (by name or size)
- Create recursive directory structures
- Generate recursive directory tree as JSON structure
- **Code**: `list_directory` (lines 370-396), `list_directory_with_sizes` (lines 398-475), `directory_tree` (lines 477-544)

### 4. **File Search**
- Recursively search for files matching glob patterns
- Support for exclude patterns
- Validate all paths against allowed directories
- **Code**: `search_files` (lines 575-602), `searchFilesWithValidation()` (lib.ts lines 375-417)

### 5. **File Metadata & Management**
- Get detailed file information (size, timestamps, permissions)
- Move/rename files and directories
- List allowed directories for transparency
- **Code**: `get_file_info` (lines 604-630), `move_file` (lines 546-573)

### 6. **Security & Path Validation**
- Allowed directory system restricts all file operations
- Symlink attack prevention via realpath resolution
- Null byte rejection in paths
- Atomic write operations to prevent race conditions
- **Code**: `validatePath()` (lib.ts lines 100-141), `isPathWithinAllowedDirectories()` (path-validation.ts lines 11-86)

---

## How It Works

### Allowed Directory System

The module restricts all file operations to a predefined set of allowed directories:

```
Registration (lines 35-51):
1. Get runtime module root from getRuntimeModuleRoot()
2. Add tools directory if specified in config
3. Store as normalized absolute paths in this.allowedDirectories
4. Pass to setAllowedDirectories() for global access
```

### Path Validation Workflow

All file operations go through `validatePath()` before any filesystem access:

```
validatePath() (lib.ts lines 100-141):
1. Expand home directory (~) using expandHome()
2. Resolve relative paths against allowed directories
3. Normalize the path using normalizePath()
4. Check if path is within allowed directories using isPathWithinAllowedDirectories()
5. Resolve symlinks using fs.realpath() to prevent symlink attacks
6. For new files, validate parent directory exists within allowed directories
7. Return validated real path
```

### MCP Roots Integration

The module supports the MCP protocol's "Roots" feature for dynamic directory access:

```
updateAllowedDirectoriesFromRoots() (lines 655-664):
1. Listen for server.oninitialized event
2. Request roots list from MCP client
3. Validate root directories
4. Update allowedDirectories dynamically
```

---

## Important Classes, Functions, and Utilities

### Core Class

| Class/Interface | Role |
|-----------------|------|
| `FilesystemModule` (line 30) | Main module class implementing `Module` interface. Manages all filesystem operations and tool registration. |

### Main Module Functions (index.ts)

| Function | Role |
|----------|------|
| `register()` (lines 35-689) | Initializes allowed directories, registers all 14 MCP tools |
| `shutdown()` (lines 691-708) | Deregisters all tools on module unload |
| `readFileAsBase64Stream()` (lines 124-137) | Memory-efficient streaming base64 encoding for media files |

### Handler Functions

| Function | Lines | Role |
|----------|-------|------|
| `readTextFileHandler` | 142-162 | Handles read_file, read_text_file tools with head/tail support |
| `read_media_file` | 218-247 | Handles media file reading with MIME type detection |
| `read_multiple_files` | 268-287 | Batch file reading with error handling per file |
| `write_file` | 304-313 | Creates or overwrites files |
| `edit_file` | 334-342 | Applies line-based edits with diff output |
| `create_directory` | 359-368 | Creates directories recursively |
| `list_directory` | 385-396 | Lists directory contents |
| `list_directory_with_sizes` | 414-475 | Lists with sizes, sorting, and summary |
| `directory_tree` | 493-544 | Recursive tree generation with exclude patterns |
| `move_file` | 562-573 | Move/rename files and directories |
| `search_files` | 593-602 | Glob-based file search |
| `get_file_info` | 619-629 | Returns file metadata |
| `list_allowed_directories` | 645-652 | Returns allowed directory list |

### Library Functions (lib.ts)

| Function | Lines | Role |
|----------|-------|------|
| `setAllowedDirectories()` | 15-17 | Sets global allowed directories |
| `getAllowedDirectories()` | 20-22 | Returns current allowed directories |
| `formatSize()` | 45-55 | Formats bytes to human-readable size |
| `normalizeLineEndings()` | 57-59 | Converts CRLF to LF |
| `createUnifiedDiff()` | 61-74 | Creates git-style diffs |
| `validatePath()` | 100-141 | Core security validation function |
| `getFileStats()` | 145-156 | Returns file metadata |
| `readFileContent()` | 158-160 | Reads file as string |
| `writeFileContent()` | 162-186 | Atomic file writes with race condition prevention |
| `applyFileEdits()` | 195-283 | Applies text edits with dry-run support |
| `tailFile()` | 286-335 | Memory-efficient last N lines reading |
| `headFile()` | 338-373 | First N lines reading |
| `searchFilesWithValidation()` | 375-417 | Recursive glob search with validation |

### Path Utilities (path-utils.ts)

| Function | Lines | Role |
|----------|-------|------|
| `convertToWindowsPath()` | 9-32 | Converts Unix-style Windows paths |
| `normalizePath()` | 39-106 | Cross-platform path normalization |
| `expandHome()` | 113-118 | Expands ~ to home directory |

### Path Validation (path-validation.ts)

| Function | Lines | Role |
|----------|-------|------|
| `isPathWithinAllowedDirectories()` | 11-86 | Checks if path is within allowed dirs |

### Input Schemas (Zod)

| Schema | Lines | Purpose |
|--------|-------|---------|
| `ReadTextFileArgsSchema` | 54-58 | Validates path, optional head/tail |
| `ReadMediaFileArgsSchema` | 60-62 | Validates media file path |
| `ReadMultipleFilesArgsSchema` | 64-69 | Validates array of paths |
| `WriteFileArgsSchema` | 71-74 | Validates path and content |
| `EditFileArgsSchema` | 81-85 | Validates path, edits array, dryRun |
| `CreateDirectoryArgsSchema` | 87-89 | Validates directory path |
| `ListDirectoryArgsSchema` | 91-93 | Validates directory path |
| `ListDirectoryWithSizesArgsSchema` | 95-98 | Validates path and sortBy |
| `DirectoryTreeArgsSchema` | 100-103 | Validates path and excludePatterns |
| `MoveFileArgsSchema` | 105-108 | Validates source and destination |
| `SearchFilesArgsSchema` | 110-114 | Validates path, pattern, excludePatterns |
| `GetFileInfoArgsSchema` | 116-118 | Validates file path |

---

## Data Flow

### Input Flow
```
Client Request (JSON with tool name and args)
    ↓
MCP Server routes to registered tool handler
    ↓
Zod schema validation (inputSchema)
    ↓
Handler function validates path with validatePath()
    ↓
Path validation checks:
    - Expand ~ to home directory
    - Resolve relative against allowed dirs
    - Normalize path
    - Check against allowed directories
    - Resolve symlinks (realpath)
    - Validate parent directory for new files
    ↓
Actual filesystem operation (fs/promises)
    ↓
Response formatting with structuredContent
```

### Output Flow
```
Filesystem Operation Result
    ↓
Format output (text for files, JSON for tree, etc.)
    ↓
Wrap in MCP CallToolResult format:
    {
      content: [{ type: 'text', text: ... }],
      structuredContent: { ... }
    }
    ↓
Return to client
```

---

## Integration

### Module System Integration

The Filesystem module implements the `Module` interface:

1. **register()**: Initializes allowed directories, registers 14 MCP tools
2. **shutdown()**: Cleans up by deregistering all tools
3. **Dynamic Roots**: Updates allowed directories based on MCP client capabilities

### Tools Registered

| Tool Name | Description |
|-----------|-------------|
| `read_file` | (Deprecated) Read text file |
| `read_text_file` | Read text file with head/tail options |
| `read_media_file` | Read image/audio as base64 |
| `read_multiple_files` | Batch read multiple files |
| `write_file` | Create or overwrite file |
| `edit_file` | Edit file with diff output |
| `create_directory` | Create directory recursively |
| `list_directory` | List directory contents |
| `list_directory_with_sizes` | List with file sizes |
| `directory_tree` | Recursive tree JSON |
| `move_file` | Move/rename file or directory |
| `search_files` | Glob pattern search |
| `get_file_info` | Get file metadata |
| `list_allowed_directories` | List allowed directories |

### Key Dependencies

| Dependency | Purpose |
|------------|---------|
| `@modelcontextprotocol/sdk` | MCP server and tool registration |
| `zod` | Input validation schemas |
| `minimatch` | Glob pattern matching |
| `diff` | Unified diff generation |
| `node:fs/promises` | Filesystem operations |
| `node:path` | Path manipulation |

---

## Example Workflow: Reading a File

### Scenario: Client calls `read_text_file` with `{ path: "./config/app.json" }`

```
1. REQUEST RECEIVED
   └─> MCP server routes to readTextFileHandler

2. INPUT VALIDATION
   └─> ReadTextFileArgsSchema.parse({ path: "./config/app.json" })

3. PATH VALIDATION (validatePath)
   └─> expandHome("./config/app.json") → "./config/app.json"
   └─> resolveRelativeAgainstAllowedDirectories() → "/project/root/config/app.json"
   └─> normalizePath() → "/project/root/config/app.json"
   └─> isPathWithinAllowedDirectories() → true
   └─> fs.realpath() → "/project/root/config/app.json" (resolves symlinks)
   └─> Return validated path

4. FILE OPERATION
   └─> readFileContent(validatedPath) → file contents string

5. RESPONSE
   └─> Return:
       {
         content: [{ type: 'text', text: '{ "name": "app", ... }' }],
         structuredContent: { content: '{ "name": "app", ... }' }
       }
```

### Example Workflow: Writing a File

### Scenario: Client calls `write_file` with `{ path: "output/data.txt", content: "Hello World" }`

```
1. REQUEST RECEIVED
   └─> MCP server routes to write_file handler

2. INPUT VALIDATION
   └─> WriteFileArgsSchema.parse({ path: "output/data.txt", content: "Hello World" })

3. PATH VALIDATION
   └─> Same validation flow as read
   └─> For new files, validates parent directory exists in allowed dirs

4. WRITE OPERATION (writeFileContent)
   └─> Try: fs.writeFile(path, content, { flag: 'wx' })
   └─> 'wx' flag = exclusive create, fails if exists
   └─> If EEXIST error:
       └─> Create temp file: "output/data.txt.abc123.tmp"
       └─> Write content to temp
       └─> fs.rename(temp, path)  // atomic replace
   └─> This prevents race conditions and symlink attacks

5. RESPONSE
   └─> Return:
       {
         content: [{ type: 'text', text: 'Successfully wrote to output/data.txt' }],
         structuredContent: { content: 'Successfully wrote to output/data.txt' }
       }
```

---

## Security Features

| Feature | Implementation |
|---------|---------------|
| **Allowed Directories** | All operations restricted to configured directories |
| **Symlink Prevention** | realpath() resolves symlinks before validation |
| **Null Byte Rejection** | Paths containing \x00 are rejected |
| **Atomic Writes** | Temp file + rename prevents race conditions |
| **Path Normalization** | Prevents directory traversal attacks |
| **Relative Path Resolution** | Resolves against allowed directories only |
| **MIME Type Detection** | Extension-based, no file content execution |

---

## Error Handling

The Filesystem module uses standardized error responses with error codes and recovery suggestions. See [ERROR_HANDLING.md](./ERROR_HANDLING.md) for detailed documentation.

### Common Error Codes

| Error Code | Description |
|------------|-------------|
| `NOT_FOUND` | File or directory not found |
| `PERMISSION_DENIED` | Access denied to file/directory |
| `PATH_OUTSIDE_ALLOWED` | Path is outside allowed directories |
| `INVALID_PATH` | Path is invalid |
| `DIRECTORY_NOT_EMPTY` | Cannot delete non-empty directory |
| `FILE_ALREADY_EXISTS` | File already exists |
| `INVALID_INPUT` | Invalid input parameters |

### Example Error Response

```
Error: Access denied - path outside allowed directories: /etc/passwd not in /root/sandbox
Code: PATH_OUTSIDE_ALLOWED

Suggestion: The path is outside the allowed directories
```

---

## Known Issues

| Issue | Location | Severity |
|-------|----------|----------|
| Path validation may have race conditions | lib.ts validatePath | Medium - window between check and use |
| No file size limits on reads | lib.ts readFileContent | Medium - large files could cause memory issues |
| Dry-run still reads file completely | lib.ts applyFileEdits | Low - performance consideration |
| Windows path handling complexity | path-utils.ts | Low - edge cases possible |
| oninitialized handler cannot be deregistered | index.ts line 705 | Low - potential handler accumulation on reload |
