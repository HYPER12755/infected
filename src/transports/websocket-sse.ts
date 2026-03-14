/**
 * WebSocket Transport for Real-Time Streaming
 * Provides bidirectional streaming over WebSocket protocol
 */

import { EventEmitter } from 'node:events';
import logger from '../core/logger.js';

export interface StreamMessage {
  type: 'output' | 'error' | 'complete' | 'heartbeat' | 'subscribe' | 'unsubscribe';
  executionId: string;
  data?: string | Record<string, unknown>;
  timestamp: number;
  isStderr?: boolean;
  exitCode?: number;
  duration?: number;
}

export interface StreamSubscription {
  executionId: string;
  clientId: string;
  subscribedAt: number;
  ws?: any; // WebSocket connection
}

/**
 * WebSocket Transport Handler
 */
export class WebSocketTransport extends EventEmitter {
  private subscriptions = new Map<string, Set<StreamSubscription>>();
  private clients = new Map<string, WebSocket>();
  private heartbeatInterval = 30000; // 30 seconds
  private heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    super();
    logger.debug('WebSocketTransport initialized');
  }

  /**
   * Register a WebSocket client
   */
  registerClient(clientId: string, ws: any): void {
    this.clients.set(clientId, ws);

    // Setup event listeners
    ws.on('message', (message: string) => {
      this.handleMessage(clientId, message);
    });

    ws.on('close', () => {
      this.handleClientDisconnect(clientId);
    });

    ws.on('error', (error: Error) => {
      logger.error('WebSocket error', { clientId, error: error.message });
      this.handleClientDisconnect(clientId);
    });

    // Start heartbeat
    this.startHeartbeat(clientId);

    logger.info('WebSocket client registered', { clientId });
  }

  /**
   * Subscribe client to stream
   */
  subscribeToStream(executionId: string, clientId: string): boolean {
    const ws = this.clients.get(clientId);
    if (!ws) {
      logger.warn('Subscribe: client not found', { clientId, executionId });
      return false;
    }

    if (!this.subscriptions.has(executionId)) {
      this.subscriptions.set(executionId, new Set());
    }

    const subscription: StreamSubscription = {
      executionId,
      clientId,
      subscribedAt: Date.now(),
      ws,
    };

    this.subscriptions.get(executionId)!.add(subscription);

    // Send subscription confirmation
    this.sendMessage(clientId, {
      type: 'subscribe',
      executionId,
      data: { status: 'subscribed' },
      timestamp: Date.now(),
    });

    logger.info('Client subscribed to stream', { executionId, clientId });
    return true;
  }

  /**
   * Unsubscribe client from stream
   */
  unsubscribeFromStream(executionId: string, clientId: string): void {
    const subscriptions = this.subscriptions.get(executionId);
    if (subscriptions) {
      subscriptions.forEach(sub => {
        if (sub.clientId === clientId) {
          subscriptions.delete(sub);
        }
      });

      if (subscriptions.size === 0) {
        this.subscriptions.delete(executionId);
      }
    }

    logger.info('Client unsubscribed from stream', { executionId, clientId });
  }

  /**
   * Broadcast stream output to all subscribers
   */
  broadcastOutput(executionId: string, data: string, isStderr = false): void {
    const subscriptions = this.subscriptions.get(executionId);
    if (!subscriptions) return;

    const message: StreamMessage = {
      type: 'output',
      executionId,
      data,
      isStderr,
      timestamp: Date.now(),
    };

    subscriptions.forEach(sub => {
      this.sendMessage(sub.clientId, message);
    });
  }

  /**
   * Broadcast stream error to all subscribers
   */
  broadcastError(executionId: string, error: string): void {
    const subscriptions = this.subscriptions.get(executionId);
    if (!subscriptions) return;

    const message: StreamMessage = {
      type: 'error',
      executionId,
      data: { error },
      timestamp: Date.now(),
    };

    subscriptions.forEach(sub => {
      this.sendMessage(sub.clientId, message);
    });
  }

  /**
   * Broadcast stream completion to all subscribers
   */
  broadcastComplete(executionId: string, exitCode?: number, duration?: number): void {
    const subscriptions = this.subscriptions.get(executionId);
    if (!subscriptions) return;

    const message: StreamMessage = {
      type: 'complete',
      executionId,
      exitCode,
      duration,
      timestamp: Date.now(),
    };

    subscriptions.forEach(sub => {
      this.sendMessage(sub.clientId, message);
    });

    // Clean up subscriptions for this execution
    this.subscriptions.delete(executionId);
  }

  /**
   * Send message to specific client
   */
  private sendMessage(clientId: string, message: StreamMessage): void {
    const ws = this.clients.get(clientId);
    if (!ws || ws.readyState !== 1) { // 1 = OPEN
      logger.warn('Cannot send message: client not connected', { clientId });
      return;
    }

    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Failed to send message', {
        clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle message from client
   */
  private handleMessage(clientId: string, rawMessage: string): void {
    try {
      const message = JSON.parse(rawMessage);

      if (message.type === 'subscribe') {
        this.subscribeToStream(message.executionId, clientId);
      } else if (message.type === 'unsubscribe') {
        this.unsubscribeFromStream(message.executionId, clientId);
      } else {
        this.emit('message', { clientId, message });
      }
    } catch (error) {
      logger.error('Failed to parse message', {
        clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle client disconnect
   */
  private handleClientDisconnect(clientId: string): void {
    this.clients.delete(clientId);

    // Clear heartbeat
    const timer = this.heartbeatTimers.get(clientId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(clientId);
    }

    // Unsubscribe from all streams
    this.subscriptions.forEach(subs => {
      subs.forEach(sub => {
        if (sub.clientId === clientId) {
          subs.delete(sub);
        }
      });
    });

    logger.info('WebSocket client disconnected', { clientId });
  }

  /**
   * Start heartbeat for client
   */
  private startHeartbeat(clientId: string): void {
    const timer = setInterval(() => {
      this.sendMessage(clientId, {
        type: 'heartbeat',
        executionId: '',
        timestamp: Date.now(),
      });
    }, this.heartbeatInterval);

    this.heartbeatTimers.set(clientId, timer);
  }

  /**
   * Get subscription status
   */
  getSubscriptionStatus(executionId: string): { subscribers: number; clients: string[] } {
    const subscriptions = this.subscriptions.get(executionId);
    if (!subscriptions) {
      return { subscribers: 0, clients: [] };
    }

    const clients = Array.from(subscriptions).map(s => s.clientId);
    return { subscribers: subscriptions.size, clients };
  }

  /**
   * Shutdown handler
   */
  async shutdown(): Promise<void> {
    logger.info('WebSocketTransport shutting down');

    // Clear heartbeats
    this.heartbeatTimers.forEach(timer => clearInterval(timer));
    this.heartbeatTimers.clear();

    // Close all client connections
    this.clients.forEach(ws => {
      try {
        ws.close();
      } catch (e) {
        // ignore
      }
    });
    this.clients.clear();
    this.subscriptions.clear();

    this.removeAllListeners();
  }
}

/**
 * Server-Sent Events (SSE) Transport - HTTP alternative to WebSocket
 */
export class SSETransport extends EventEmitter {
  private subscriptions = new Map<string, Set<string>>();
  private clients = new Map<string, any>();

  /**
   * Register SSE client
   */
  registerClient(clientId: string, response: any): void {
    this.clients.set(clientId, response);

    // Setup response headers
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Handle client close
    response.on('close', () => {
      this.handleClientDisconnect(clientId);
    });

    // Send initial connection message
    this.sendEvent(clientId, {
      type: 'connected',
      message: 'Connected to streaming server',
      timestamp: Date.now(),
    });

    logger.info('SSE client registered', { clientId });
  }

  /**
   * Subscribe to stream
   */
  subscribeToStream(executionId: string, clientId: string): boolean {
    const response = this.clients.get(clientId);
    if (!response) {
      logger.warn('Subscribe: client not found', { clientId });
      return false;
    }

    if (!this.subscriptions.has(executionId)) {
      this.subscriptions.set(executionId, new Set());
    }

    this.subscriptions.get(executionId)!.add(clientId);

    logger.info('Client subscribed to stream (SSE)', { executionId, clientId });
    return true;
  }

  /**
   * Broadcast output via SSE
   */
  broadcastOutput(executionId: string, data: string, isStderr = false): void {
    const clients = this.subscriptions.get(executionId);
    if (!clients) return;

    clients.forEach(clientId => {
      this.sendEvent(clientId, {
        type: 'output',
        executionId,
        data,
        isStderr,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Broadcast completion
   */
  broadcastComplete(executionId: string, exitCode?: number, duration?: number): void {
    const clients = this.subscriptions.get(executionId);
    if (!clients) return;

    clients.forEach(clientId => {
      this.sendEvent(clientId, {
        type: 'complete',
        executionId,
        exitCode,
        duration,
        timestamp: Date.now(),
      });
    });

    this.subscriptions.delete(executionId);
  }

  /**
   * Send SSE event
   */
  private sendEvent(clientId: string, event: Record<string, unknown>): void {
    const response = this.clients.get(clientId);
    if (!response || response.writableEnded) {
      return;
    }

    try {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
      logger.error('Failed to send SSE event', {
        clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle client disconnect
   */
  private handleClientDisconnect(clientId: string): void {
    this.clients.delete(clientId);

    // Unsubscribe from all
    this.subscriptions.forEach(clients => {
      clients.delete(clientId);
    });

    logger.info('SSE client disconnected', { clientId });
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('SSETransport shutting down');

    this.clients.forEach(response => {
      try {
        response.end();
      } catch (e) {
        // ignore
      }
    });
    this.clients.clear();
    this.subscriptions.clear();

    this.removeAllListeners();
  }
}

export default { WebSocketTransport, SSETransport };
