import { ErrorCategory, ErrorInfo } from '../types/shell-server/index.js'; // Adapted import

/**
 * Safely extracts error message from any error type
 * @param error - The error object (could be Error, string, or any type)
 * @returns A safe string representation of the error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as Record<string, unknown>).message);
  }
  return String(error || 'Unknown error');
}

/**
 * Safely extracts error details from any error type
 * @param error - The error object
 * @returns Error details object
 */
export function getErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof MCPShellError) {
    return error.details || {};
  }
  if (error instanceof Error && error.stack) {
    return { stack: error.stack };
  }
  return {};
}

export class MCPShellError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: string;
  public readonly requestId?: string;

  constructor(
    code: string,
    message: string,
    category: ErrorCategory,
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message);
    this.name = 'MCPShellError';
    this.code = code;
    this.category = category;
    this.details = details || {};
    this.timestamp = new Date().toISOString();
    this.requestId = requestId || '';
  }

  toErrorInfo(): ErrorInfo {
    const errorInfo: ErrorInfo = {
      code: this.code,
      message: this.message,
      category: this.category,
      timestamp: this.timestamp,
    };

    if (this.details && Object.keys(this.details).length > 0) {
      errorInfo.details = this.details;
    }

    if (this.requestId) {
      errorInfo.request_id = this.requestId;
    }

    return errorInfo;
  }

  static fromError(error: unknown, requestId?: string): MCPShellError {
    if (error instanceof MCPShellError) {
      return error;
    }

    if (error instanceof Error) {
      return new MCPShellError(
        'SYSTEM_001',
        error.message,
        'SYSTEM',
        { stack: error.stack },
        requestId
      );
    }

    return new MCPShellError(
      'SYSTEM_001',
      'Unknown error occurred',
      'SYSTEM',
      { originalError: String(error) },
      requestId
    );
  }
}

// 定義済みエラー
export class ResourceNotFoundError extends MCPShellError {
  constructor(resourceType: string, id: string, requestId?: string) {
    super(
      'RESOURCE_001',
      `${resourceType} with ID ${id} not found`,
      'RESOURCE',
      { resourceType, id },
      requestId
    );
  }
}

export class ExecutionError extends MCPShellError {
  constructor(message: string, details?: Record<string, unknown>, requestId?: string) {
    super('EXECUTION_001', message, 'EXECUTION', details, requestId);
  }
}

export class TimeoutError extends MCPShellError {
  constructor(timeoutSeconds: number, requestId?: string) {
    super(
      'EXECUTION_002',
      `Operation timed out after ${timeoutSeconds} seconds`,
      'EXECUTION',
      { timeoutSeconds },
      requestId
    );
  }
}

export class SecurityError extends MCPShellError {
  constructor(message: string, details?: Record<string, unknown>, requestId?: string) {
    super('SECURITY_001', message, 'SECURITY', details, requestId);
  }
}

export class ResourceLimitError extends MCPShellError {
  constructor(resource: string, limit: number, requestId?: string) {
    super(
      'RESOURCE_005',
      `${resource} limit of ${limit} reached`,
      'RESOURCE',
      { resource, limit },
      requestId
    );
  }
}
