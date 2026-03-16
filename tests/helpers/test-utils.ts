import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Test utility functions for unit testing
 */

/**
 * Wait for a specified number of milliseconds
 */
export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait with timeout and optional rejection
 */
export async function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(message || `Timeout after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Spawn a test process that echoes input
 */
export function spawnEchoProcess(text: string): ChildProcess {
  const process = spawn('echo', [text]);
  return process;
}

/**
 * Spawn a test process that sleeps
 */
export function spawnSleepProcess(seconds: number): ChildProcess {
  const process = spawn('sleep', [String(seconds)]);
  return process;
}

/**
 * Spawn a test process that writes to stdout and stderr
 */
export function spawnMultipleOutputProcess(): ChildProcess {
  const process = spawn('bash', ['-c', 'echo "stdout line"; echo "stderr line" >&2; exit 0']);
  return process;
}

/**
 * Spawn an interactive process (cat or similar)
 */
export function spawnInteractiveProcess(): ChildProcess {
  const process = spawn('bash', ['-c', 'cat']);
  return process;
}

/**
 * Create a temporary directory for test files
 */
export async function createTempDir(): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

/**
 * Clean up temporary directory
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Write a test file and return its path
 */
export async function createTestFile(
  dirPath: string,
  filename: string,
  content: string
): Promise<string> {
  const filePath = path.join(dirPath, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Read test file content
 */
export async function readTestFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Create mock configuration for testing
 */
export function createMockConfig(overrides?: Partial<any>): any {
  return {
    timeoutMs: 5000,
    killGracePeriodMs: 1000,
    captureStderr: true,
    maxOutputSize: 1024 * 1024,
    workingDirectory: process.cwd(),
    shellPath: '/bin/bash',
    ...overrides,
  };
}

/**
 * Create mock SSH connection target
 */
export function createMockSSHTarget(overrides?: Partial<any>): any {
  return {
    host: 'test.example.com',
    port: 22,
    username: 'testuser',
    ...overrides,
  };
}

/**
 * Collect process output
 */
export async function collectProcessOutput(process: ChildProcess): Promise<{
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', () => {
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Assert that a value is true
 */
export function assert(value: any, message?: string): asserts value {
  if (!value) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Assert that a value equals expected
 */
export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message || `Assertion failed: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`
    );
  }
}

/**
 * Assert that a value is close to expected (for floating point comparisons)
 */
export function assertClose(actual: number, expected: number, tolerance: number = 0.1): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `Assertion failed: ${actual} is not close to ${expected} (tolerance: ${tolerance})`
    );
  }
}

/**
 * Assert that a function throws an error
 */
export async function assertThrows(
  fn: () => Promise<any> | any,
  expectedMessage?: string | RegExp
): Promise<Error> {
  try {
    const result = fn();
    if (result instanceof Promise) {
      await result;
    }
    throw new Error('Expected function to throw an error');
  } catch (error) {
    if (error instanceof Error && error.message === 'Expected function to throw an error') {
      throw error;
    }
    
    if (expectedMessage) {
      const errorMessage = (error as Error).message;
      if (expectedMessage instanceof RegExp) {
        if (!expectedMessage.test(errorMessage)) {
          throw new Error(
            `Expected error message to match ${expectedMessage}, but got "${errorMessage}"`
          );
        }
      } else {
        if (!errorMessage.includes(expectedMessage)) {
          throw new Error(
            `Expected error message to include "${expectedMessage}", but got "${errorMessage}"`
          );
        }
      }
    }
    
    return error as Error;
  }
}

/**
 * Assert that a function does not throw
 */
export async function assertNoThrows(fn: () => Promise<any> | any): Promise<void> {
  try {
    const result = fn();
    if (result instanceof Promise) {
      await result;
    }
  } catch (error) {
    throw new Error(`Expected function not to throw, but got: ${(error as Error).message}`);
  }
}

/**
 * Create a mock event emitter for testing
 */
export class MockEventEmitter {
  private listeners = new Map<string, Function[]>();

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => cb(...args));
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length || 0;
  }

  getEmittedEvents(event: string): any[] {
    return [];
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 100
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await wait(delayMs * Math.pow(2, attempt - 1));
      }
    }
  }
  
  throw lastError;
}

/**
 * Create a deferred promise for testing async behavior
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: any) => void = () => {};
  
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  
  return { promise, resolve, reject };
}

/**
 * Get current memory usage in MB
 */
export function getMemoryUsageMB(): number {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

/**
 * Get process count (approximate)
 */
export function getProcessCount(): number {
  // This is a rough estimate; actual implementation depends on OS
  return process.pid ? 1 : 0;
}
