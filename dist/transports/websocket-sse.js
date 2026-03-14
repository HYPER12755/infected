/**
 * WebSocket Transport for Real-Time Streaming
 * Provides bidirectional streaming over WebSocket protocol
 */
import { EventEmitter } from 'node:events';
import logger from './logger.js';
/**
 * WebSocket Transport Handler
 */
export class WebSocketTransport extends EventEmitter {
    constructor() {
        super();
        this.subscriptions = new Map();
        this.clients = new Map();
        this.heartbeatInterval = 30000; // 30 seconds
        this.heartbeatTimers = new Map();
        logger.debug('WebSocketTransport initialized');
    }
    /**
     * Register a WebSocket client
     */
    registerClient(clientId, ws) {
        this.clients.set(clientId, ws);
        // Setup event listeners
        ws.on('message', (message) => {
            this.handleMessage(clientId, message);
        });
        ws.on('close', () => {
            this.handleClientDisconnect(clientId);
        });
        ws.on('error', (error) => {
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
    subscribeToStream(executionId, clientId) {
        const ws = this.clients.get(clientId);
        if (!ws) {
            logger.warn('Subscribe: client not found', { clientId, executionId });
            return false;
        }
        if (!this.subscriptions.has(executionId)) {
            this.subscriptions.set(executionId, new Set());
        }
        const subscription = {
            executionId,
            clientId,
            subscribedAt: Date.now(),
            ws,
        };
        this.subscriptions.get(executionId).add(subscription);
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
    unsubscribeFromStream(executionId, clientId) {
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
    broadcastOutput(executionId, data, isStderr = false) {
        const subscriptions = this.subscriptions.get(executionId);
        if (!subscriptions)
            return;
        const message = {
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
    broadcastError(executionId, error) {
        const subscriptions = this.subscriptions.get(executionId);
        if (!subscriptions)
            return;
        const message = {
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
    broadcastComplete(executionId, exitCode, duration) {
        const subscriptions = this.subscriptions.get(executionId);
        if (!subscriptions)
            return;
        const message = {
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
    sendMessage(clientId, message) {
        const ws = this.clients.get(clientId);
        if (!ws || ws.readyState !== 1) { // 1 = OPEN
            logger.warn('Cannot send message: client not connected', { clientId });
            return;
        }
        try {
            ws.send(JSON.stringify(message));
        }
        catch (error) {
            logger.error('Failed to send message', {
                clientId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    /**
     * Handle message from client
     */
    handleMessage(clientId, rawMessage) {
        try {
            const message = JSON.parse(rawMessage);
            if (message.type === 'subscribe') {
                this.subscribeToStream(message.executionId, clientId);
            }
            else if (message.type === 'unsubscribe') {
                this.unsubscribeFromStream(message.executionId, clientId);
            }
            else {
                this.emit('message', { clientId, message });
            }
        }
        catch (error) {
            logger.error('Failed to parse message', {
                clientId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    /**
     * Handle client disconnect
     */
    handleClientDisconnect(clientId) {
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
    startHeartbeat(clientId) {
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
    getSubscriptionStatus(executionId) {
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
    async shutdown() {
        logger.info('WebSocketTransport shutting down');
        // Clear heartbeats
        this.heartbeatTimers.forEach(timer => clearInterval(timer));
        this.heartbeatTimers.clear();
        // Close all client connections
        this.clients.forEach(ws => {
            try {
                ws.close();
            }
            catch (e) {
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
    constructor() {
        super(...arguments);
        this.subscriptions = new Map();
        this.clients = new Map();
    }
    /**
     * Register SSE client
     */
    registerClient(clientId, response) {
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
    subscribeToStream(executionId, clientId) {
        const response = this.clients.get(clientId);
        if (!response) {
            logger.warn('Subscribe: client not found', { clientId });
            return false;
        }
        if (!this.subscriptions.has(executionId)) {
            this.subscriptions.set(executionId, new Set());
        }
        this.subscriptions.get(executionId).add(clientId);
        logger.info('Client subscribed to stream (SSE)', { executionId, clientId });
        return true;
    }
    /**
     * Broadcast output via SSE
     */
    broadcastOutput(executionId, data, isStderr = false) {
        const clients = this.subscriptions.get(executionId);
        if (!clients)
            return;
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
    broadcastComplete(executionId, exitCode, duration) {
        const clients = this.subscriptions.get(executionId);
        if (!clients)
            return;
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
    sendEvent(clientId, event) {
        const response = this.clients.get(clientId);
        if (!response || response.writableEnded) {
            return;
        }
        try {
            response.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        catch (error) {
            logger.error('Failed to send SSE event', {
                clientId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    /**
     * Handle client disconnect
     */
    handleClientDisconnect(clientId) {
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
    async shutdown() {
        logger.info('SSETransport shutting down');
        this.clients.forEach(response => {
            try {
                response.end();
            }
            catch (e) {
                // ignore
            }
        });
        this.clients.clear();
        this.subscriptions.clear();
        this.removeAllListeners();
    }
}
export default { WebSocketTransport, SSETransport };
