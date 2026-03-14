// Configuration constants
const DEFAULT_EXECUTOR_HOST = '127.0.0.1';
const DEFAULT_EXECUTOR_PORT = '4030';
const DEFAULT_EXECUTOR_TIMEOUT = 15000; // 15 seconds
export class RemoteHttpClient {
    constructor(opts) {
        const envUrl = process.env['EXECUTOR_URL'] ||
            `http://${process.env['EXECUTOR_HOST'] || DEFAULT_EXECUTOR_HOST}:${process.env['EXECUTOR_PORT'] || DEFAULT_EXECUTOR_PORT}`;
        this.baseUrl = (opts?.baseUrl || envUrl).replace(/\/$/, '');
        const tok = opts?.token ?? process.env['EXECUTOR_TOKEN'];
        this.token = tok === undefined ? undefined : String(tok);
        this.timeoutMs = opts?.timeoutMs ?? DEFAULT_EXECUTOR_TIMEOUT;
    }
    async get(path) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: 'GET',
                headers: this.headers(),
                signal: controller.signal,
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            return (await res.json());
        }
        finally {
            clearTimeout(t);
        }
    }
    async post(path, body) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const init = {
                method: 'POST',
                headers: this.headers({ json: true }),
                signal: controller.signal,
            };
            if (body !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                init.body = JSON.stringify(body);
            }
            const res = await fetch(`${this.baseUrl}${path}`, init);
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            return (await res.json());
        }
        finally {
            clearTimeout(t);
        }
    }
    headers(opts) {
        const h = {};
        if (opts?.json)
            h['Content-Type'] = 'application/json; charset=utf-8';
        if (this.token)
            h['Authorization'] = `Bearer ${this.token}`;
        return h;
    }
}
