import { z } from "zod";
import axios from 'axios';
import https from 'node:https';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import logger from '../../core/logger.js';
import { createErrorResponse, ERROR_CODES, getErrorSuggestion } from '../../core/tool-error.js';
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
    headers: z.record(z.string(), z.string()).optional().describe("HTTP headers"),
    timeout: z.number().int().min(1).default(10000).describe("Request timeout in milliseconds"),
    returnType: z.enum(["text", "markdown", "cheerio"]).default("markdown").describe("Desired return type for HTML content"),
    selector: z.string().optional().describe("CSS selector to extract specific content"),
    blockLocalNetwork: z.boolean().optional().describe("Block requests to local network. Overrides global config."),
    domainWhitelist: z.array(z.string()).optional().describe("List of allowed domains. Overrides global config."),
    allowInsecureTls: z.boolean().optional().describe("Allow invalid/self-signed TLS certificates for this request"),
});
export class FetchModule {
    constructor() {
        this.name = 'fetch';
        this.deregisterFunctions = []; // Store SDK tool handles/deregister functions
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
            // Check for local network access
            if (blockLocalNetwork) {
                if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.16.')) {
                    throw new Error(`Access to local network (${hostname}) is blocked by security policy.`);
                }
            }
            // Check domain whitelist
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
                // If robots.txt cannot be loaded we fall back to allowing the request.
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
        const buildHeaderText = (headers) => {
            const entries = Object.entries(headers)
                .map(([key, val]) => `${key}: ${val}`)
                .slice(0, 20);
            return entries.length ? entries.join('\n') : '(no headers)';
        };
        const buildBodySnippet = (body, limit = 1000) => {
            const trimmed = body.trim();
            if (trimmed.length <= limit) {
                return trimmed;
            }
            return `${trimmed.slice(0, limit).trim()} …`;
        };
        const buildContentText = (url, status, headers, body, label) => {
            // Return just the body content without extra headers
            return body;
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
        // Register fetch tool
        const deregister = server.tool('fetch', {
            url: fetchArgsSchema.shape.url,
            method: fetchArgsSchema.shape.method,
            headers: fetchArgsSchema.shape.headers,
            body: fetchArgsSchema.shape.body,
            timeout: fetchArgsSchema.shape.timeout,
            responseType: fetchArgsSchema.shape.responseType,
            allowInsecureTls: fetchArgsSchema.shape.allowInsecureTls,
        }, async (args) => {
            try {
                // Security checks
                validateNetworkAccess(args.url, config.fetch);
                const allowInsecureTls = resolveAllowInsecureTls(args.allowInsecureTls);
                // Robots.txt check
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
                const bodyLabel = args.responseType === 'json' ? 'JSON response' : 'Response body';
                const text = buildContentText(args.url, response.status, flattenedHeaders, serializedData, bodyLabel);
                return {
                    content: [{ type: 'text', text }],
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
                let errorCode = ERROR_CODES.FETCH_ERROR;
                const lowerMessage = message.toLowerCase();
                if (lowerMessage.includes('enotfound') || lowerMessage.includes('404') || lowerMessage.includes('not found')) {
                    errorCode = ERROR_CODES.NOT_FOUND;
                }
                else if (lowerMessage.includes('timeout') || lowerMessage.includes('hang up')) {
                    errorCode = ERROR_CODES.COMMAND_TIMEOUT;
                }
                else if (lowerMessage.includes('econnrefused') || lowerMessage.includes('refused')) {
                    errorCode = ERROR_CODES.CONNECTION_FAILED;
                }
                else if (lowerMessage.includes('certificate') || lowerMessage.includes('tls') || lowerMessage.includes('ssl')) {
                    errorCode = ERROR_CODES.NETWORK_ERROR;
                }
                else if (lowerMessage.includes('blocked') || lowerMessage.includes('whitelist')) {
                    errorCode = ERROR_CODES.PERMISSION_DENIED;
                }
                return createErrorResponse(errorCode, `Fetch failed for ${args.url}: ${message}`, {
                    details: { url: args.url, method: args.method },
                    suggestion: getErrorSuggestion(errorCode),
                });
            }
        });
        logger.info('  FetchModule: fetch tool registered.');
        // Register fetch_html tool
        const deregisterHtml = server.tool('fetch_html', {
            url: fetchHtmlArgsSchema.shape.url,
            selector: fetchHtmlArgsSchema.shape.selector,
            headers: fetchHtmlArgsSchema.shape.headers,
            timeout: fetchHtmlArgsSchema.shape.timeout,
            returnType: fetchHtmlArgsSchema.shape.returnType,
            allowInsecureTls: fetchHtmlArgsSchema.shape.allowInsecureTls,
        }, async (args) => {
            try {
                // Security checks
                validateNetworkAccess(args.url, config.fetch);
                const allowInsecureTls = resolveAllowInsecureTls(args.allowInsecureTls);
                await ensureRobotsAllowed(args.url, args.timeout);
                const response = await axios({
                    method: "GET",
                    url: args.url,
                    headers: args.headers,
                    timeout: args.timeout,
                    responseType: 'text', // Always fetch as text for HTML
                    httpsAgent: buildHttpsAgent(allowInsecureTls),
                });
                let content = response.data;
                // Extract content based on selector
                if (args.selector) {
                    const $ = cheerio.load(content);
                    content = $(args.selector).html() || '';
                }
                // Convert to markdown if requested
                if (args.returnType === 'markdown') {
                    content = turndownService.turndown(content);
                }
                const serializedContent = typeof content === 'string' ? content : String(content);
                const flattenedHeaders = normalizeHeaders(response.headers);
                const text = buildContentText(args.url, response.status, flattenedHeaders, serializedContent, `HTML (${args.returnType})`);
                return {
                    content: [{ type: 'text', text }],
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
                let errorCode = ERROR_CODES.FETCH_ERROR;
                if (message.includes('ENOTFOUND') || message.includes('404')) {
                    errorCode = ERROR_CODES.NOT_FOUND;
                }
                else if (message.includes('timeout')) {
                    errorCode = ERROR_CODES.COMMAND_TIMEOUT;
                }
                else if (message.includes('ECONNREFUSED')) {
                    errorCode = ERROR_CODES.CONNECTION_FAILED;
                }
                return createErrorResponse(errorCode, `Fetch HTML failed for ${args.url}: ${message}`, {
                    details: { url: args.url },
                    suggestion: getErrorSuggestion(errorCode),
                });
            }
        });
        logger.info('  FetchModule: fetch_html tool registered');
    }
    async shutdown() {
        logger.info('  FetchModule: Shutting down, deregistering tools...');
        this.deregisterFunctions.forEach((deregister) => {
            if (typeof deregister === 'function') {
                deregister();
            }
            else if (deregister && typeof deregister.remove === 'function') {
                deregister.remove();
            }
        });
        this.deregisterFunctions = []; // Clear the array
        logger.info('  FetchModule: All tools deregistered.');
    }
}
export default FetchModule;
