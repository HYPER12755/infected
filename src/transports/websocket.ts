import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import logger from '../core/logger.js';

// Define JSON-RPC message type locally
interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface SessionInfo {
  id: string;
  ws: WebSocket;
  transport: WebSocketMcpTransport;
  ip: string;
  userAgent?: string;
  origin?: string;
  createdAt: string;
  lastActivityAt: string;
}

// Custom WebSocket Transport for MCP that implements the Transport interface
class WebSocketMcpTransport implements Transport {
  public sessionId: string;
  public setProtocolVersion?: (version: string) => void;
  
  private ws: WebSocket;
  private _onclose?: () => void;
  private _onerror?: (error: Error) => void;
  private _onmessage?: (message: JsonRpcMessage) => void;
  private _connected = false;

  constructor(sessionId: string, ws: WebSocket) {
    this.sessionId = sessionId;
    this.ws = ws;
    
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as JsonRpcMessage;
        if (this._onmessage) {
          this._onmessage(message);
        }
      } catch (error) {
        logger.error('Failed to parse WebSocket message', {
          component: 'websocket-transport',
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    ws.on('close', () => {
      this._connected = false;
      if (this._onclose) {
        this._onclose();
      }
    });

    ws.on('error', (error) => {
      if (this._onerror) {
        this._onerror(error);
      }
    });

    this._connected = true;
  }

  async start(): Promise<void> {
    // Already started when constructed
  }

  async send(message: JsonRpcMessage, _options?: TransportSendOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message), (err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        reject(new Error('WebSocket not connected'));
      }
    });
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this._connected = false;
  }

  onclose: (() => void) | undefined;

  onerror: ((error: Error) => void) | undefined;

  onmessage: ((message: JsonRpcMessage) => void) | undefined;

  isConnected(): boolean {
    return this._connected && this.ws.readyState === WebSocket.OPEN;
  }
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
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

export function websocketTransportFactory(mcpServer: McpServer) {
  const sessions = new Map<string, { info: SessionInfo; transport: WebSocketMcpTransport }>();
  let wss: WebSocketServer | null = null;
  let httpServer: ReturnType<typeof createServer> | null = null;

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

  const initializeWebSocket = (port: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        httpServer = createServer();
        wss = new WebSocketServer({ server: httpServer });

        wss.on('connection', async (ws, req) => {
          const sessionId = randomUUID();
          const ip = req.socket.remoteAddress || 'unknown';
          const userAgent = normalizeHeaderValue(req.headers['user-agent']);
          const origin = normalizeHeaderValue(req.headers['origin']);
          
          const transport = new WebSocketMcpTransport(sessionId, ws);
          
          const sessionInfo: SessionInfo = {
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
          
          // Connect transport to MCP server
          try {
            await mcpServer.connect(transport);
            logger.info('WebSocket MCP session connected', {
              component: 'websocket-transport',
              sessionId,
              ip,
              userAgent
            });
          } catch (error) {
            logger.error('Failed to connect WebSocket to MCP server', {
              component: 'websocket-transport',
              sessionId,
              error: error instanceof Error ? error.message : String(error)
            });
            ws.send(JSON.stringify({
              jsonrpc: '2.0' as const,
              error: { code: -32603, message: 'Failed to initialize MCP session' }
            }));
            ws.close();
            return;
          }

          // Send initialized notification
          ws.send(JSON.stringify({
            jsonrpc: '2.0' as const,
            method: 'notifications/initialized',
            params: { sessionId }
          }));

          // Set up message handler from MCP server
          transport.onmessage = async (message: JsonRpcMessage) => {
            try {
              sessionInfo.lastActivityAt = new Date().toISOString();
              
              // Handle batch messages
              if (Array.isArray(message)) {
                for (const msg of message) {
                  await processMessage(msg, transport, sessionId);
                }
              } else {
                await processMessage(message, transport, sessionId);
              }
              
            } catch (error) {
              logger.error('Error processing WebSocket message', {
                component: 'websocket-transport',
                sessionId,
                error: error instanceof Error ? error.message : String(error)
              });
              
              ws.send(JSON.stringify({
                jsonrpc: '2.0' as const,
                error: { code: -32603, message: 'Internal error' }
              }));
            }
          };

          transport.onclose = () => {
            sessions.delete(sessionId);
            logger.info('WebSocket MCP session closed', {
              component: 'websocket-transport',
              sessionId
            });
          };

          transport.onerror = (error: Error) => {
            logger.error('WebSocket transport error', {
              component: 'websocket-transport',
              sessionId,
              error: error.message
            });
          };
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

      } catch (error) {
        logger.error('Failed to initialize WebSocket transport', {
          component: 'websocket-transport',
          error: error instanceof Error ? error.message : String(error)
        });
        reject(error);
      }
    });
  };

  // Process individual JSON-RPC message
  const processMessage = async (
    msg: JsonRpcMessage, 
    transport: WebSocketMcpTransport,
    sessionId: string
  ): Promise<void> => {
    // For JSON-RPC notifications (no id), handle via MCP server notification
    if (!('id' in msg) || msg.id === undefined) {
      if (msg.method) {
        await mcpServer.server.notification({
          method: msg.method,
          params: msg.params || {}
        });
      }
      return;
    }
    
    // For requests with id, process through MCP server
    try {
      // Cast to any to work around type complexity
      const result = await (mcpServer.server as any).request(
        { method: msg.method || '', params: msg.params || {} },
        null,
        { id: msg.id }
      );
      
      // Send response
      await transport.send({
        jsonrpc: '2.0',
        id: msg.id,
        result
      });
    } catch (error) {
      // MCP server threw an error - format as JSON-RPC error
      const errorMessage = error instanceof Error ? error.message : String(error);
      await transport.send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { 
          code: -32603, 
          message: 'Internal error',
          data: errorMessage
        }
      });
    }
  };

  const closeAllSessions = async (): Promise<void> => {
    for (const { transport } of sessions.values()) {
      try {
        await transport.close();
      } catch {
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
