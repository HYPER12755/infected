export const ERROR_CODES = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
    SESSION_BUSY: 'SESSION_BUSY',
    SESSION_EXISTS: 'SESSION_EXISTS',
    CONNECTION_FAILED: 'CONNECTION_FAILED',
    AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
    COMMAND_TIMEOUT: 'COMMAND_TIMEOUT',
    FILE_TOO_LARGE: 'FILE_TOO_LARGE',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    NOT_FOUND: 'NOT_FOUND',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    TOOL_EXECUTION_ERROR: 'TOOL_EXECUTION_ERROR',
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    NETWORK_ERROR: 'NETWORK_ERROR',
    FILE_SYSTEM_ERROR: 'FILE_SYSTEM_ERROR',
    INVALID_PATH: 'INVALID_PATH',
    PATH_OUTSIDE_ALLOWED: 'PATH_OUTSIDE_ALLOWED',
    DIRECTORY_NOT_EMPTY: 'DIRECTORY_NOT_EMPTY',
    FILE_ALREADY_EXISTS: 'FILE_ALREADY_EXISTS',
    INVALID_FORMAT: 'INVALID_FORMAT',
    FETCH_ERROR: 'FETCH_ERROR',
    HTTP_ERROR: 'HTTP_ERROR',
    MEMORY_ERROR: 'MEMORY_ERROR',
    TERMINAL_ERROR: 'TERMINAL_ERROR',
};
export function createErrorResponse(code, message, options) {
    const error = {
        code,
        message,
        ...options,
    };
    const text = formatErrorAsText(error);
    return {
        content: [
            {
                type: 'text',
                text,
            },
        ],
        isError: true,
        structuredContent: {
            error,
        },
    };
}
function formatErrorAsText(error) {
    const parts = [];
    parts.push(`[${error.code}] ${error.message}`);
    if (error.details && Object.keys(error.details).length > 0) {
        const detailParts = [];
        for (const [key, value] of Object.entries(error.details)) {
            detailParts.push(`${key}=${value}`);
        }
        parts.push(`(${detailParts.join(', ')})`);
    }
    if (error.suggestion) {
        parts.push(`→ ${error.suggestion}`);
    }
    return parts.join(' ');
}
export function getErrorSuggestion(code, originalError) {
    const suggestions = {
        [ERROR_CODES.SESSION_NOT_FOUND]: 'Create a new session using ssh_new_session or provide target in ssh_operate',
        [ERROR_CODES.SESSION_BUSY]: 'Wait for the current command to complete or use ssh_close_session to terminate the busy session',
        [ERROR_CODES.SESSION_EXISTS]: 'Use a different session_id or close the existing session first',
        [ERROR_CODES.CONNECTION_FAILED]: 'Check the host, port, and network connectivity. Verify SSH service is running on the remote server',
        [ERROR_CODES.AUTHENTICATION_FAILED]: 'Verify the SSH key or password authentication. Check that the identity file exists and has correct permissions',
        [ERROR_CODES.COMMAND_TIMEOUT]: 'Increase the timeout parameter or break the command into smaller parts',
        [ERROR_CODES.FILE_TOO_LARGE]: 'Split the file into smaller chunks or use a different transfer method',
        [ERROR_CODES.PERMISSION_DENIED]: 'Check file/directory permissions on the remote server',
        [ERROR_CODES.NOT_FOUND]: 'Verify the file or resource exists on the remote system',
        [ERROR_CODES.INTERNAL_ERROR]: 'Try again later or check server logs for more details',
        [ERROR_CODES.INVALID_INPUT]: 'Check the input parameters and try again',
        [ERROR_CODES.VALIDATION_ERROR]: 'Review the tool schema and ensure all required parameters are provided',
        [ERROR_CODES.TOOL_EXECUTION_ERROR]: 'Check the command syntax and parameters, then try again',
        [ERROR_CODES.RESOURCE_NOT_FOUND]: 'The requested resource could not be found',
        [ERROR_CODES.RATE_LIMIT_EXCEEDED]: 'Too many requests. Wait before retrying',
        [ERROR_CODES.NETWORK_ERROR]: 'Check network connectivity and try again',
        [ERROR_CODES.FILE_SYSTEM_ERROR]: 'Check file system permissions and disk space',
        [ERROR_CODES.INVALID_PATH]: 'The provided path is invalid or contains illegal characters',
        [ERROR_CODES.PATH_OUTSIDE_ALLOWED]: 'The path is outside the allowed directories',
        [ERROR_CODES.DIRECTORY_NOT_EMPTY]: 'Cannot delete a non-empty directory. Use recursive delete or empty the directory first',
        [ERROR_CODES.FILE_ALREADY_EXISTS]: 'A file with this name already exists. Use a different name or enable overwrite',
        [ERROR_CODES.INVALID_FORMAT]: 'The file format is invalid or unsupported',
        [ERROR_CODES.FETCH_ERROR]: 'Failed to fetch the requested URL. Check the URL and try again',
        [ERROR_CODES.HTTP_ERROR]: 'The HTTP request failed with an error status code',
        [ERROR_CODES.MEMORY_ERROR]: 'Failed to read from or write to memory storage',
        [ERROR_CODES.TERMINAL_ERROR]: 'Failed to interact with terminal. Check if the terminal session is valid',
    };
    return suggestions[code] || 'Try again with different parameters';
}
