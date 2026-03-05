import { spawn } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest } from '../../src/core/module-system/module-types.js';

type FlagValue = string | number | boolean | null | undefined;

interface GitHubToolInput {
  subcommand?: string;
  subcommands?: string[];
  args?: string[];
  flags?: string[];
  flagMap?: Record<string, FlagValue>;
  cwd?: string;
  timeoutMs?: number | string;
  parseJson?: boolean | string;
  allowFailure?: boolean | string;
  stdin?: string;
  message?: string;
}

interface GhRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const SharedInputSchema = {
  subcommand: z.string().optional().describe('Single subcommand string (space-separated).'),
  subcommands: z.array(z.string()).optional().describe('Subcommands as token array.'),
  args: z.array(z.string()).optional().describe('Additional positional args.'),
  flags: z.array(z.string()).optional().describe('Raw flag tokens (example: ["--json","name,number"]).'),
  flagMap: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .describe('Map-style flags. Example: { "repo": "OWNER/REPO", "limit": 20, "web": true }.'),
  cwd: z.string().optional().describe('Working directory for command execution.'),
  timeoutMs: z.union([z.number(), z.string()]).optional().describe('Command timeout in milliseconds.'),
  parseJson: z.union([z.boolean(), z.string()]).optional().describe('Parse stdout as JSON when possible.'),
  allowFailure: z
    .union([z.boolean(), z.string()])
    .optional()
    .describe('When true, non-zero exit codes return structured output instead of throwing.'),
  stdin: z.string().optional().describe('Optional stdin content piped into the gh command.'),
};

const workspaceRootEnv = process.env['INFECTED_WORKSPACE_ROOT']?.trim();
const installRootEnv = process.env['INFECTED_INSTALL_ROOT']?.trim();

function getRuntimeModuleRoot(): string {
  if (workspaceRootEnv && workspaceRootEnv.length > 0) {
    return path.resolve(workspaceRootEnv);
  }
  if (installRootEnv && installRootEnv.length > 0) {
    return path.resolve(installRootEnv);
  }
  return process.cwd();
}

function resolveRuntimePath(relativeOrAbsolute?: string): string {
  if (!relativeOrAbsolute || relativeOrAbsolute.trim().length === 0) {
    return getRuntimeModuleRoot();
  }
  const cleaned = relativeOrAbsolute.trim();
  return path.isAbsolute(cleaned)
    ? path.resolve(cleaned)
    : path.resolve(getRuntimeModuleRoot(), cleaned);
}

const RUNTIME_MODULE_ROOT = getRuntimeModuleRoot();

class GithubCommandsPlugin implements IUnifiedPlugin {
  manifest: UnifiedModuleManifest = {
    id: 'plugin.gh_commands',
    name: 'GH + Git CLI Tools',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.ts',
    description: 'Registers the generic gh tool plus git helpers (init/add/commit/branch/status/log/pull/push) with structured inputs.',
    timeout: 240000,
  };

