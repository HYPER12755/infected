import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'; // Corrected import path
import logger from '../core/logger.js'; // Import our central logger

export function createStdioTransport(): StdioServerTransport {
  logger.info('Creating StdioServerTransport...');
  return new StdioServerTransport();
}
