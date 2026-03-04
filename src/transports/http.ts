import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import logger from '../core/logger.js';

const SESSION_HEADER = 'mcp-session-id';
const SESSION_QUERY = 'sessionId';

interface SessionMetadata {
  ip: string;
  userAgent?: string;
  host?: string;
  origin?: string;
  apiKey?: string;
  createdAt: string;
  method?: string;
  path?: string;
  lastRequestAt?: string;
  clientName?: string;
  clientVersion?: string;
  clientTitle?: string;
  clientDescription?: string;
  websiteUrl?: string;
}

type ClientInfoSnapshot = Pick<SessionMetadata, 'clientName' | 'clientTitle' | 'clientVersion' | 'clientDescription' | 'websiteUrl'>;

function extractSessionId(req: express.Request): string | undefined {
  const header = req.headers[SESSION_HEADER];
  if (Array.isArray(header) && header.length > 0) {
    return header[0];
  }
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }

  const queryValue = req.query[SESSION_QUERY];
  if (typeof queryValue === 'string' && queryValue.trim().length > 0) {
    return queryValue.trim();
  }
  if (Array.isArray(queryValue) && queryValue.length > 0) {
    return queryValue[0].trim();
  }

  const bodySessionId = req.body?.params?.sessionId;
  if (typeof bodySessionId === 'string' && bodySessionId.trim().length > 0) {
    return bodySessionId.trim();
  }
  return undefined;
}

function respondJsonRpcError(
  res: express.Response,
  status: number,
  code: number,
  message: string,
  requestId?: unknown
): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: typeof requestId === 'number' || typeof requestId === 'string' ? requestId : null,
  });
}

function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function clientSnapshotFromRequest(req: express.Request): ClientInfoSnapshot {
  const metadata = req.body?.params?.clientInfo;
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  const { name, title, version, description, websiteUrl } = metadata;
  return {
    clientName: typeof name === 'string' ? name : undefined,
    clientTitle: typeof title === 'string' ? title : undefined,
    clientVersion: typeof version === 'string' ? version : undefined,
    clientDescription: typeof description === 'string' ? description : undefined,
    websiteUrl: typeof websiteUrl === 'string' ? websiteUrl : undefined,
  };
}

function recordSessionActivity(
  sessionMetadata: Map<string, SessionMetadata>,
  sessionId: string,
  req: express.Request,
  clientInfo?: ClientInfoSnapshot
) {
  const existing = sessionMetadata.get(sessionId);
  const now = new Date().toISOString();
  sessionMetadata.set(sessionId, {
    ...(existing ?? {
      ip: req.ip,
      createdAt: now,
    }),
    ip: req.ip || existing?.ip || 'unknown',
    userAgent: (req.headers['user-agent'] as string | undefined) ?? existing?.userAgent,
    host: (req.headers['host'] as string | undefined) ?? existing?.host,
    origin: (req.headers['origin'] as string | undefined) ?? existing?.origin,
    apiKey: maskApiKey(req.headers['x-api-key'] as string | undefined) ?? existing?.apiKey,
    lastRequestAt: now,
    clientName: clientInfo?.clientName ?? existing?.clientName,
    clientTitle: clientInfo?.clientTitle ?? existing?.clientTitle,
    clientVersion: clientInfo?.clientVersion ?? existing?.clientVersion,
    clientDescription: clientInfo?.clientDescription ?? existing?.clientDescription,
    websiteUrl: clientInfo?.websiteUrl ?? existing?.websiteUrl,
  });
}

