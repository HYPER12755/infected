import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import logger from '../core/logger.js';
const SESSION_QUERY = 'sessionId';
function maskApiKey(key) {
    if (!key)
        return undefined;
    if (key.length <= 8)
        return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
function normalizeHeaderValue(value) {
    if (Array.isArray(value)) {
        for (const candidate of value) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }
        return undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return undefined;
}
function extractSessionId(req) {
    const queryValue = req.query[SESSION_QUERY];
    if (typeof queryValue === 'string' && queryValue.trim().length > 0) {
        return queryValue.trim();
    }
    if (Array.isArray(queryValue)) {
        for (const candidate of queryValue) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }
    }
    const headerValue = req.headers['mcp-session-id'];
    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
        return headerValue.trim();
    }
    if (Array.isArray(headerValue)) {
        for (const candidate of headerValue) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }
    }
    return undefined;
}
export function SSETransportFactory(mcpServer) {
    const transportMap = new Map();
    const sessionMetadata = new Map();
    const router = express.Router();
    let sseConnected = false;
    let sseConnectPromise = null;
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
            ip: req.ip ?? 'unknown',
            userAgent: normalizeHeaderValue(req.headers['user-agent']),
            host: normalizeHeaderValue(req.headers['host']),
            origin: normalizeHeaderValue(req.headers['origin']),
            apiKey: maskApiKey(normalizeHeaderValue(req.headers['x-api-key'])),
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
            sseConnected = false;
            sseConnectPromise = null;
        };
        logger.info('New SSE connection established', {
            component: 'sse-transport',
            sessionId: transport.sessionId,
            ip: req.ip ?? 'unknown',
            userAgent: normalizeHeaderValue(req.headers['user-agent']),
            host: normalizeHeaderValue(req.headers['host']),
        });
        if (!sseConnected) {
            if (!sseConnectPromise) {
                const currentPromise = (async () => {
                    await mcpServer.connect(transport);
                    sseConnected = true;
                })();
                sseConnectPromise = currentPromise;
                try {
                    await currentPromise;
                }
                finally {
                    if (sseConnectPromise === currentPromise) {
                        sseConnectPromise = null;
                    }
                }
            }
            else {
                await sseConnectPromise;
            }
        }
    });
    router.post('/sse', async (req, res) => {
        const sessionId = extractSessionId(req);
        if (!sessionId || !transportMap.has(sessionId)) {
            logger.error('Streamable HTTP POST received without valid sessionId', {
                component: 'sse-transport',
                sessionId,
            });
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32600,
                    message: 'Invalid or missing sessionId',
                },
                id: null,
            });
            return;
        }
        const transport = transportMap.get(sessionId);
        try {
            await transport.handlePostMessage(req, res, req.body);
        }
        catch (error) {
            logger.error('Failed to dispatch Streamable HTTP request via SSE transport', {
                component: 'sse-transport',
                sessionId,
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error',
                },
                id: null,
            });
        }
    });
    router.post('/messages', async (req, res) => {
        const sessionId = extractSessionId(req);
        if (!sessionId || !transportMap.has(sessionId)) {
            logger.error('Message received without valid sessionId', { component: 'sse-transport' });
            res.status(400).json({ error: 'Invalid or missing sessionId' });
            return;
        }
        const transport = transportMap.get(sessionId);
        const meta = sessionMetadata.get(sessionId);
        if (meta) {
            sessionMetadata.set(sessionId, {
                ...meta,
                lastRequestAt: new Date().toISOString(),
            });
        }
        try {
            await transport.handlePostMessage(req, res, req.body);
        }
        catch (error) {
            logger.error('Failed to handle SSE post message', { component: 'sse-transport', error });
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return { sseTransportMap: transportMap, sseRouter: router };
}
