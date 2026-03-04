import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import logger from '../core/logger.js';

const SESSION_QUERY = 'sessionId';

interface SessionMetadata {
  ip: string;
  userAgent?: string;
  host?: string;
  origin?: string;
  apiKey?: string;
  createdAt: string;
  lastRequestAt?: string;
}

function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function extractSessionId(req: express.Request): string | undefined {
  const queryValue = req.query[SESSION_QUERY];
  if (typeof queryValue === 'string' && queryValue.trim().length > 0) {
    return queryValue.trim();
  }
  if (Array.isArray(queryValue) && queryValue.length > 0) {
    return queryValue[0].trim();
  }
  const headerValue = req.headers['mcp-session-id'];
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  return undefined;
}

export function SSETransportFactory(mcpServer: McpServer) {
  const transportMap = new Map<string, SSEServerTransport>();
  const sessionMetadata = new Map<string, SessionMetadata>();
  const router = express.Router();

  router.get('/sse', async (req, res) => {
    const requestedSession = extractSessionId(req);
    if (requestedSession && transportMap.has(requestedSession)) {
      logger.warn('SSE session already exists, refusing duplicate', {
        component: 'sse-transport',
        sessionId: requestedSession,
      });
      res.status(409).json({ error: 'Session already exists' });
      return;
    }

    const transport = new SSEServerTransport('/messages', res);
    transportMap.set(transport.sessionId, transport);
    sessionMetadata.set(transport.sessionId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      host: req.headers['host'] as string | undefined,
      origin: req.headers['origin'] as string | undefined,
      apiKey: maskApiKey(req.headers['x-api-key'] as string | undefined),
      createdAt: new Date().toISOString(),
    });

    transport.onclose = () => {
      const meta = sessionMetadata.get(transport.sessionId);
      logger.info('SSE session closed', {
        component: 'sse-transport',
        sessionId: transport.sessionId,
        closedAt: new Date().toISOString(),
        ...meta,
      });
      sessionMetadata.delete(transport.sessionId);
      transportMap.delete(transport.sessionId);
    };

    logger.info('New SSE connection established', {
      component: 'sse-transport',
      sessionId: transport.sessionId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      host: req.headers['host'],
    });

    await mcpServer.connect(transport);
  });

  router.post('/messages', async (req, res) => {
    const sessionId = extractSessionId(req);
    if (!sessionId || !transportMap.has(sessionId)) {
      logger.error('Message received without valid sessionId', { component: 'sse-transport' });
      res.status(400).json({ error: 'Invalid or missing sessionId' });
      return;
    }

    const transport = transportMap.get(sessionId)!;
    const meta = sessionMetadata.get(sessionId);
    if (meta) {
      sessionMetadata.set(sessionId, {
        ...meta,
        lastRequestAt: new Date().toISOString(),
      });
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      logger.error('Failed to handle SSE post message', { component: 'sse-transport', error });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return { sseTransportMap: transportMap, sseRouter: router };
}
