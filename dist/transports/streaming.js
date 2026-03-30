import express from 'express';
import logger from '../core/logger.js';
const DEFAULT_FALLBACK_DELAY = 100;
const DEFAULT_HEARTBEAT_MS = 15000;
function writeSse(res, event, payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    res.write(`event: ${event}\n`);
    for (const line of String(data).split(/\r?\n/)) {
        res.write(`data: ${line}\n`);
    }
    res.write('\n');
}
export function streamingRouter(processManager, options = {}) {
    const router = express.Router();
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_FALLBACK_DELAY;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    router.get('/sse/:outputId', async (req, res) => {
        const outputId = req.params.outputId;
        const subscriber = processManager.getRealtimeStreamSubscriber();
        if (!subscriber) {
            logger.warn('Streaming router: realtime subscriber not initialized');
            res.status(503).json({ error: 'Streaming is not available' });
            return;
        }
        const executionId = processManager.resolveExecutionIdFromOutput(outputId) ?? outputId;
        const state = subscriber.getStreamState(executionId);
        if (!state) {
            res.status(404).json({ error: 'Stream not found', executionId });
            return;
        }
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
        }
        let lastSequence = 0;
        let completeSent = false;
        let closed = false;
        const cleanup = () => {
            if (closed)
                return;
            closed = true;
            clearInterval(interval);
            clearInterval(heartbeat);
            res.end();
            logger.info('Streaming router: SSE connection closed', { outputId, executionId });
        };
        const sendBuffers = () => {
            const buffers = subscriber.getBuffersFromSequence(executionId, lastSequence);
            if (buffers.length === 0) {
                if (!subscriber.getStreamState(executionId)?.isActive && !completeSent) {
                    const executionInfo = processManager.getExecution(executionId);
                    writeSse(res, 'complete', {
                        execution_id: executionId,
                        exit_code: executionInfo?.exit_code ?? null,
                        status: executionInfo?.status ?? 'unknown',
                        output_id: outputId,
                    });
                    completeSent = true;
                    cleanup();
                }
                return;
            }
            for (const buffer of buffers) {
                lastSequence = buffer.sequenceNumber + 1;
                writeSse(res, 'output', {
                    execution_id: executionId,
                    output_id: outputId,
                    data: buffer.data,
                    is_stderr: buffer.isStderr,
                    sequence: buffer.sequenceNumber,
                    timestamp: buffer.timestamp,
                });
            }
            const state = subscriber.getStreamState(executionId);
            if (state && !state.isActive && !completeSent) {
                const executionInfo = processManager.getExecution(executionId);
                writeSse(res, 'complete', {
                    execution_id: executionId,
                    exit_code: executionInfo?.exit_code ?? null,
                    status: executionInfo?.status ?? 'completed',
                    output_id: outputId,
                });
                completeSent = true;
                cleanup();
            }
        };
        const interval = setInterval(sendBuffers, pollIntervalMs);
        const heartbeat = setInterval(() => {
            if (!closed) {
                writeSse(res, 'heartbeat', { timestamp: Date.now() });
            }
        }, heartbeatIntervalMs);
        sendBuffers();
        req.on('close', cleanup);
        req.on('aborted', cleanup);
    });
    return router;
}
