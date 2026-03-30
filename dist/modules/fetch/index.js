import { z } from "zod";
import axios from 'axios';
import https from 'node:https';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import logger from '../../core/logger.js';
// Zod schemas for fetch tool arguments
const fetchArgsSchema = z.object({
    url: z.string().url().describe("The URL to fetch"),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET").describe("HTTP method"),
    headers: z.record(z.string(), z.string()).optional().describe("HTTP headers"),
    body: z.string().optional().describe("Request body for POST/PUT/DELETE"),
    timeout: z.number().int().min(1).default(10000).describe("Request timeout in milliseconds"),
    responseType: z.enum(["text", "json", "markdown"]).default("text").describe("Desired response type"),
    allowInsecureTls: z.boolean().optional().describe("Allow invalid/self-signed TLS certificates for this request"),
});
const fetchHtmlArgsSchema = z.object({
    url: z.string().url().describe("The URL to fetch HTML from"),
    selector: z.string().optional().describe("CSS selector to extract specific content"),
    headers: z.record(z.string(), z.string()).optional().describe("HTTP headers"),
    timeout: z.number().int().min(1).default(10000).describe("Request timeout in milliseconds"),
    returnType: z.enum(["text", "markdown", "cheerio"]).default("markdown").describe("Desired return type for HTML content"),
    allowInsecureTls: z.boolean().optional().describe("Allow invalid/self-signed TLS certificates for this request"),
});
export class FetchModule {
    constructor() {
        this.name = 'fetch';
        this.registeredTools = [];
    }
    async register(server, config, managers) {
        logger.info(`  FetchModule: Registering with config: ${JSON.stringify(config.fetch)}`);
        const turndownService = new TurndownService();
        const createRobotsParser = robotsParser;
        const validateNetworkAccess = (url, moduleConfig) => {
            const parsedUrl = new URL(url);
            const hostname = parsedUrl.hostname;
            const blockLocalNetwork = moduleConfig?.blockLocalNetwork ?? config.fetch?.blockLocalNetwork ?? true;
            const domainWhitelist = moduleConfig?.domainWhitelist ?? config.fetch?.domainWhitelist ?? [];
            if (blockLocalNetwork) {
                if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.16.')) {
                    throw new Error(`Access to local network (${hostname}) is blocked by security policy.`);
                }
            }
            if (domainWhitelist.length > 0 && !domainWhitelist.includes(hostname)) {
                throw new Error(`Access to ${hostname} is not allowed. It is not in the domain whitelist.`);
            }
        };
        const fetchRobotsTxt = async (robotsUrl, timeout) => {
            try {
                const response = await axios.get(robotsUrl, {
                    timeout,
                    responseType: 'text',
                    maxRedirects: 3,
                });
                return typeof response.data === 'string' ? response.data : '';
            }
            catch {
                return '';
            }
        };
        const ensureRobotsAllowed = async (targetUrl, timeout) => {
            try {
                const robotsTxtUrl = new URL('/robots.txt', targetUrl).toString();
                const robotsContent = await fetchRobotsTxt(robotsTxtUrl, timeout);
                const robots = createRobotsParser(robotsTxtUrl, robotsContent);
                const isAllowed = typeof robots?.isAllowed === 'function' ? robots.isAllowed(targetUrl, '*') : true;
                if (isAllowed === false) {
                    throw new Error(`Access to ${targetUrl} is disallowed by robots.txt`);
                }
            }
            catch (error) {
                if (error instanceof Error && error.message.startsWith('Access to')) {
                    throw error;
                }
            }
        };
        const resolveAllowInsecureTls = (override) => override ?? config.fetch?.allowInsecureTls ?? false;
        const buildHttpsAgent = (allowInsecureTls) => {
            if (!allowInsecureTls) {
                return undefined;
            }
            return new https.Agent({ rejectUnauthorized: false });
        };
        const normalizeHeaders = (headers) => {
            if (!headers) {
                return {};
            }
            return Object.entries(headers).reduce((normalized, [key, value]) => {
                if (value === undefined || value === null) {
                    return normalized;
                }
                if (Array.isArray(value)) {
                    normalized[key.toLowerCase()] = value.join('; ');
                    return normalized;
                }
                normalized[key.toLowerCase()] = String(value);
                return normalized;
            }, {});
        };
        const buildBodySnippet = (body, limit = 1000) => {
            const trimmed = body.trim();
            if (trimmed.length <= limit) {
                return trimmed;
            }
            return `${trimmed.slice(0, limit).trim()} …`;
        };
        const formatFetchError = (error, allowInsecureTls) => {
            const err = error;
            const code = err?.code || '';
            const message = err?.message || String(error);
            const tlsCodes = new Set([
                'SELF_SIGNED_CERT_IN_CHAIN',
                'DEPTH_ZERO_SELF_SIGNED_CERT',
                'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
                'CERT_HAS_EXPIRED',
            ]);
            if (tlsCodes.has(code) || /certificate|self[- ]signed|unable to verify/i.test(message)) {
                if (allowInsecureTls) {
                    return `TLS certificate validation failed even with allowInsecureTls=true: ${message}`;
                }
                return `TLS certificate validation failed: ${message}. Set allowInsecureTls=true (or config.fetch.allowInsecureTls=true) to bypass certificate validation.`;
            }
            return message;
        };
        // Register WebFetch tool
        const webFetchTool = server.registerTool('WebFetch', {
            title: 'Fetch URL Content',
            description: 'Fetch content from a URL. Returns raw response body (text, JSON, or markdown). Use for API calls, downloading files, or retrieving web content.',
            inputSchema: fetchArgsSchema,
            outputSchema: z.object({
                status: z.number(),
                headers: z.record(z.string()),
                data: z.union([z.string(), z.record(z.unknown())]),
                bodySnippet: z.string(),
                url: z.string(),
            }),
        }, async (args) => {
            try {
                validateNetworkAccess(args.url, config.fetch);
                const allowInsecureTls = resolveAllowInsecureTls(args.allowInsecureTls);
                await ensureRobotsAllowed(args.url, args.timeout);
                const response = await axios({
                    method: args.method,
                    url: args.url,
                    headers: args.headers,
                    data: args.body,
                    timeout: args.timeout,
                    responseType: args.responseType === 'json' ? 'json' : 'text',
                    httpsAgent: buildHttpsAgent(allowInsecureTls),
                });
                let data = response.data;
                if (args.responseType === 'markdown' && typeof response.data === 'string') {
                    data = turndownService.turndown(response.data);
                }
                const serializedData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
                const flattenedHeaders = normalizeHeaders(response.headers);
                return {
                    content: [{ type: 'text', text: serializedData }],
                    structuredContent: {
                        status: response.status,
                        headers: flattenedHeaders,
                        data,
                        bodySnippet: buildBodySnippet(serializedData, 1000),
                        url: args.url,
                    },
                };
            }
            catch (error) {
                const allowInsecureTls = resolveAllowInsecureTls(args.allowInsecureTls);
                const message = formatFetchError(error, allowInsecureTls);
                logger.error(`Error fetching URL ${args.url}: ${message}`);
                return {
                    content: [{ type: 'text', text: `Error: ${message}` }],
                    structuredContent: {
                        error: true,
                        message,
                        url: args.url,
                        method: args.method,
                    },
                };
            }
        });
        this.registeredTools.push(webFetchTool);
        logger.info('  FetchModule: WebFetch tool registered.');
        // Register FetchHtml tool
        const fetchHtmlTool = server.registerTool('FetchHtml', {
            title: 'Fetch HTML Content',
            description: 'Fetch HTML content from a URL and optionally convert to markdown or extract specific elements. Use for web scraping, documentation retrieval, or extracting page content.',
            inputSchema: fetchHtmlArgsSchema,
            outputSchema: z.object({
                status: z.number(),
                headers: z.record(z.string()),
                content: z.string(),
                bodySnippet: z.string(),
                url: z.string(),
            }),
        }, async (args) => {
            try {
                validateNetworkAccess(args.url, config.fetch);
                const allowInsecureTls = resolveAllowInsecureTls(args.allowInsecureTls);
                await ensureRobotsAllowed(args.url, args.timeout);
                const response = await axios({
                    method: "GET",
                    url: args.url,
                    headers: args.headers,
                    timeout: args.timeout,
                    responseType: 'text',
                    httpsAgent: buildHttpsAgent(allowInsecureTls),
                });
                let content = response.data;
                if (args.selector) {
                    const $ = cheerio.load(content);
                    content = $(args.selector).html() || '';
                }
                if (args.returnType === 'markdown') {
                    content = turndownService.turndown(content);
                }
                const serializedContent = typeof content === 'string' ? content : String(content);
                const flattenedHeaders = normalizeHeaders(response.headers);
                return {
                    content: [{ type: 'text', text: serializedContent }],
                    structuredContent: {
                        status: response.status,
                        headers: flattenedHeaders,
                        content,
                        bodySnippet: buildBodySnippet(serializedContent, 1200),
                        url: args.url,
                    },
                };
            }
            catch (error) {
                const allowInsecureTls = resolveAllowInsecureTls(args.allowInsecureTls);
                const message = formatFetchError(error, allowInsecureTls);
                logger.error(`Error fetching HTML from ${args.url}: ${message}`);
                return {
                    content: [{ type: 'text', text: `Error: ${message}` }],
                    structuredContent: {
                        error: true,
                        message,
                        url: args.url,
                    },
                };
            }
        });
        this.registeredTools.push(fetchHtmlTool);
        logger.info('  FetchModule: FetchHtml tool registered');
    }
    async shutdown() {
        logger.info('  FetchModule: Shutting down, deregistering tools...');
        this.registeredTools.forEach((tool) => {
            tool.remove();
        });
        this.registeredTools = [];
        logger.info('  FetchModule: All tools deregistered.');
    }
}
export default FetchModule;
