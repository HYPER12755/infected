Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the TypeScript/ESM sources for modules (shell, ssh, filesystem, etc.); `dist/` contains the compiled JS artifacts.
- Tools and helper scripts live under `tools/` and `scripts/`, while `plugins/` hosts optional MCP extensions.
- Configuration lives at the repo root (`package.json`, `infected.config.json`, `.env.example`), docs under `docs/`, and automated test suites under `tests/unit/`.
- Build outputs, logs, and temporary artifacts are not committed; inspect `logs/` locally when diagnosing runtime behavior.

## Build, Test, and Development Commands
- `npm run dev` – launches the server in development mode with `tsx watch`, logging to `logs/dev.log` and keeping port 3001 free.
- `npm run build` – compiles both the main server (`tsc`) and the tools project (`tsc --project tsconfig.tools.json`); run this before publishing packages or starting production servers.
- `npm start` – creates `logs` if needed, kills any process on 3001, and starts `tsx src/index.ts` in the background for production testing (logs in `logs/start.log`).
- `npm test` – executes `node --test --import tsx tests/unit/**/*.test.ts` to cover the recovery, execution, and module suites.

## Coding Style & Naming Conventions
- Follow the existing TypeScript style: ES modules (`import x from '...'`), `const`/`let`, single quotes for strings, and two-space indentation.
- Prefer descriptive namespaces and keep module exports grouped logically (`src/modules/ssh`, `src/modules/filesystem`, `core/`, etc.).
- Keep helper types and schemas close to their consumers (e.g., `ssh-*.ts` files define Zod schemas alongside handlers).
- There is no lint script, but consistent formatting keeps the auto-generated `dist/` files stable; run `npm run build` after editing `src/`.

## Testing Guidelines
- Tests live under `tests/unit/*.test.ts`; names end with `.test.ts` and mirror the module they cover.
- Jest is not used; rely on Node’s native test runner invoked via `npm test`. Add coverage-focused assertions that document retry/backoff behavior.
- After adding or changing a module, rerun `npm test` to ensure recovery/error metrics remain green before committing.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commit style (`type(scope): description`). The repo history favors `feat`, `fix`, `docs`, etc., so mirror that.
- For PRs, include a concise summary, list the commands you ran (build/test), mention linked issues (if any), and note whether docs or dist artifacts changed.
- Tag any breaking changes explicitly and call out schema/tool updates so downstream consumers can migrate.

## Security & Configuration Tips
- Keep `infected.config.json` and `.env` values environment-specific; never commit secrets or SSH keys.
- Filesystem tools respect the allowed-directory list configured in `FilesystemModule`; validate paths via `tools/read_text_file` instead of bypassing checks.
- SSH transfers now use SCP/SFTP/FTP; ensure the remote target has the required binary and that credentials (especially FTP passwords) stay encrypted in your environment.
