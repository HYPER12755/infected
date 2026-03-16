import winston from 'winston';
import chalk from 'chalk';
import { EventEmitterTransport, logEventEmitter } from './log-event-emitter.js'; // Import the custom transport
// Define custom levels and colors
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
    fatal: 5,
};
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'white',
    fatal: 'redBG',
};
winston.addColors(colors);
// Custom format for file transport (no color)
const fileFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), // ISO 8601 with milliseconds and timezone
winston.format.errors({ stack: true }), // Include stack trace
winston.format.json() // JSON format for structured logging
);
const developmentConsoleFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.colorize({ all: true }), winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...meta } = info;
    const component = meta.component ? chalk.cyan(`[${meta.component}] `) : '';
    const context = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} ${component}${level}: ${message} ${stack ? '\n' + stack : ''} ${context}`;
}));
const productionConsoleFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), winston.format.errors({ stack: true }), winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }), // Include all metadata
winston.format.json());
const isProduction = process.env.NODE_ENV === 'production';
const consoleTransportFormat = isProduction ? productionConsoleFormat : developmentConsoleFormat;
const logger = winston.createLogger({
    levels,
    defaultMeta: { component: 'core' }, // Default component for logs
    transports: [
        new winston.transports.Console({
            format: consoleTransportFormat,
            level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'), // Default to info in prod, debug in dev
            handleExceptions: true // Ensure console also captures exceptions
        }),
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            format: fileFormat,
            handleExceptions: true, // Capture exceptions to error.log
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 5,
            tailable: true
        }),
        new winston.transports.File({
            filename: 'logs/combined.log',
            level: 'debug', // Log everything from debug level and above to file
            format: fileFormat,
            handleExceptions: true, // Capture exceptions to combined.log
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 10,
            tailable: true
        }),
        // Add the custom EventEmitterTransport for real-time log streaming
        new EventEmitterTransport({
            level: 'debug', // Emit all log levels
            handleExceptions: true // Emit exceptions through event emitter
        })
    ],
    exceptionHandlers: [
        new winston.transports.File({ filename: 'logs/exceptions.log', format: fileFormat }), // Dedicated exception file
    ],
    rejectionHandlers: [
        new winston.transports.File({ filename: 'logs/rejections.log', format: fileFormat }), // Dedicated rejection file
    ],
    exitOnError: false // Do not exit on handled exceptions, Winston will do its job
});
const formatConsoleArgs = (args) => args
    .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
    .filter(Boolean)
    .join(' ');
// Override console methods to use the logger
console.log = (...args) => logger.info(formatConsoleArgs(args));
console.info = (...args) => logger.info(formatConsoleArgs(args));
console.warn = (...args) => logger.warn(formatConsoleArgs(args));
console.error = (...args) => logger.error(formatConsoleArgs(args));
console.debug = (...args) => logger.debug(formatConsoleArgs(args));
// Ensure logEventEmitter has an 'error' listener to avoid unhandled errors when emitting 'error' level logs
logEventEmitter.on('error', () => {
    // Swallow to prevent unhandled error events; logs are already processed elsewhere.
});
export default logger;
