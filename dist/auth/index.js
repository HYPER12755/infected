import logger from '../core/logger.js';
function maskApiKey(key) {
    if (!key)
        return undefined;
    if (key.length <= 8)
        return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
let currentConfig;
export const setAuthConfig = (config) => {
    currentConfig = config;
    logger.debug('Auth config set', {
        authEnabled: config.auth?.enabled,
        apiKeyCount: config.auth?.apiKey ? (Array.isArray(config.auth.apiKey) ? config.auth.apiKey.length : 1) : 0,
        randomTokenEnabled: config.auth?.randomAuthTokenEnabled
    });
};
export const authenticationMiddleware = (req, res, next) => {
    const startTime = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const requestPath = req.path;
    const requestMethod = req.method;
    // If auth is not enabled, skip authentication
    if (!currentConfig || !currentConfig.auth?.enabled) {
        logger.debug('Auth middleware: Auth disabled, allowing request', {
            path: requestPath,
            method: requestMethod,
            ip: clientIp,
            duration: Date.now() - startTime
        });
        return next();
    }
    // Auth is enabled, check API key
    const apiKey = req.headers['x-api-key'];
    const validApiKeys = currentConfig.auth.apiKey;
    if (!apiKey) {
        logger.warn('Authentication failed: No API key provided', {
            path: requestPath,
            method: requestMethod,
            ip: clientIp,
            userAgent: req.headers['user-agent']
        });
        return res.status(401).json({ message: 'Unauthorized: API Key required. Provide x-api-key header.' });
    }
    if (!validApiKeys || !validApiKeys.includes(apiKey)) {
        logger.warn('Authentication failed: Invalid API key', {
            path: requestPath,
            method: requestMethod,
            ip: clientIp,
            userAgent: req.headers['user-agent'],
            providedKeyPrefix: maskApiKey(apiKey)
        });
        return res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
    }
    // Authentication successful
    logger.info('Authentication successful', {
        path: requestPath,
        method: requestMethod,
        ip: clientIp,
        userAgent: req.headers['user-agent'],
        duration: Date.now() - startTime
    });
    next();
};
export const authorizationMiddleware = (req, res, next) => {
    const startTime = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const requestPath = req.path;
    // Authorization hook for future policy checks (RBAC/ABAC, resource scoping, etc.)
    // For now, just log and continue
    logger.debug('Authorization middleware executed', {
        path: requestPath,
        method: req.method,
        ip: clientIp,
        duration: Date.now() - startTime
    });
    next();
};
