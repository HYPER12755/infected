import { randomBytes } from 'node:crypto';
function hexEncode(buffer) {
    return buffer.toString('hex');
}
function appendTimestamp(token) {
    const timestamp = Date.now().toString(36);
    return `${token}-${timestamp}`;
}
export function generateRandomTokens(options = {}) {
    const { count = 1, lengthBytes = 32, prefix = '', includeTimestamp = false, } = options;
    const tokens = [];
    for (let i = 0; i < Math.max(1, count); i += 1) {
        const token = `${prefix}${hexEncode(randomBytes(lengthBytes))}`;
        tokens.push(includeTimestamp ? appendTimestamp(token) : token);
    }
    return tokens;
}
