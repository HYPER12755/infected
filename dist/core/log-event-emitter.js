import { EventEmitter } from 'node:events';
import Transport from 'winston-transport';
// Create a singleton EventEmitter instance for logs
export const logEventEmitter = new EventEmitter();
// Custom Winston Transport to emit events
export class EventEmitterTransport extends Transport {
    constructor(opts) {
        super(opts);
    }
    log(info, callback) {
        // Emit the log message as an event
        logEventEmitter.emit('log', info);
        // You can also emit different events based on log level if needed
        logEventEmitter.emit(info.level, info);
        callback();
    }
}
