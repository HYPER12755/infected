import { randomBytes } from 'node:crypto';

export interface RandomTokenOptions {
  count?: number;
  lengthBytes?: number;
  prefix?: string;
  includeTimestamp?: boolean;
}

function hexEncode(buffer: Buffer): string {
  return buffer.toString('hex');
}

function appendTimestamp(token: string): string {
  const timestamp = Date.now().toString(36);
  return `${token}-${timestamp}`;
}

export function generateRandomTokens(options: RandomTokenOptions = {}): string[] {
  const {
    count = 1,
    lengthBytes = 32,
    prefix = '',
    includeTimestamp = false,
  } = options;

  const tokens: string[] = [];
  for (let i = 0; i < Math.max(1, count); i += 1) {
    const token = `${prefix}${hexEncode(randomBytes(lengthBytes))}`;
    tokens.push(includeTimestamp ? appendTimestamp(token) : token);
  }
  return tokens;
}
