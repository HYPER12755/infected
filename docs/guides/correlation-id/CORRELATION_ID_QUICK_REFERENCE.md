# Correlation ID and Logging Context System - Quick Reference Guide

## Installation & Setup

### 1. Add to Express App (5 minutes)

```typescript
// src/main.ts or src/app.ts
import express from 'express';
import { createContextMiddleware } from './core/logging/index.js';

const app = express();

// Add middleware EARLY (before route handlers)
app.use(createContextMiddleware());

// Now all routes have automatic correlation context
```

**That's it!** Every request will now have:
- Automatic correlation ID (generated or extracted from `X-Correlation-ID` header)
- Automatic logging of request start/completion
- Correlation metadata in all logs

---

## Basic Usage Examples

### Example 1: Simple Logging with Context

```typescript
import { LoggingContext } from './core/logging/index.js';

const logContext = new LoggingContext();

// All logs automatically include correlationId
logContext.info('User login attempt', { userId: '123' });
logContext.error('Database connection failed', { error: 'ECONNREFUSED' });
```

**Output:**
```json
{
  "timestamp": "2026-03-16T08:15:30.123Z",
  "level": "info",
  "message": "User login attempt",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "123",
  "component": "core"
}
```

---

### Example 2: Service Class Integration

```typescript
import { LoggingContext } from './core/logging/index.js';

class OrderService {
  private logger = new LoggingContext();

  async processOrder(orderId: string) {
    this.logger.info('Processing order', { orderId });
    
    try {
      const order = await this.getOrder(orderId);
      await this.validateOrder(order);
      await this.createShipment(order);
      
      this.logger.info('Order processed successfully', { orderId });
    } catch (error) {
      this.logger.error('Failed to process order', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async validateOrder(order: any) {
    this.logger.debug('Validating order', { orderId: order.id });
    // validation logic
  }
}
```

---

### Example 3: Child Context for Sub-Operations

```typescript
import { LoggingContext } from './core/logging/index.js';

class PaymentService {
  private logger = new LoggingContext();

  async processPayment(orderId: string, amount: number) {
    this.logger.info('Processing payment', { orderId, amount });

    // Create child context for payment processing
    try {
      return await this.logger.withChildContextAsync(
        async () => {
          // This operation has its own correlationId but linked to parent
          this.logger.info('Charging card', { orderId, amount });
          const result = await this.chargeCard(orderId, amount);
          this.logger.info('Card charged successfully', { orderId });
          return result;
        },
        'charge-card', // operation name for logging
        undefined,     // userId (optional, inherits from parent)
        undefined      // sessionId (optional, inherits from parent)
      );
    } catch (error) {
      this.logger.error('Payment processing failed', {
        orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async chargeCard(orderId: string, amount: number) {
    // actual payment logic
    return { success: true, transactionId: 'txn-123' };
  }
}
```

---

### Example 4: Calling External Services

```typescript
import { propagateCorrelationContext, LoggingContext } from './core/logging/index.js';

class EmailService {
  private logger = new LoggingContext();

  async sendEmail(recipient: string, subject: string) {
    this.logger.info('Sending email', { recipient, subject });

    // Propagate correlation context to external service
    const headers = propagateCorrelationContext({
      'content-type': 'application/json',
      'authorization': `Bearer ${process.env.EMAIL_API_KEY}`
    });

    try {
      const response = await fetch('https://api.email-provider.com/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: recipient,
          subject,
          body: 'Email content here'
        })
      });

      if (!response.ok) {
        throw new Error(`Email API error: ${response.statusText}`);
      }

      this.logger.info('Email sent successfully', { recipient });
      return await response.json();
    } catch (error) {
      this.logger.error('Failed to send email', {
        recipient,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
```

---

### Example 5: Error Handling with Context

```typescript
import {
  LoggingContext,
  attachContextToError,
  extractCorrelationIdFromError
} from './core/logging/index.js';

class DatabaseService {
  private logger = new LoggingContext();

  async query(sql: string) {
    try {
      // database query
      return await this.executeQuery(sql);
    } catch (error) {
      // Attach correlation context to error for tracing
      const tracedError = attachContextToError(error as Error);

      // Error now includes correlationId for logging systems
      this.logger.error('Database query failed', {
        sql,
        correlationId: extractCorrelationIdFromError(tracedError)
      });

      throw tracedError;
    }
  }

  private async executeQuery(sql: string) {
    // actual query execution
    throw new Error('Connection timeout');
  }
}
```

---

## API Reference

### CorrelationContext - Static Methods

```typescript
// Generate new root context
const context = CorrelationContext.generate(parentId?, userId?, sessionId?);

// Get current context
const current = CorrelationContext.get();

// Get current correlation ID
const id = CorrelationContext.getId();

// Execute within context
CorrelationContext.run(context, () => {
  // code here
});

// Execute async within context
await CorrelationContext.runAsync(context, async () => {
  // async code here
});

// Create child context (must be within parent context)
const child = CorrelationContext.createChild(userId?, sessionId?);

// Format context as string
const formatted = CorrelationContext.format(context?);

// Convert to metadata object
const metadata = CorrelationContext.toMetadata(context?);

// Check if context exists
const exists = CorrelationContext.exists();

// Get all context info
const allContext = CorrelationContext.getAll();
```

---

### LoggingContext - Instance Methods

```typescript
const logger = new LoggingContext();

// Logging methods (all include correlation metadata)
logger.error(message, metadata?);
logger.warn(message, metadata?);
logger.info(message, metadata?);
logger.debug(message, metadata?);
logger.http(message, metadata?);

// Execute callback within context
logger.withContext(context, callback, operation?);

// Execute async callback within context
await logger.withContextAsync(context, callback, operation?);

// Execute within child context
logger.withChildContext(callback, operation?, userId?, sessionId?);

// Execute async within child context
await logger.withChildContextAsync(callback, operation?, userId?, sessionId?);

// Get current context
const context = logger.getContext();

// Get current correlation ID
const id = logger.getCorrelationId();
```

