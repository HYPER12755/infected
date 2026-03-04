import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logEventEmitter } from './log-event-emitter.js';

interface LogParams {
  level: string;
  message: string;
  timestamp: string;
  meta: Record<string, unknown>;
}

export class LogBroadcastManager {
  private listener = this.handleLogEvent.bind(this);
  private isRunning = false;

  constructor(private server: McpServer) {}

  start(): void {
    if (this.isRunning) {
      return;
    }
    logEventEmitter.on('log', this.listener);
    this.isRunning = true;
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }
    logEventEmitter.off('log', this.listener);
    this.isRunning = false;
  }

  private async handleLogEvent(info: Record<string, any>): Promise<void> {
    const { level, message } = info;
    if (!level || !message) {
      return;
    }
    const timestamp = info.timestamp || new Date().toISOString();
    const meta = { ...info };
    delete meta.level;
    delete meta.message;
    delete meta.timestamp;

    const params: LogParams = {
      level,
      message,
      timestamp,
      meta,
    };

    try {
      await this.server.server.notification({ method: 'notifications/log', params });
    } catch {
      // Ignore failures (clients might not yet be connected)
    }
  }
}
