import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { randomUUID } from 'crypto';
export function generateId() {
    return randomUUID();
}
export function getCurrentTimestamp() {
    return new Date().toISOString();
}
export async function getFileSize(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    }
    catch (error) {
        return 0;
    }
}
export function ensureDirectorySync(dirPath) {
    if (!fsSync.existsSync(dirPath)) {
        fsSync.mkdirSync(dirPath, { recursive: true });
    }
}
export async function safeReadFile(filePath, offset = 0, size = 8192, encoding = 'utf-8') {
    const stats = await fs.stat(filePath);
    const totalSize = stats.size;
    const handle = await fs.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(Math.min(size, totalSize - offset));
        await handle.read(buffer, 0, buffer.length, offset);
        const content = buffer.toString(encoding);
        const isTruncated = (offset + buffer.length) < totalSize;
        return { content, totalSize, isTruncated };
    }
    finally {
        await handle.close();
    }
}
