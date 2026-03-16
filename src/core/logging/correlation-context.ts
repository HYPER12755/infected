import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

/**
 * Correlation context metadata interface
 */
export interface ICorrelationContext {
  correlationId: string;
  parentId?: string;
  userId?: string;
  sessionId?: string;
  timestamp: number;
  depth: number;
}

/**
 * Internal context storage using AsyncLocalStorage for request-scoped context management
 * Ensures each async context maintains its own correlation data
 */
const contextStorage = new AsyncLocalStorage<ICorrelationContext>();

/**
 * CorrelationContext class
 *
 * Manages request-scoped correlation IDs using AsyncLocalStorage for thread-safe,
 * async-aware context management. Supports hierarchical trace IDs for parent-child
 * relationships, enabling distributed tracing across services.
 *
 * Usage:
 *   const context = CorrelationContext.generate();
 *   CorrelationContext.run(context, () => {
 *     const current = CorrelationContext.get();
 *     // current contains correlation ID and metadata
 *   });
 */
export class CorrelationContext {
  /**
   * Generates a new correlation context
   *
   * @param parentId - Optional parent correlation ID for hierarchical tracing
   * @param userId - Optional user identifier
   * @param sessionId - Optional session identifier
   * @returns A new correlation context with generated UUID v4
   * @throws Error if parentId is invalid UUID format
   */
  static generate(
    parentId?: string,
    userId?: string,
    sessionId?: string
  ): ICorrelationContext {
    // Validate parentId if provided
    if (parentId && !CorrelationContext.isValidUUID(parentId)) {
      throw new Error(`Invalid parentId format: ${parentId}. Expected UUID v4.`);
    }

    // Get current context to determine depth
    const currentContext = contextStorage.getStore();
    const depth = currentContext ? currentContext.depth + 1 : 0;

    return {
      correlationId: randomUUID(),
      parentId,
      userId,
      sessionId,
      timestamp: Date.now(),
      depth,
    };
  }

  /**
   * Retrieves the current correlation context
   *
   * @returns Current correlation context or undefined if no context is set
   */
  static get(): ICorrelationContext | undefined {
    return contextStorage.getStore();
  }

  /**
   * Retrieves the current correlation ID
   *
   * @returns Current correlation ID or undefined if no context is set
   */
  static getId(): string | undefined {
    return contextStorage.getStore()?.correlationId;
  }

  /**
   * Executes a callback within a specific correlation context
   *
   * @param context - The correlation context to use
   * @param callback - Function to execute within the context
   * @returns The return value of the callback
   * @throws Any error thrown by the callback
   */
  static run<T>(
    context: ICorrelationContext,
    callback: () => T
  ): T {
    if (!context || !context.correlationId) {
      throw new Error('Invalid context: correlationId is required');
    }

    return contextStorage.run(context, callback);
  }

  /**
   * Executes an async callback within a specific correlation context
   *
   * @param context - The correlation context to use
   * @param callback - Async function to execute within the context
   * @returns Promise that resolves to the return value of the callback
   * @throws Any error thrown by the callback
   */
  static async runAsync<T>(
    context: ICorrelationContext,
    callback: () => Promise<T>
  ): Promise<T> {
    if (!context || !context.correlationId) {
      throw new Error('Invalid context: correlationId is required');
    }

    return contextStorage.run(context, callback);
  }

  /**
   * Creates a child context from the current context
   *
   * @param userId - Optional user identifier to override
   * @param sessionId - Optional session identifier to override
   * @returns A new child context with current context as parent
   * @throws Error if no current context exists
   */
  static createChild(
    userId?: string,
    sessionId?: string
  ): ICorrelationContext {
    const current = contextStorage.getStore();
    if (!current) {
      throw new Error(
        'Cannot create child context: no parent context exists'
      );
    }

    return {
      correlationId: randomUUID(),
      parentId: current.correlationId,
      userId: userId || current.userId,
      sessionId: sessionId || current.sessionId,
      timestamp: Date.now(),
      depth: current.depth + 1,
    };
  }

  /**
   * Clears the current correlation context
   */
  static clear(): void {
    // AsyncLocalStorage.exitScopedCallback() is used internally,
    // but we can't directly clear. Instead, we can use run with undefined context
    // Note: This is a limitation of AsyncLocalStorage - we just document that
    // contexts are automatically cleared when async operations complete
  }

  /**
   * Validates if a string is a valid UUID v4
   *
   * @param uuid - String to validate
   * @returns True if valid UUID v4, false otherwise
   */
  private static isValidUUID(uuid: string): boolean {
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4Regex.test(uuid);
  }

  /**
   * Returns correlation context as a formatted string for logging
   *
   * @param context - Context to format (uses current if not provided)
   * @returns Formatted string representation
   */
  static format(context?: ICorrelationContext): string {
    const ctx = context || contextStorage.getStore();
    if (!ctx) {
      return 'no-context';
    }

    const parts = [ctx.correlationId];
    if (ctx.parentId) {
      parts.push(`parent:${ctx.parentId}`);
    }
    if (ctx.userId) {
      parts.push(`user:${ctx.userId}`);
    }
    if (ctx.sessionId) {
      parts.push(`session:${ctx.sessionId}`);
    }
    if (ctx.depth > 0) {
      parts.push(`depth:${ctx.depth}`);
    }

    return parts.join('|');
  }

  /**
   * Returns correlation context as metadata object for structured logging
   *
   * @param context - Context to convert (uses current if not provided)
   * @returns Metadata object
   */
  static toMetadata(context?: ICorrelationContext): Record<string, any> {
    const ctx = context || contextStorage.getStore();
    if (!ctx) {
      return {};
    }

    const metadata: Record<string, any> = {
      correlationId: ctx.correlationId,
    };

    if (ctx.parentId) {
      metadata.parentId = ctx.parentId;
    }
    if (ctx.userId) {
      metadata.userId = ctx.userId;
    }
    if (ctx.sessionId) {
      metadata.sessionId = ctx.sessionId;
    }
    if (ctx.depth > 0) {
      metadata.depth = ctx.depth;
    }

    metadata.timestamp = ctx.timestamp;

    return metadata;
  }

  /**
   * Checks if a context exists in the current async scope
   *
   * @returns True if a context exists, false otherwise
   */
  static exists(): boolean {
    return contextStorage.getStore() !== undefined;
  }

  /**
   * Gets all context information as a plain object
   *
   * @returns Current context as plain object or null
   */
  static getAll(): ICorrelationContext | null {
    return contextStorage.getStore() || null;
  }
}

export default CorrelationContext;
