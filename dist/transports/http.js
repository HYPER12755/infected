import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import logger from '../core/logger.js';
const SESSION_HEADER = 'mcp-session-id';
const SESSION_QUERY = 'sessionId';
function extractSessionId(req) {
    const header = normalizeHeaderValue(req.headers[SESSION_HEADER]);
    if (header) {
        return header;
    }
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
    const bodySessionId = req.body?.params?.sessionId;
    if (typeof bodySessionId === 'string' && bodySessionId.trim().length > 0) {
        return bodySessionId.trim();
    }
    return undefined;
}
function respondJsonRpcError(res, status, code, message, requestId) {
    res.status(status).json({
        jsonrpc: '2.0',
        error: { code, message },
        id: typeof requestId === 'number' || typeof requestId === 'string' ? requestId : null,
    });
}
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
function clientSnapshotFromRequest(req) {
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
function recordSessionActivity(sessionMetadata, sessionId, req, clientInfo) {
    const existing = sessionMetadata.get(sessionId);
    const now = new Date().toISOString();
    sessionMetadata.set(sessionId, {
        ...(existing ?? {
            ip: req.ip ?? 'unknown',
            createdAt: now,
        }),
        ip: req.ip ?? existing?.ip ?? 'unknown',
        userAgent: normalizeHeaderValue(req.headers['user-agent']) ?? existing?.userAgent,
        host: normalizeHeaderValue(req.headers['host']) ?? existing?.host,
        origin: normalizeHeaderValue(req.headers['origin']) ?? existing?.origin,
        apiKey: maskApiKey(normalizeHeaderValue(req.headers['x-api-key'])) ?? existing?.apiKey,
        lastRequestAt: now,
        clientName: clientInfo?.clientName ?? existing?.clientName,
        clientTitle: clientInfo?.clientTitle ?? existing?.clientTitle,
        clientVersion: clientInfo?.clientVersion ?? existing?.clientVersion,
        clientDescription: clientInfo?.clientDescription ?? existing?.clientDescription,
        websiteUrl: clientInfo?.websiteUrl ?? existing?.websiteUrl,
    });
}
export function httpStreamTransportFactory(mcpServer) {
    const router = express.Router();
    const transportMap = {};
    const sessionMetadata = new Map();
    let sharedTransport;
    let connectionPromise = null;
    const pendingMetadata = [];
    // Mutex to serialize client initializations
    let initializationLock = false;
    const initializationQueue = [];
    const waitForInitializationLock = () => {
        return new Promise((resolve) => {
            if (!initializationLock) {
                initializationLock = true;
                resolve();
                return;
            }
            initializationQueue.push(resolve);
        });
    };
    const releaseInitializationLock = () => {
        initializationLock = false;
        const next = initializationQueue.shift();
        if (next) {
            initializationLock = true;
            next();
        }
    };
    const createNewTransport = () => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
                transportMap[sessionId] = transport;
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
            }
            catch (error) {
                if (sharedTransport === transport) {
                    sharedTransport = undefined;
                }
                throw error;
            }
        })();
        connectionPromise = currentPromise;
        try {
            await currentPromise;
        }
        finally {
            if (connectionPromise === currentPromise) {
                connectionPromise = null;
            }
        }
        return transport;
    };
    // Track if the server has been initialized
    let serverInitialized = false;
    // Note: We use a shared transport for the MCP server connection,
    // but each client session gets its own sessionId for tracking.
    // The StreamableHTTPServerTransport handles session multiplexing internally.
    const initializeTransport = async (req) => {
        const clientInfo = clientSnapshotFromRequest(req);
        const metadataMethod = req.method ?? 'POST';
        const metadataPath = req.path ?? (typeof req.url === 'string' ? req.url : '/');
        const metadata = {
            ip: req.ip ?? 'unknown',
            userAgent: normalizeHeaderValue(req.headers['user-agent']),
            host: normalizeHeaderValue(req.headers['host']),
            origin: normalizeHeaderValue(req.headers['origin']),
            apiKey: maskApiKey(normalizeHeaderValue(req.headers['x-api-key'])),
            createdAt: new Date().toISOString(),
            method: metadataMethod,
            path: metadataPath,
            ...clientInfo,
        };
        pendingMetadata.push(metadata);
        const transport = await ensureTransportConnected();
        return { transport, metadataSnapshot: metadata };
    };
    const handleMcpPost = async (req, res) => {
        const requestedSession = extractSessionId(req);
        const isInitialization = !requestedSession && isInitializeRequest(req.body);
        // For existing sessions, use the session-specific transport
        let transport = requestedSession ? transportMap[requestedSession] : undefined;
        let currentSessionId = requestedSession;
        if (!transport && isInitialization) {
            // Wait for the initialization lock to serialize client connections
            await waitForInitializationLock();
            try {
                // Check if server was already initialized while waiting
                if (serverInitialized && sharedTransport) {
                    // Server already initialized, use the shared transport
                    // The client will get its own session ID via response headers
                    transport = sharedTransport;
                    currentSessionId = transport.sessionId;
                }
                else {
                    // First initialization - connect the transport
                    transport = await ensureTransportConnected();
                    serverInitialized = true;
                    if (transport.sessionId) {
                        transportMap[transport.sessionId] = transport;
                        currentSessionId = transport.sessionId;
                        const clientInfo = clientSnapshotFromRequest(req);
                        const metadata = {
                            ip: req.ip ?? 'unknown',
                            userAgent: normalizeHeaderValue(req.headers['user-agent']),
                            host: normalizeHeaderValue(req.headers['host']),
                            origin: normalizeHeaderValue(req.headers['origin']),
                            apiKey: maskApiKey(normalizeHeaderValue(req.headers['x-api-key'])),
                            createdAt: new Date().toISOString(),
                            method: req.method ?? 'POST',
                            path: req.path ?? '/mcp',
                            ...clientInfo,
                        };
                        sessionMetadata.set(transport.sessionId, metadata);
                        logger.info('New MCP client session registered', {
                            component: 'http-transport',
                            sessionId: transport.sessionId,
                            ...metadata,
                        });
                    }
                }
            }
            finally {
                releaseInitializationLock();
            }
        }
        if (!transport) {
            if (requestedSession) {
                respondJsonRpcError(res, 404, -32001, 'Session not found', req.body?.id);
            }
            else {
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
        }
        catch (error) {
            // Handle the "Server already initialized" error gracefully
            // This can happen when multiple clients try to initialize concurrently
            if (error?.message?.includes('Server already initialized') ||
                error?.message?.includes('Already connected to a transport')) {
                logger.warn('Concurrent initialization attempt detected', {
                    component: 'http-transport',
                    sessionId: currentSessionId,
                    clientInfo: clientSnapshotFromRequest(req),
                });
                // Return the existing session ID to the client
                res.setHeader('Mcp-Session-Id', transport.sessionId || 'shared');
                res.status(200).json({
                    jsonrpc: '2.0',
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        serverInfo: { name: 'infected', version: '1.0.0' }
                    },
                    id: req.body?.id
                });
                return;
            }
            logger.error('Failed handling HTTP MCP request', { error });
            if (!res.headersSent) {
                respondJsonRpcError(res, 500, -32603, `Internal error: ${error.message}`, req.body?.id);
            }
        }
    };
    const handleSessionRequest = async (req, res) => {
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
        }
        catch (error) {
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
