import { randomUUID } from 'node:crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import logger from '../core/logger.js';
// Custom WebSocket Transport for MCP that implements the Transport interface
class WebSocketMcpTransport {
    // Public getter for onmessage to check if it's set
    get hasOnmessage() {
        return !!this._onmessage;
    }
    constructor(sessionId, ws) {
        this._connected = false;
        this.sessionId = sessionId;
        this.ws = ws;
        // Set up WebSocket message handler
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                logger.info('WebSocket message received from client', {
                    component: 'websocket-transport',
                    sessionId,
                    method: message.method,
                    id: message.id,
                    hasOnMessage: !!this._onmessage
                });
                // Forward message to MCP server via onmessage handler
                if (this._onmessage) {
                    logger.debug('Forwarding message to MCP server', {
                        component: 'websocket-transport',
                        sessionId,
                        id: message.id
                    });
                    this._onmessage(message);
                }
                else {
                    logger.warn('No onmessage handler set - message dropped', {
                        component: 'websocket-transport',
                        sessionId,
                        id: message.id
                    });
                }
            }
            catch (error) {
                logger.error('Failed to parse WebSocket message', {
                    component: 'websocket-transport',
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
        ws.on('close', () => {
            this._connected = false;
            logger.info('WebSocket connection closed', {
                component: 'websocket-transport',
                sessionId
            });
            if (this._onclose) {
                this._onclose();
            }
        });
        ws.on('error', (error) => {
            logger.error('WebSocket error', {
                component: 'websocket-transport',
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            if (this._onerror) {
                this._onerror(error);
            }
        });
        this._connected = true;
        logger.debug('WebSocketMcpTransport constructed', {
            component: 'websocket-transport',
            sessionId
        });
    }
    async start() {
        logger.info('WebSocket transport started', {
            component: 'websocket-transport',
            sessionId: this.sessionId
        });
    }
    async send(message, _options) {
        return new Promise((resolve, reject) => {
            if (this.ws.readyState === WebSocket.OPEN) {
                const data = JSON.stringify(message);
                logger.debug('WebSocket sending message', {
                    component: 'websocket-transport',
                    sessionId: this.sessionId,
                    id: message.id,
                    method: message.method,
                    hasError: !!message.error,
                    hasResult: !!message.result
                });
                this.ws.send(data, (err) => {
                    if (err) {
                        logger.error('WebSocket send error', {
                            component: 'websocket-transport',
                            sessionId: this.sessionId,
                            error: err.message
                        });
                        reject(err);
                    }
                    else {
                        resolve();
                    }
                });
            }
            else {
                const err = new Error('WebSocket not connected');
                logger.error('WebSocket not connected', {
                    component: 'websocket-transport',
                    sessionId: this.sessionId,
                    readyState: this.ws.readyState
                });
                reject(err);
            }
        });
    }
    async close() {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
        this._connected = false;
    }
    isConnected() {
        return this._connected && this.ws.readyState === WebSocket.OPEN;
    }
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
export function websocketTransportFactory(mcpServer) {
    const sessions = new Map();
    let wss = null;
    let httpServer = null;
    const router = express.Router();
    router.get('/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            transport: 'websocket',
            sessions: sessions.size,
            uptime: process.uptime()
        });
    });
    router.get('/sessions', (req, res) => {
        const sessionList = Array.from(sessions.values()).map(s => ({
            id: s.info.id,
            ip: s.info.ip,
            userAgent: s.info.userAgent,
            createdAt: s.info.createdAt,
            lastActivityAt: s.info.lastActivityAt
        }));
        res.status(200).json({ sessions: sessionList });
    });
    const initializeWebSocket = (port) => {
        return new Promise((resolve, reject) => {
            try {
                httpServer = createServer();
                wss = new WebSocketServer({ server: httpServer });
                wss.on('connection', async (ws, req) => {
                    const sessionId = randomUUID();
                    const ip = req.socket.remoteAddress || 'unknown';
                    const userAgent = normalizeHeaderValue(req.headers['user-agent']);
                    const origin = normalizeHeaderValue(req.headers['origin']);
                    logger.info('New WebSocket connection', {
                        component: 'websocket-transport',
                        sessionId,
                        ip,
                        origin
                    });
                    const transport = new WebSocketMcpTransport(sessionId, ws);
                    const sessionInfo = {
                        id: sessionId,
                        ws,
                        transport,
                        ip,
                        userAgent,
                        origin,
                        createdAt: new Date().toISOString(),
                        lastActivityAt: new Date().toISOString()
                    };
                    sessions.set(sessionId, { info: sessionInfo, transport });
                    // Set up session cleanup
                    transport.onclose = () => {
                        sessions.delete(sessionId);
                        logger.info('WebSocket MCP session closed', {
                            component: 'websocket-transport',
                            sessionId
                        });
                    };
                    transport.onerror = (error) => {
                        logger.error('WebSocket transport error', {
                            component: 'websocket-transport',
                            sessionId,
                            error: error.message
                        });
                    };
                    // Start the transport first
                    await transport.start();
                    // Connect transport to MCP server
                    // This sets up the MCP protocol handler which will set transport._onmessage
                    try {
                        await mcpServer.connect(transport);
                        logger.info('WebSocket MCP session connected to server', {
                            component: 'websocket-transport',
                            sessionId,
                            ip,
                            userAgent,
                            onmessageSet: transport.hasOnmessage
                        });
                    }
                    catch (error) {
                        logger.error('Failed to connect WebSocket to MCP server', {
                            component: 'websocket-transport',
                            sessionId,
                            error: error instanceof Error ? error.message : String(error)
                        });
                        ws.send(JSON.stringify({
                            jsonrpc: '2.0',
                            error: { code: -32603, message: 'Failed to initialize MCP session' }
                        }));
                        ws.close();
                        return;
                    }
                    // Wait a bit for MCP server to set up its message handlers
                    await new Promise(resolve => setTimeout(resolve, 100));
                    logger.info('Checking onmessage handler after connection', {
                        component: 'websocket-transport',
                        sessionId,
                        onmessageSet: transport.hasOnmessage
                    });
                    // Send initialized notification to client
                    ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'notifications/initialized',
                        params: { sessionId }
                    }));
                    logger.info('WebSocket session ready', {
                        component: 'websocket-transport',
                        sessionId
                    });
                });
                wss.on('error', (error) => {
                    logger.error('WebSocket server error', {
                        component: 'websocket-transport',
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
                httpServer.listen(port, () => {
                    logger.info(`WebSocket server listening on port ${port}`, {
                        component: 'websocket-transport'
                    });
                    resolve();
                });
                httpServer.on('error', (error) => {
                    logger.error('HTTP server error', {
                        component: 'websocket-transport',
                        error: error instanceof Error ? error.message : String(error)
                    });
                    reject(error);
                });
            }
            catch (error) {
                logger.error('Failed to initialize WebSocket transport', {
                    component: 'websocket-transport',
                    error: error instanceof Error ? error.message : String(error)
                });
                reject(error);
            }
        });
    };
    const closeAllSessions = async () => {
        for (const { transport } of sessions.values()) {
            try {
                await transport.close();
            }
            catch {
                // Ignore cleanup errors
            }
        }
        sessions.clear();
    };
    return {
        router,
        initializeWebSocket,
        closeAllSessions
    };
}