  private deregisterFns: Array<() => void> = [];
  private readonly defaultTimeoutMs = 180000;
  private readonly defaultGitTimeoutMs = 300000;

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    this.registerGenericTool(context);
    this.registerGitTools(context);
    context.logger.info('GH + Git Commands plugin loaded. Registered gh_ and git_* tools.', {
      component: this.manifest.id,
    });
  }

  async onUnload(): Promise<void> {
    for (const deregister of this.deregisterFns) {
      deregister();
    }
    this.deregisterFns = [];
  }

  async onError(error: Error, context: UnifiedModuleContext): Promise<void> {
    context.logger.error(`GitHub Commands plugin error: ${error.message}`, {
      component: this.manifest.id,
      error,
    });
  }

  private registerGenericTool(context: UnifiedModuleContext): void {
    const toolId = 'gh_';
    const toolTitle = 'gh_';
    const description =
      "Run generic 'gh' commands through a single tool. Provide 'subcommand' or 'subcommands' plus optional args, flag map entries, or raw flags so you can include '--visibility=public' and other options.";

    const inputSchema = {
      ...SharedInputSchema,
      subcommand: z.string().optional().describe('Required unless subcommands is provided.'),
      subcommands: z.array(z.string()).optional().describe('Required unless subcommand is provided.'),
    };

    const deregister = context.moduleManager.registerToolExecution(
      toolId,
      async (rawInput: GitHubToolInput) => {
        const normalized = this.normalizeInput(rawInput, this.defaultGitTimeoutMs);
        if (normalized.subcommandTokens.length === 0) {
          throw new Error("gh requires 'subcommand' or 'subcommands'.");
        }
        return this.executeGhCommand([], rawInput, toolId);
      },
      toolTitle,
      description,
      inputSchema,
      this.manifest.id,
      true
    );

    this.deregisterFns.push(deregister);
  }

  private registerGitTools(context: UnifiedModuleContext): void {
    const commands = [
      { name: 'init', description: 'Initialize a new Git repository.' },
      { name: 'add', description: 'Stage files for commit.' },
      { name: 'commit', description: 'Record changes to the repository.' },
      { name: 'branch', description: 'Manage branches (list/create/delete).' },
      { name: 'status', description: 'Show working tree status.' },
      { name: 'log', description: 'Show commit logs.' },
      { name: 'pull', description: 'Fetch from and integrate with a remote.' },
      { name: 'push', description: 'Update remote refs along with associated objects.' },
    ];

    for (const command of commands) {
      this.registerGitCommandTool(context, command.name, command.description);
    }

    this.registerGenericGitTool(context);
  }

  private registerGitCommandTool(
    context: UnifiedModuleContext,
    commandName: string,
    commandDescription: string
  ): void {
    const toolId = `git_${this.sanitizeName(commandName)}`;
    const toolTitle = `git_${this.sanitizeName(commandName)}`;
    const description = `Run 'git ${commandName}' with args/subcommands/flags as needed. ${commandDescription}`;

    const inputSchema =
      commandName === 'commit'
        ? {
            ...SharedInputSchema,
            message: z.string().optional().describe('Commit message (translates to --message/-m).'),
          }
        : SharedInputSchema;

    const deregister = context.moduleManager.registerToolExecution(
      toolId,
      async (rawInput: GitHubToolInput) => {
        const baseEnhanced =
          commandName === 'commit' && rawInput.message
            ? {
                ...rawInput,
                flags: [...(rawInput.flags || []), '-m', rawInput.message],
              }
            : rawInput;

        const finalEnhanced =
          commandName === 'add' &&
          !((baseEnhanced.subcommand || '').trim() || (baseEnhanced.subcommands || []).length) &&
          !baseEnhanced.args?.filter((entry) => entry.trim().length > 0).length
            ? {
                ...baseEnhanced,
                args: [...(baseEnhanced.args || []), '.'],
              }
            : baseEnhanced;

        return this.executeGitCommand([commandName], finalEnhanced, toolId);
      },
      toolTitle,
      description,
      inputSchema,
      this.manifest.id,
      true
    );

    this.deregisterFns.push(deregister);
  }

  private registerGenericGitTool(context: UnifiedModuleContext): void {
    const toolId = 'git_';
    const toolTitle = 'git_';
    const description =
      "Run arbitrary 'git' commands via subcommand/subcommands plus args/flags/flagMap. Useful for anything beyond the targeted helpers.";

    const inputSchema = {
      ...SharedInputSchema,
      subcommand: z.string().optional().describe('Required unless subcommands is provided.'),
      subcommands: z.array(z.string()).optional().describe('Required unless subcommand is provided.'),
    };

    const deregister = context.moduleManager.registerToolExecution(
      toolId,
      async (rawInput: GitHubToolInput) => {
        const normalized = this.normalizeInput(rawInput, this.defaultGitTimeoutMs);
        if (normalized.subcommandTokens.length === 0) {
          throw new Error("git requires 'subcommand' or 'subcommands'.");
        }
        return this.executeGitCommand([], rawInput, toolId);
      },
      toolTitle,
      description,
      inputSchema,
      this.manifest.id,
      true
    );

    this.deregisterFns.push(deregister);
  }

  private async executeGhCommand(
    baseTokens: string[],
    rawInput: GitHubToolInput,
    toolId: string
  ): Promise<Record<string, unknown>> {
    const input = this.normalizeInput(rawInput, this.defaultTimeoutMs);
    const finalArgs = [
      ...baseTokens,
      ...input.subcommandTokens,
      ...input.args,
      ...this.flagMapToTokens(input.flagMap),
      ...input.flags,
    ];

    const startedAt = Date.now();

    try {
      const run = await this.runGh(finalArgs, input.cwd, input.timeoutMs, input.stdin);
      const durationMs = Date.now() - startedAt;
      const output = this.buildOutput(toolId, finalArgs, run, durationMs, 'gh');

      if (!output.ok && !input.allowFailure) {
        throw new Error(
          `gh exited with code ${output.exitCode}. stderr: ${output.stderr || '(empty)'}`
        );
      }

      return output;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      const structured = {
        ok: false,
        tool: toolId,
        command: ['gh', ...finalArgs],
        exitCode: 1,
        durationMs,
        stdout: '',
        stderr: message,
        timedOut: /timed out/i.test(message),
        hints: [
          'Confirm gh is installed and authenticated (gh auth status).',
          'Use flags/flagMap for option handling and args for positionals.',
        ],
      };

      if (!input.allowFailure) {
        throw new Error(message);
      }
      return structured;
    }
  }

  private async executeGitCommand(
    baseTokens: string[],
    rawInput: GitHubToolInput,
    toolId: string
  ): Promise<Record<string, unknown>> {
    const input = this.normalizeInput(rawInput, this.defaultGitTimeoutMs);
    const finalArgs = [
      ...baseTokens,
      ...input.subcommandTokens,
      ...input.args,
      ...this.flagMapToTokens(input.flagMap),
      ...input.flags,
    ];

    const startedAt = Date.now();

    try {
      const run = await this.runGit(finalArgs, input.cwd, input.timeoutMs, input.stdin);
      const durationMs = Date.now() - startedAt;
      const output = this.buildOutput(toolId, finalArgs, run, durationMs, 'git');

      if (!output.ok && !input.allowFailure) {
        throw new Error(
          `git exited with code ${output.exitCode}. stderr: ${output.stderr || '(empty)'}`
        );
      }

      return output;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      const structured = {
        ok: false,
        tool: toolId,
        command: ['git', ...finalArgs],
        exitCode: 1,
        durationMs,
        stdout: '',
        stderr: message,
        timedOut: /timed out/i.test(message),
        hints: [
          'Confirm git is installed and the repository is accessible.',
          'Use args/flags/flagMap for option handling.',
        ],
      };

      if (!input.allowFailure) {
        throw new Error(message);
      }
      return structured;
    }
  }

  private normalizeInput(rawInput: GitHubToolInput, fallbackTimeoutMs?: number) {
    const cwd = this.resolveCwd(rawInput.cwd);
    const timeoutMs = this.clampNumber(
      rawInput.timeoutMs,
      1000,
      600000,
      fallbackTimeoutMs ?? this.defaultTimeoutMs
    );
    const parseJson = this.toBoolean(rawInput.parseJson, false);
    const allowFailure = this.toBoolean(rawInput.allowFailure, true);
    const args = this.toStringArray(rawInput.args);
    const flags = this.toStringArray(rawInput.flags);
    const subcommands = this.toStringArray(rawInput.subcommands);
    const subcommandTokens = [
      ...this.splitTokens(rawInput.subcommand || ''),
      ...subcommands,
    ];
    const flagMap = rawInput.flagMap && typeof rawInput.flagMap === 'object' ? rawInput.flagMap : {};
    const stdin = typeof rawInput.stdin === 'string' ? rawInput.stdin : undefined;

    return {
      cwd,
      timeoutMs,
      parseJson,
      allowFailure,
      args,
      flags,
      subcommandTokens,
      flagMap,
      stdin,
    };
  }

  private resolveCwd(requested?: string): string {
    if (requested && requested.trim()) {
      return resolveRuntimePath(requested);
    }
    return RUNTIME_MODULE_ROOT;
  }

  private async killConflictingGitProcesses(cwd: string, excludePids: number[] = []): Promise<void> {
    const entries = await fsPromises.readdir('/proc');
    const gitPids: number[] = [];

    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (!Number.isFinite(pid) || pid === process.pid || excludePids.includes(pid)) continue;

      try {
        const procCwd = await fsPromises.readlink(`/proc/${pid}/cwd`);
        if (procCwd !== cwd) continue;
      const cmdlinePath = `/proc/${pid}/cmdline`;
      const cmdline = await fsPromises.readFile(cmdlinePath, 'utf8');
        if (cmdline.includes('git')) {
          gitPids.push(pid);
        }
      } catch {
        continue;
      }
    }

    for (const pid of gitPids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
      await this.waitForPidExit(pid, 2000);
    }
  }

  private async waitForPidExit(pid: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await fsPromises.stat(`/proc/${pid}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        return;
      }
    }
  }

  private buildOutput(
    toolId: string,
    commandArgs: string[],
    run: GhRunResult,
    durationMs: number,
    binary: string = 'gh'
  ): Record<string, unknown> {
    const stdoutLines = run.stdout ? run.stdout.split('\n').length : 0;
    const stderrLines = run.stderr ? run.stderr.split('\n').length : 0;
    const commandLine = [binary, ...commandArgs].join(' ').trim();
    const logLines = [] as string[];
    logLines.push(`Command: ${commandLine}`);
    logLines.push(`Duration: ${durationMs}ms | Exit code: ${run.exitCode}${run.timedOut ? ' (timed out)' : ''}`);
    if (run.stdout) {
      logLines.push('Stdout:');
      logLines.push(run.stdout);
    }
    if (run.stderr) {
      logLines.push('Stderr:');
      logLines.push(run.stderr);
    }
    if (!run.stdout && !run.stderr) {
      logLines.push('No output was produced.');
    }
    const logText = logLines.join('\n').trim();

    return {
      ok: run.exitCode === 0,
      tool: toolId,
      command: [binary, ...commandArgs],
      exitCode: run.exitCode,
      durationMs,
      timedOut: run.timedOut,
      stdout: run.stdout,
      stderr: run.stderr,
      summary: {
        stdoutLines,
        stderrLines,
      },
      content: [
        {
          type: 'text',
          text: logText,
        },
      ],
      structuredContent: {
        command: commandLine,
        exitCode: run.exitCode,
        durationMs,
        timedOut: run.timedOut,
        stdout: run.stdout,
        stderr: run.stderr,
        log: logText,
      },
    };
  }

  private async runGh(
    commandArgs: string[],
    cwd: string,
    timeoutMs: number,
    stdin?: string
  ): Promise<GhRunResult> {
    return await new Promise<GhRunResult>((resolve, reject) => {
      const child = spawn('gh', commandArgs, {
        cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let done = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        if (done) return;
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`gh command timed out after ${timeoutMs}ms`));
          return;
        }
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 1,
          timedOut: false,
        });
      });

      if (stdin && stdin.length > 0) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });
  }

  private async runGit(
    commandArgs: string[],
    cwd: string,
    timeoutMs: number,
    stdin?: string
  ): Promise<GhRunResult> {
    await this.killConflictingGitProcesses(cwd);
    let child;
    const result = await new Promise<GhRunResult>((resolve, reject) => {
      child = spawn('git', commandArgs, {
        cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let done = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        if (done) return;
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`git command timed out after ${timeoutMs}ms`));
          return;
        }
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 1,
          timedOut: false,
        });
      });

      if (stdin && stdin.length > 0) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });

    await this.killConflictingGitProcesses(cwd, child?.pid ? [child.pid] : []);
    return result;
  }

  private splitTokens(input: string): string[] {
    return input
      .split(' ')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  private toStringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input.map((v) => String(v)).filter((v) => v.length > 0);
  }

  private toBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
    }
    return fallback;
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number
  ): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(Math.max(Math.trunc(num), min), max);
  }

  private flagMapToTokens(flagMap: Record<string, FlagValue>): string[] {
    const tokens: string[] = [];

    for (const [rawKey, rawValue] of Object.entries(flagMap)) {
      const key = rawKey.trim();
      if (!key) continue;

      let flagToken: string;
      if (key.startsWith('-')) {
        flagToken = key;
      } else if (key.length === 1) {
        flagToken = `-${key}`;
      } else {
        flagToken = `--${key.replace(/_/g, '-')}`;
      }

      if (typeof rawValue === 'boolean') {
        if (rawValue) {
          tokens.push(flagToken);
        } else if (flagToken.startsWith('--')) {
          tokens.push(`--no-${flagToken.slice(2)}`);
        }
        continue;
      }

      if (rawValue === null || rawValue === undefined) {
        continue;
      }

      tokens.push(flagToken, String(rawValue));
    }

    return tokens;
  }

  private sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
}

export default GithubCommandsPlugin;
