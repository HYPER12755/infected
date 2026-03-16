# Error Handling Documentation

## Overview

All modules in the infected MCP server use a standardized error handling system that provides consistent, actionable error messages to help AI agents understand and recover from failures.

## Error Response Format

All tool errors follow this structure:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: {message}\nCode: {error_code}\n\nDetails:\n  key: value\n\nSuggestion: {recovery_suggestion}"
    }
  ],
  "isError": true,
  "structuredContent": {
    "error": {
      "code": "{error_code}",
      "message": "{message}",
      "details": { ... },
      "recoverable": true|false,
      "suggestion": "{recovery_suggestion}"
    }
  }
}
```

## Error Codes

### SSH Module Errors

| Code | Description | Suggestion |
|------|-------------|------------|
| `SESSION_NOT_FOUND` | SSH session does not exist | Create a new session using ssh_new_session or provide target in ssh_operate |
| `SESSION_BUSY` | Session is executing another command | Wait for the current command to complete or use ssh_close_session |
| `SESSION_EXISTS` | Session with same ID already exists | Use a different session_id or close the existing session first |
| `CONNECTION_FAILED` | Cannot connect to SSH server | Check host, port, and network connectivity |
| `AUTHENTICATION_FAILED` | SSH authentication failed | Verify SSH key or password authentication |
| `COMMAND_TIMEOUT` | Command execution timed out | Increase timeout parameter or break command into smaller parts |

### Filesystem Module Errors

| Code | Description | Suggestion |
|------|-------------|------------|
| `NOT_FOUND` | File or directory not found | Verify the file or resource exists |
| `PERMISSION_DENIED` | Access denied to file/directory | Check file/directory permissions |
| `PATH_OUTSIDE_ALLOWED` | Path is outside allowed directories | Use a path within allowed directories |
| `INVALID_PATH` | Path is invalid | Check the path format and characters |
| `DIRECTORY_NOT_EMPTY` | Cannot delete non-empty directory | Use recursive delete or empty the directory first |
| `FILE_ALREADY_EXISTS` | File already exists | Use a different name or enable overwrite |
| `INVALID_INPUT` | Invalid input parameters | Check the input parameters and try again |
| `FILE_TOO_LARGE` | File size exceeds limit | Use smaller files or chunk the operation |

### Fetch Module Errors

| Code | Description | Suggestion |
|------|-------------|------------|
| `FETCH_ERROR` | General fetch failure | Check the URL and try again |
| `NETWORK_ERROR` | Network connectivity issue | Check network connectivity |
| `HTTP_ERROR` | HTTP request failed | Check the URL and HTTP status |

### General Errors

| Code | Description | Suggestion |
|------|-------------|------------|
| `INTERNAL_ERROR` | Unexpected server error | Try again later or check server logs |
| `VALIDATION_ERROR` | Input validation failed | Review the tool schema and ensure all required parameters are provided |
| `TOOL_EXECUTION_ERROR` | Tool execution failed | Check the command syntax and parameters |

## Example Error Responses

All errors use a concise one-liner format: `[CODE] message (key=value) → suggestion`

### File Not Found
```
[NOT_FOUND] File not found: /path/to/file.txt (path=/path/to/file.txt)
```

### Permission Denied
```
[PERMISSION_DENIED] Permission denied: /root/secret.txt (path=/root/secret.txt)
```

### Path Outside Allowed
```
[PATH_OUTSIDE_ALLOWED] Access denied - path outside allowed directories: /etc/passwd not in /root/sandbox (path=/etc/passwd)
```

### SSH Session Not Found
```
[SESSION_NOT_FOUND] Session my-session not found (sessionId=my-session) → Create a new session using ssh_new_session
```

### SSH Session Busy
```
[SESSION_BUSY] Session my-session is busy executing: npm install (sessionId=my-session) → Wait for current command to complete
```

### SSH Connection Failed
```
[CONNECTION_FAILED] Connection failed: Could not resolve hostname (host=invalid.host, port=22) → Check host and network connectivity
```

### Command Timeout
```
[COMMAND_TIMEOUT] Command timed out after 30000ms (command=npm install) → Increase timeout or break into smaller parts
```

### Fetch 404 Error
```
[NOT_FOUND] Fetch failed: Request failed with status code 404 (url=https://example.com/page)
```

### Fetch Timeout
```
[COMMAND_TIMEOUT] Fetch failed: timeout of 10000ms exceeded (url=https://slow-server.com)
```

### Validation Error
```
[VALIDATION_ERROR] Directory path cannot be empty → Provide a valid path
```

### Entity Not Found (Memory)
```
[NOT_FOUND] Entity with name 'user-123' not found (entityName=user-123)
```

## Filesystem Tool Error Examples

### read_text_file - File Not Found
```
[NOT_FOUND] File not found: /path/to/nonexistent.txt (path=/path/to/nonexistent.txt)
```

### read_text_file - Permission Denied
```
[PERMISSION_DENIED] Permission denied: /root/secret.txt (path=/root/secret.txt)
```

### read_text_file - Path Outside Allowed
```
[PATH_OUTSIDE_ALLOWED] Access denied - path outside allowed directories: /etc/passwd not in /root/sandbox (path=/etc/passwd)
```

### write_file - File Already Exists
```
[FILE_ALREADY_EXISTS] File already exists: /path/to/existing.txt (path=/path/to/existing.txt)
```

### write_file - Permission Denied
```
[PERMISSION_DENIED] Permission denied: /root/readonly/file.txt (path=/root/readonly/file.txt)
```

### write_file - Empty Path
```
[VALIDATION_ERROR] File path cannot be empty
```

### create_directory - Empty Path
```
[VALIDATION_ERROR] Directory path cannot be empty
```

### create_directory - Path Already Exists
```
[FILE_ALREADY_EXISTS] File already exists: /path/to/directory (path=/path/to/directory)
```

### move_file - Source Not Found
```
[NOT_FOUND] File not found: /path/to/source.txt (source=/path/to/source.txt)
```

### move_file - Destination Exists
```
[FILE_ALREADY_EXISTS] File already exists: /path/to/destination.txt (destination=/path/to/destination.txt)
```

### edit_file - Invalid Input
```
[INVALID_INPUT] Could not find exact match for edit - old text may have been modified (path=/path/to/file.txt)
```

### search_files - Path Outside Allowed
```
[PATH_OUTSIDE_ALLOWED] Access denied - path outside allowed directories: /forbidden/path not in /root/sandbox (path=/forbidden/path)
```

### get_file_info - File Not Found
```
[NOT_FOUND] File not found: /path/to/nonexistent.txt (path=/path/to/nonexistent.txt)
```

### read_multiple_files - Partial Failure
```
/path/file1.txt: [NOT_FOUND] File not found: /path/file1.txt
/path/file2.txt: [PERMISSION_DENIED] Permission denied: /path/file2.txt
/path/file3.txt: (file content)
```
  path: /path/to/directory

Suggestion: A file with this name already exists. Use a different name or enable overwrite
```

### move_file - Source Not Found
```
Error: File not found: /path/to/source.txt
Code: NOT_FOUND
Details:
  source: /path/to/source.txt

Suggestion: Verify the file or resource exists on the remote system
```

### move_file - Destination Exists
```
Error: File already exists: /path/to/destination.txt
Code: FILE_ALREADY_EXISTS
Details:
  destination: /path/to/destination.txt

Suggestion: A file with this name already exists. Use a different name or enable overwrite
```

### edit_file - Invalid Input
```
Error: Could not find exact match for edit. The old text may have already been modified or doesn't exist in the file.
Code: INVALID_INPUT
Details:
  path: /path/to/file.txt

Suggestion: Make sure the exact text exists in the file before editing
```

### edit_file - Path Outside Allowed
```
Error: Access denied - path outside allowed directories: /etc/file.txt not in /root/sandbox
Code: PATH_OUTSIDE_ALLOWED
Details:
  path: /etc/file.txt

Suggestion: The path is outside the allowed directories
```

### search_files - Invalid Path
```
Error: Access denied - path outside allowed directories: /forbidden/path not in /root/sandbox
Code: PATH_OUTSIDE_ALLOWED
Details:
  path: /forbidden/path

Suggestion: The path is outside the allowed directories
```

### get_file_info - File Not Found
```
Error: File not found: /path/to/nonexistent.txt
Code: NOT_FOUND
Details:
  path: /path/to/nonexistent.txt

Suggestion: Verify the file or resource exists on the remote system
```

---

## SSH Module Error Examples

### ssh_execute - Session Not Found
```
[SESSION_NOT_FOUND] Session my-session not found (sessionId=my-session, command=ls -la) → Create a new session using ssh_new_session
```

### ssh_execute - Session Busy
```
[SESSION_BUSY] Session my-session is busy executing: npm install (sessionId=my-session) → Wait for current command to complete
```

### ssh_execute - Command Timeout
```
[COMMAND_TIMEOUT] Command timed out after 30000ms (sessionId=my-session, command=apt-get upgrade) → Increase timeout or break into smaller parts
```

### ssh_new_session - Session Already Exists
```
[SESSION_EXISTS] Session my-session already exists. Close it before recreating. (sessionId=my-session) → Use different session_id or close existing
```

### ssh_new_session - Connection Failed
```
[CONNECTION_FAILED] Connection failed: Could not resolve hostname (sessionId=my-session, host=invalid.host) → Check host and network connectivity
```

### ssh_new_session - Authentication Failed
```
[AUTHENTICATION_FAILED] Connection failed: Authentication failed (sessionId=my-session) → Verify SSH key or password
```

### ssh_upload_file - File Not Found (Local)
```
[NOT_FOUND] File not found: /local/path/nonexistent.txt (localPath=/local/path/nonexistent.txt)
```

### ssh_download_file - File Not Found (Remote)
```
[NOT_FOUND] Remote file not found: /remote/path/nonexistent.txt (remotePath=/remote/path/nonexistent.txt)
```

---

## Shell Module Error Examples

### shell_execute - Command Not Allowed
```
[TOOL_EXECUTION_ERROR] Command 'rm' is not allowed by the server's allowlist (command=rm -rf /)
```

### shell_execute - Command Timeout
```
[COMMAND_TIMEOUT] Command execution timed out after 60 seconds (command=npm install) → Increase timeout
```

### shell_execute - Invalid Working Directory
```
[NOT_FOUND] Working directory does not exist: /nonexistent/directory (workingDirectory=/nonexistent/directory)
```

### terminal_operate - Terminal Not Found
```
[TERMINAL_ERROR] Terminal not found: terminal-123 (terminalId=terminal-123)
```

### terminal_operate - Unread Output Exists
```
[TERMINAL_ERROR] Input rejected - unread output exists (terminalId=terminal-123) → Read output first or use force_input=true
```

---

## Fetch Module Error Examples

### fetch - URL Not Found (404)
```
[NOT_FOUND] Fetch failed: Request failed with status code 404 (url=https://example.com/page, statusCode=404)
```

### fetch - Connection Refused
```
[CONNECTION_FAILED] Fetch failed: connect ECONNREFUSED (url=https://example.com)
```

### fetch - Request Timeout
```
[COMMAND_TIMEOUT] Fetch failed: timeout of 10000ms exceeded (url=https://slow-server.com)
```

### fetch - TLS/SSL Error
```
[NETWORK_ERROR] Fetch failed: self signed certificate (url=https://invalid-ssl.com)
```

---

## Memory Module Error Examples

### memory_create_entity - Entity Already Exists
```
[INVALID_INPUT] Entities already exist: user-123 (entityName=user-123)
```

### memory_create_entity - Validation Failed
```
[VALIDATION_ERROR] Validation failed: Entity name is required and must be a non-empty string
```

### memory_add_observations - Entity Not Found
```
[NOT_FOUND] Entity with name 'nonexistent-entity' not found (entityName=nonexistent-entity)
```

### memory_create_relations - Entities Not Found
```
[NOT_FOUND] Entities not found: entity1, entity2 → Create entities first before creating relations
```

### memory_delete_entity - Delete Result
```
[NOT_FOUND] Entity with name 'test' not found (deleted=[], notFound=[test])
```

---

## Sequentialthinking Module Error Examples

### thinking_process - Invalid Thought Data
```
[VALIDATION_ERROR] Invalid thought data: missing required fields
```

### thinking_process - Thinking Timeout
```
[COMMAND_TIMEOUT] Thought processing timeout after 30000ms
```

### thinking_process - Iteration Limit Reached
```
[TOOL_EXECUTION_ERROR] Maximum thought iterations (10) reached without conclusion (iterations=10)
```

---

## Using the Error Utility

Modules can use the centralized error utility:

```typescript
import { createErrorResponse, ERROR_CODES, getErrorSuggestion } from '../../core/tool-error.js';

// Simple error response
return createErrorResponse(
  ERROR_CODES.NOT_FOUND,
  'File not found: /path/to/file'
);

// With details and custom suggestion
return createErrorResponse(
  ERROR_CODES.SESSION_NOT_FOUND,
  'Session not found',
  {
    details: { sessionId: 'my-session' },
    suggestion: 'Create a new session first'
  }
);
```

## Error Handling Best Practices

1. **Always use standardized error codes** - Don't create custom error codes
2. **Provide context in details** - Include relevant parameters that caused the error
3. **Include actionable suggestions** - Tell the user how to fix the issue
4. **Log errors properly** - Use the logger for server-side error tracking
5. **Handle specific errors first** - Check for specific error conditions before general errors