export function httpStreamTransportFactory(mcpServer: McpServer) {
  const router = express.Router();
  const transportMap: Record<string, StreamableHTTPServerTransport> = {};
  const sessionMetadata = new Map<string, SessionMetadata>();
  let sharedTransport: StreamableHTTPServerTransport | undefined;
  let connectionPromise: Promise<void> | null = null;
  const pendingMetadata: SessionMetadata[] = [];

  const createNewTransport = () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        transportMap[sessionId] = transport!;
        const baseMetadata = pendingMetadata.shift() ?? {
          ip: 'unknown',
          createdAt: new Date().toISOString(),
        };
        sessionMetadata.set(sessionId, baseMetadata);
        logger.info('MCP http session initialized', {
          component: 'http-transport',
          sessionId,
          ...baseMetadata,
        });
      },
    });

    transport.onclose = () => {
      const closingIds = Object.keys(transportMap).filter((id) => transportMap[id] === transport);
      closingIds.forEach((sessionId) => {
        const meta = sessionMetadata.get(sessionId);
        logger.info('MCP http session closed', {
          component: 'http-transport',
          sessionId,
          closedAt: new Date().toISOString(),
          ...meta,
        });
        delete transportMap[sessionId];
        sessionMetadata.delete(sessionId);
      });
      if (sharedTransport === transport) {
        sharedTransport = undefined;
      }
    };

    return transport;
  };

  const ensureTransportConnected = async () => {
    if (sharedTransport) {
      if (connectionPromise) {
        await connectionPromise;
      }
      return sharedTransport;
    }

    const transport = createNewTransport();
    sharedTransport = transport;

    const currentPromise = (async () => {
      try {
        await mcpServer.connect(transport);
      } catch (error) {
        if (sharedTransport === transport) {
          sharedTransport = undefined;
        }
        throw error;
      }
    })();

    connectionPromise = currentPromise;

    try {
      await currentPromise;
    } finally {
      if (connectionPromise === currentPromise) {
        connectionPromise = null;
      }
    }

    return transport;
  };

  const initializeTransport = async (req: express.Request): Promise<{
    transport: StreamableHTTPServerTransport;
    metadataSnapshot: SessionMetadata;
  }> => {
    const clientInfo = clientSnapshotFromRequest(req);
    const metadataMethod = req.method ?? 'POST';
    const metadataPath = req.path ?? (typeof req.url === 'string' ? req.url : '/');
    const metadata: SessionMetadata = {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      host: req.headers['host'] as string | undefined,
      origin: req.headers['origin'] as string | undefined,
      apiKey: maskApiKey(req.headers['x-api-key'] as string | undefined),
      createdAt: new Date().toISOString(),
      method: metadataMethod,
      path: metadataPath,
      ...clientInfo,
    };
    pendingMetadata.push(metadata);

    const transport = await ensureTransportConnected();
    return { transport, metadataSnapshot: metadata };
  };

  const handleMcpPost = async (req: express.Request, res: express.Response) => {
    const requestedSession = extractSessionId(req);
    const isInitialization = !requestedSession && isInitializeRequest(req.body);
    let transport = requestedSession ? transportMap[requestedSession] : undefined;
    let currentSessionId = requestedSession;

    if (!transport && isInitialization) {
      ({ transport } = await initializeTransport(req));
    }

    if (!transport) {
      if (requestedSession) {
        respondJsonRpcError(res, 404, -32001, 'Session not found', req.body?.id);
      } else {
        respondJsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required', req.body?.id);
      }
      return;
    }

    if (!currentSessionId && transport.sessionId) {
      currentSessionId = transport.sessionId;
    }
    if (currentSessionId) {
      recordSessionActivity(sessionMetadata, currentSessionId, req, clientSnapshotFromRequest(req));
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Failed handling HTTP MCP request', { error });
      if (!res.headersSent) {
        respondJsonRpcError(res, 500, -32603, `Internal error: ${(error as Error).message}`, req.body?.id);
      }
    }
  };

  const handleSessionRequest = async (req: express.Request, res: express.Response) => {
    const sessionId = extractSessionId(req);
    if (!sessionId || !transportMap[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    recordSessionActivity(sessionMetadata, sessionId, req, clientSnapshotFromRequest(req));
    logger.debug('HTTP MCP request received', {
      component: 'http-transport',
      sessionId,
      method: req.method,
      path: req.path,
      ...sessionMetadata.get(sessionId),
    });

    const transport = transportMap[sessionId];
    if (req.body?.method === 'logging/setLevel') {
      logger.info('Setting logging level', {
        level: req.body?.params?.level,
        component: 'http-transport',
      });
      res.status(200).json({});
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error('Failed handling HTTP MCP request', { error });
      if (!res.headersSent) {
        res.status(500).send('Internal server error');
      }
    }
  };

  router.post('/mcp', handleMcpPost);
  router.get('/mcp', handleSessionRequest);
  router.delete('/mcp', handleSessionRequest);

  return {
    httpStreamTransportMap: transportMap,
    httpStreamRouter: router,
  };
}
