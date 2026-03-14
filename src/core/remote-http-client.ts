// Configuration constants
const DEFAULT_EXECUTOR_HOST = '127.0.0.1';
const DEFAULT_EXECUTOR_PORT = '4030';
const DEFAULT_EXECUTOR_TIMEOUT = 15000; // 15 seconds

export interface RemoteClientOptions {
  baseUrl?: string; // e.g., http://127.0.0.1:4030
  token?: string;   // optional bearer token (Phase 1.5)
  timeoutMs?: number;
}

export class RemoteHttpClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly timeoutMs: number;

  constructor(opts?: RemoteClientOptions) {
    const envUrl = process.env['EXECUTOR_URL'] || 
      `http://${process.env['EXECUTOR_HOST'] || DEFAULT_EXECUTOR_HOST}:${process.env['EXECUTOR_PORT'] || DEFAULT_EXECUTOR_PORT}`;
    this.baseUrl = (opts?.baseUrl || envUrl).replace(/\/$/, '');
    const tok = opts?.token ?? process.env['EXECUTOR_TOKEN'];
    this.token = tok === undefined ? undefined : String(tok);
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_EXECUTOR_TIMEOUT;
  }

  async get<T = unknown>(path: string): Promise<T> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: this.headers(),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: this.headers({ json: true }),
        signal: controller.signal,
      };
      if (body !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (init as any).body = JSON.stringify(body);
      }
      const res = await fetch(`${this.baseUrl}${path}`, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  private headers(opts?: { json?: boolean }): Record<string, string> {
    const h: Record<string, string> = {};
    if (opts?.json) h['Content-Type'] = 'application/json; charset=utf-8';
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }
}
