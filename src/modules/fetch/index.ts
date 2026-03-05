import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Module, InfectedConfig, ManagerInstances } from '../../types/index.js';
import { z } from "zod";
import axios from 'axios';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import logger from '../../core/logger.js'; // Use our central logger

// Define the URL for the external Python Fetch Microservice
// This can be configured via environment variables or infected.config.json
const PYTHON_FETCH_MICROSERVICE_URL = process.env.PYTHON_FETCH_MICROSERVICE_URL || 'http://localhost:5000';

// Zod schemas for fetch tool arguments
const fetchArgsSchema = z.object({
  url: z.string().url().describe("The URL to fetch"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET").describe("HTTP method"),
  headers: z.record(z.string(), z.string()).optional().describe("HTTP headers"),
  body: z.string().optional().describe("Request body for POST/PUT/DELETE"),
  timeout: z.number().int().min(1).default(10000).describe("Request timeout in milliseconds"),
  responseType: z.enum(["text", "json", "markdown"]).default("text").describe("Desired response type"),
});

const fetchHtmlArgsSchema = z.object({
  url: z.string().url().describe("The URL to fetch HTML from"),
  headers: z.record(z.string(), z.string()).optional().describe("HTTP headers"),
  timeout: z.number().int().min(1).default(10000).describe("Request timeout in milliseconds"),
  returnType: z.enum(["text", "markdown", "cheerio"]).default("markdown").describe("Desired return type for HTML content"),
  selector: z.string().optional().describe("CSS selector to extract specific content"),
  blockLocalNetwork: z.boolean().optional().describe("Block requests to local network. Overrides global config."),
  domainWhitelist: z.array(z.string()).optional().describe("List of allowed domains. Overrides global config."),
});

export class FetchModule implements Module {
  name = 'fetch';
  private deregisterFunctions: any[] = []; // Store SDK tool handles/deregister functions

  async register(server: McpServer, config: InfectedConfig, managers: ManagerInstances): Promise<void> {
    logger.info(`  FetchModule: Registering with config: ${JSON.stringify(config.fetch)}`);

    const turndownService = new TurndownService();

    // Helper to validate network access
type RobotsParserResponse = {
  isAllowed(targetUrl: string, userAgent: string): boolean;
};

type RobotsParserFactory = (url: string, content: string) => RobotsParserResponse;

const createRobotsParser = robotsParser as unknown as RobotsParserFactory;

const validateNetworkAccess = (url: string, moduleConfig?: InfectedConfig['fetch']): void => {
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

    const fetchRobotsTxt = async (robotsUrl: string, timeout: number): Promise<string> => {
      try {
        const response = await axios.get(robotsUrl, {
          timeout,
          responseType: 'text',
          maxRedirects: 3,
        });
        return typeof response.data === 'string' ? response.data : '';
      } catch {
        return '';
      }
    };

    const ensureRobotsAllowed = async (targetUrl: string, timeout: number): Promise<void> => {
      try {
        const robotsTxtUrl = new URL('/robots.txt', targetUrl).toString();
        const robotsContent = await fetchRobotsTxt(robotsTxtUrl, timeout);
        const robots = createRobotsParser(robotsTxtUrl, robotsContent);
        const isAllowed =
          typeof robots?.isAllowed === 'function' ? robots.isAllowed(targetUrl, '*') : true;
        if (isAllowed === false) {
          throw new Error(`Access to ${targetUrl} is disallowed by robots.txt`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Access to')) {
          throw error;
        }
        // If robots.txt cannot be loaded we fall back to allowing the request.
      }
    };

    this.deregisterFunctions.push(server.registerTool(
      "fetch",
      {
        title: "Fetch URL",
        description: "Fetches content from a URL using HTTP. Supports GET, POST, PUT, DELETE methods, headers, and body. Can return text, JSON, or markdown. Performs security validation (robots.txt, domain whitelist, local network block).",
        inputSchema: fetchArgsSchema,
        outputSchema: z.object({
          status: z.number(),
          headers: z.record(z.string(), z.string()),
          data: z.union([z.string(), z.record(z.unknown())]),
          url: z.string().url(),
        }),
      },
      async (args: z.infer<typeof fetchArgsSchema>) => {
        try {
          // Security checks
          validateNetworkAccess(args.url, config.fetch);

          // Robots.txt check
          await ensureRobotsAllowed(args.url, args.timeout);

          const response = await axios({
            method: args.method,
            url: args.url,
            headers: args.headers,
            data: args.body,
            timeout: args.timeout,
            responseType: args.responseType === 'json' ? 'json' : 'text',
          });

          let data = response.data;
          if (args.responseType === 'markdown' && typeof response.data === 'string') {
            data = turndownService.turndown(response.data);
          }

          return {
            content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
            structuredContent: {
              status: response.status,
              headers: response.headers,
              data: data,
              url: args.url,
            },
          };
        } catch (error) {
          logger.error(`Error fetching URL ${args.url}: ${error instanceof Error ? error.message : String(error)}`);
          return {
            content: [{ type: "text", text: `Error fetching URL: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      },
    ));
    logger.info('  FetchModule: fetch tool registered.');

    this.deregisterFunctions.push(server.registerTool(
      "fetch_html",
      {
        title: "Fetch HTML Content",
        description: "Fetches HTML content from a URL, converts it to markdown, or extracts specific elements using a CSS selector. Performs security validation (robots.txt, domain whitelist, local network block).",
        inputSchema: fetchHtmlArgsSchema,
        outputSchema: z.object({
          status: z.number(),
          headers: z.record(z.string(), z.string()),
          content: z.string(),
          url: z.string().url(),
        }),
      },
      async (args: z.infer<typeof fetchHtmlArgsSchema>) => {
        try {
          // Security checks
          validateNetworkAccess(args.url, config.fetch);

          await ensureRobotsAllowed(args.url, args.timeout);

          const response = await axios({
            method: "GET",
            url: args.url,
            headers: args.headers,
            timeout: args.timeout,
            responseType: 'text', // Always fetch as text for HTML
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
          } else if (args.returnType === 'cheerio') {
            // Return raw HTML for Cheerio processing if requested
          }

          return {
            content: [{ type: "text", text: content }],
            structuredContent: {
              status: response.status,
              headers: response.headers,
              content: content,
              url: args.url,
            },
          };
        } catch (error) {
          logger.error(`Error fetching HTML from ${args.url}: ${error instanceof Error ? error.message : String(error)}`);
          return {
            content: [{ type: "text", text: `Error fetching HTML: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      },
    ));
    logger.info('  FetchModule: fetch_html tool registered.');
  }

  async shutdown(): Promise<void> {
    logger.info('  FetchModule: Shutting down, deregistering tools...');
    this.deregisterFunctions.forEach((deregister) => {
      if (typeof deregister === 'function') {
        deregister();
      } else if (deregister && typeof deregister.remove === 'function') {
        deregister.remove();
      }
    });
    this.deregisterFunctions = []; // Clear the array
    logger.info('  FetchModule: All tools deregistered.');
  }
}

export default FetchModule;
