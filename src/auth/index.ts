import { Request, Response, NextFunction } from 'express';
import { InfectedConfig } from '../config'; // Assuming your config is available like this
import logger from '../core/logger';

function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

let currentConfig: InfectedConfig;

export const setAuthConfig = (config: InfectedConfig) => {
  currentConfig = config;
};

export const authenticationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (!currentConfig || !currentConfig.auth?.enabled) {
    return next(); // Auth disabled, proceed
  }

  const apiKey = req.headers['x-api-key'] as string;
  const validApiKeys = currentConfig.auth.apiKey;

  if (!apiKey || !validApiKeys || !validApiKeys.includes(apiKey)) {
    logger.warn('Unauthorized API access attempt', {
      component: 'auth',
      ip: req.ip,
      path: req.path,
      sessionId: req.headers['mcp-session-id'],
      apiKey: maskApiKey(apiKey),
    });
    return res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
  }
  logger.info('Authenticated API request', {
    component: 'auth',
    ip: req.ip,
    path: req.path,
    sessionId: req.headers['mcp-session-id'],
    apiKey: maskApiKey(apiKey),
  });
  next();
};

export const authorizationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Authorization hook for future policy checks (RBAC/ABAC, resource scoping, etc.).
  logger.debug('Authorization middleware executed.', { component: 'auth', ip: req.ip, path: req.path });
  next();
};
