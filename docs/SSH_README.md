# SSH Session Manager (formerly ShellKeeper)

Persistent SSH/terminal management for the @infected/infected MCP server.

This integration reuses the core ideas from the original MCP ShellKeeper project (persistent PTYs, command logging, base64 file transfer, session tracking), but it now runs **inside the `@infected/infected` server as a unified module**. The module exposes seven `ssh_*` tools that share the runtime's permission, caching, and monitoring layers while giving every agent access to stateful shells.

## Features we support here

| Capability | Details |
| --- | --- |
| **Persistent sessions** | `ssh_new_session` / `ssh_close_session` spin PTYs that stay alive across tool calls. Each session keeps its directory, environment, and open connections. |
| **Command execution** | `ssh_execute` runs arbitrary commands, streams clean output (markers, ANSI codes stripped), guards timeouts, and surfaces structured metadata (exit code, duration) to MCP agents. |
| **Session introspection** | `ssh_list_sessions` + `ssh_get_buffer` let agents inspect uptime, last command, and raw buffer contents for debugging. |
| **File transfer** | `ssh_download_file` returns base64 payloads with size metadata; `ssh_upload_file` writes base64 payloads (with optional `mode`) into the workspace. |
| **Shared runtime** | All tools register through `ModuleManager.registerToolExecution`, so permission policies, caching, and monitoring apply exactly as they do for the rest of the server. |

> Favorite referencing commands from the original ShellKeeper doc:
> - `ssh_execute` replaces `terminal_execute` with the same session-aware semantics.
> - `ssh_new_session` / `ssh_close_session` keep your PTYs isolated per agent without holding the transport hostage.
> - `ssh_upload_file` and `ssh_download_file` mirror the 10 MB base64-friendly file transfer flows.

## How to use it

1. Start `npm run dev` or `npm start`. The module loads automatically because `infected.config.json` includes `"ssh"` in `modules`.
2. Talk to MCP Inspector or your agent:
   - Initialize a session: `ssh_new_session({ session_id: "prod-01" })`
   - Execute commands: `ssh_execute({ session_id: "prod-01", command: "ssh user@server" })`
   - Upload/download logs via the new file-transfer tools before closing the session.
   - Inspect buffers: `ssh_get_buffer({ session_id: "prod-01" })`
3. Close when done: `ssh_close_session({ session_id: "prod-01" })`

If multiple agents connect simultaneously, each should use a unique `session_id` so the module can keep their PTYs, metadata, and file transfers separate.

## Security notes

- The HTTP/SSE transports now reuse a single transport object so multiple agents can connect without raising `Already connected to a transport` errors (see `src/transports/http.ts`/`src/transports/sse.ts`).
- Configure `permissions.toolAllowlist/toolBlocklist` or enable API key auth in `infected.config.json` if these powerful tools should be limited.

## Troubleshooting reminders

- **Duplicated session IDs**: The module rejects creation if `session_id` already exists—close the old session first.
- **Long commands**: `ssh_execute` caps timeouts at 120 s by default; pass `timeout` when needed.
- **File transfers**: `ssh_download_file` encodes the payload as base64, mirroring ShellKeeper's workflow; decode locally before use.

## Contribution

If the module should support more SSH helpers (jump hosts, streaming SCP/SFTP, or fine-grained upload policies), add tools under `src/modules/ssh/index.ts` and register them through the unified module system.
