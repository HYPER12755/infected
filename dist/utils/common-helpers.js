import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
// ID生成
export function generateId() {
    return uuidv4();
}
// タイムスタンプ生成
export function getCurrentTimestamp() {
    return new Date().toISOString();
}
// ファイルサイズの取得
export async function getFileSize(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    }
    catch {
        return 0;
    }
}
// ディレクトリの作成（非同期）
export async function ensureDirectory(dirPath) {
    try {
        await fs.access(dirPath);
    }
    catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}
// ディレクトリの作成（同期版）
export function ensureDirectorySync(dirPath) {
    try {
        fsSync.accessSync(dirPath);
    }
    catch {
        fsSync.mkdirSync(dirPath, { recursive: true });
    }
}
// ファイルの安全な読み取り
export async function safeReadFile(filePath, offset = 0, size, encoding = 'utf-8') {
    const stats = await fs.stat(filePath);
    const totalSize = stats.size;
    const fileHandle = await fs.open(filePath, 'r');
    try {
        const readSize = size ? Math.min(size, totalSize - offset) : totalSize - offset;
        const buffer = Buffer.alloc(readSize);
        await fileHandle.read(buffer, 0, readSize, offset);
        const content = buffer.toString(encoding);
        const isTruncated = size ? totalSize > offset + size : false;
        return { content, totalSize, isTruncated };
    }
    finally {
        await fileHandle.close();
    }
}