---

### Middleware & Utilities

```typescript
import {
  createContextMiddleware,
  withCorrelationContext,
  withCorrelationContextSync,
  extractCorrelationIdFromError,
  attachContextToError,
  withRequestContext,
  propagateCorrelationContext
} from './core/logging/index.js';

// Create Express middleware
app.use(createContextMiddleware());

// Execute async operation with context
await withCorrelationContext(callback, correlationId?, userId?, sessionId?);

// Execute sync operation with context
withCorrelationContextSync(callback, correlationId?, userId?, sessionId?);

// Extract correlation ID from error
const id = extractCorrelationIdFromError(error);

// Attach context to error
const tracedError = attachContextToError(error, context?);

// Wrap route handler
app.get('/path', withRequestContext((req, res, next) => {
  // handler code
}));

// Get headers with correlation ID
const headers = propagateCorrelationContext(baseHeaders?, context?);
```

---

## HTTP Headers Reference

### Request Headers
| Header | Value | Required | Purpose |
|--------|-------|----------|---------|
| `X-Correlation-ID` | UUID v4 | Optional | Existing correlation ID (generated if missing) |
| `X-User-ID` | string | Optional | User identifier for logging |
| `X-Session-ID` | string | Optional | Session identifier for logging |

### Response Headers
| Header | Value | Purpose |
|--------|-------|---------|
| `X-Correlation-ID-Response` | UUID v4 | Echoes the correlation ID for client confirmation |

### Example Request/Response

**Request:**
```
GET /api/users/123 HTTP/1.1
Host: api.example.com
X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000
X-User-ID: user-456
X-Session-ID: session-789
```

**Response:**
```
HTTP/1.1 200 OK
X-Correlation-ID-Response: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{ "id": "123", "name": "John Doe" }
```

---

## Common Patterns

### Pattern 1: Request Logging Template

```typescript
class RequestHandler {
  private logger = new LoggingContext();

  async handle(req: any, res: any) {
    const startTime = Date.now();

    try {
      this.logger.info(`${req.method} ${req.path}`, {
        method: req.method,
        path: req.path
      });

      // Do work...
      const result = await this.doWork();

      const duration = Date.now() - startTime;
      this.logger.info('Request completed', {
        statusCode: 200,
        duration
      });

      res.json(result);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Request failed', {
        statusCode: 500,
        duration,
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async doWork() {
    return { success: true };
  }
}
```

---

### Pattern 2: Database Operation Tracing

```typescript
class DatabaseRepository {
  private logger = new LoggingContext();

  async findById(id: string) {
    return await this.logger.withChildContextAsync(
      async () => {
        this.logger.debug('Executing query', { operation: 'findById', id });

        const result = await this.query(`SELECT * FROM users WHERE id = ?`, [id]);

        this.logger.debug('Query completed', {
          operation: 'findById',
          rowCount: result.length
        });

        return result[0];
      },
      `db-find-by-id`
    );
  }

  private async query(sql: string, params: any[]) {
    // actual database query
    return [];
  }
}
```

---

### Pattern 3: Error Propagation with Context

```typescript
class ApiClient {
  private logger = new LoggingContext();

  async callApi(endpoint: string, options?: any) {
    try {
      const headers = propagateCorrelationContext({
        'content-type': 'application/json'
      });

      const response = await fetch(endpoint, {
        ...options,
        headers
      });

      if (!response.ok) {
        const error = new Error(`API error: ${response.statusText}`);
        throw attachContextToError(error);
      }

      return await response.json();
    } catch (error) {
      this.logger.error('API call failed', {
        endpoint,
        correlationId: extractCorrelationIdFromError(error)
      });

      throw error;
    }
  }
}
```

---

## Troubleshooting

### Q: Correlation ID not appearing in logs
**A:** Make sure `createContextMiddleware()` is added before your route handlers in the Express setup.

### Q: Getting "no parent context exists" error
**A:** You're trying to create a child context outside of a parent context. Ensure you're within a `CorrelationContext.run()` or `CorrelationContext.runAsync()` scope.

### Q: Correlation IDs changing between logs in same request
**A:** Different correlation IDs indicate different contexts. This is normal if you're creating child contexts. Check the `parentId` field to see the relationship.

### Q: Performance impact from logging
**A:** Overhead is minimal (~0.5ms per log call). If you're concerned, adjust `LOG_LEVEL` environment variable to reduce log volume.

---

## Environment Variables

No special environment variables required. The system works with existing configuration:

- `LOG_LEVEL` - Controls logging verbosity (inherited from winston logger)
- `NODE_ENV` - Determines log format (inherited from winston logger)

---

## Next Steps

1. **For New Code:** Use `LoggingContext` for all logging instead of direct logger calls
2. **For Existing Code:** Gradually migrate logging to `LoggingContext` when touching those files
3. **For Debugging:** Search logs by correlation ID to trace entire request flow
4. **For Monitoring:** Set up dashboards to visualize requests by correlation ID

---

## Support & Documentation

- Full implementation details: `PHASE3_WEEK9_IMPLEMENTATION.md`
- Architecture & code: `src/core/logging/README.ts`
- Test examples: `tests/unit/logging-context.test.ts`
- Source code: `src/core/logging/`

**Version:** 1.0.0  
**Status:** Production Ready ✅  
**Last Updated:** March 16, 2026
