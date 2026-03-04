# Infect MCP Platform (aka `@infected/infected`)

> A single MCP runtime—shell, filesystem, memory, sequential thinking, fetch, and plugins—packaged for production deployments, autonomous agents, and rapid experimentation.

## Professional snapshot
| Pillar | Why it matters |
| --- | --- |
| **Unified module runtime** | Tools and plugins register through the same `ModuleManager`, enabling consistent lifecycle hooks, hot-reloading, and observability. |
| **Security & compliance** | Structured logging, optional API-key auth, and the LLM security gate (with `skipSafeCommands`) keep agents accountable. |
| **Extensibility** | Drop new modules under `tools/` or `plugins/`, and the server auto-registers them without restarting. |
| **Documentation-driven** | The docs collection (see “Docs Workspace” below) acts as a single-word quick map for every facet of this platform. |

## Quick runway
1. **Checkout & install**
   ```bash
   git clone https://github.com/HYPER12755/infected.git && cd infected
   npm install
   ```
2. **Configure**
   - Copy `.env.example` ➜ `.env` and fill `PORT`, `TRANSPORT`, `HOT_RELOAD`, and any optional LLM settings.
   - `infected.config.json` (use the `.example` file) controls caching, auth, permissions, plugins, and documentation discovery.
3. **Launch**
   ```bash
   npm run dev             # development
   npm run build && npm start  # production
   ```
4. **Trigger a tool**
   ```bash
   curl -X POST http://localhost:3001/mcp \
     -H "Content-Type: application/json" \
     -d '{"method":"tool_code/shell_execute","params":{"command":"ls","executionMode":"foreground"}}'
   ```

## Docs workspace (clickable)
| Doc | Description |
| --- | --- |
| [`GUIDE.md`](../docs/GUIDE.md) | How to author tools and plugins using the unified module model. |
| [`CONFIGURATION_EXAMPLES.md`](../docs/CONFIGURATION_EXAMPLES.md) | Sample configs for transports, caching, LLM security, and auth. |
| [`MCP_SERVER.md`](../docs/MCP_SERVER.md) | Runtime behavior, transports (STDIO/HTTP/SSE), health checks, and monitoring. |
| [`OFFICIAL_MCP_SDK_OVERVIEW.md`](../docs/OFFICIAL_MCP_SDK_OVERVIEW.md) | How the platform integrates with the MCP SDK and downstream clients. |
| [`STRUCTURE.md`](../docs/STRUCTURE.md) | Directory layout, module dependencies, and component responsibilities. |
| [`API_ENDPOINTS.md`](../docs/API_ENDPOINTS.md) *(if present)* | Health, tooling, and introspection endpoints for automation clients. |

## Tools & APIs
- All tools are unified modules under `tools/` (the `ModuleManager` loads each `module.json`, wraps it with permissions, caching, logging, and timeout monitoring, and exposes it through the MCP tool registry). Plug-in adapters like `tools/github` simply register extra helpers on top of that shared infrastructure.
- Build new plugins (and their tools) by dropping a `module.json` bundle into `plugins/`, implementing the module interface, and letting the hot-reload watcher load it automatically; then adjust `infected.config.json` or run `infected --configure` for transports, auth, or caching policy changes.
- The `sequentialthinking` tool plus your task files (`plan.txt`, `plan2.txt`) help you capture multi-step flows that spawn further tool calls; combine them with scripted CLI tooling (e.g., shell tooling or automation scripts) to chain work items reliably.

## Support & hygiene
- Store secrets in `.env` files; this repo is intentionally leak-free and tracks only documentation plus configuration templates.
- Keep the docs linked above up to date before opening pull requests—each doc is a navigation token for MVP reviewers.
- Questions? Use GitHub issues/PRs, mention the maintainer, and reference this README for context.

## License
MIT © the @infected team
