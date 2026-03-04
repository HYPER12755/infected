import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ModuleManager } from './module-system/module-manager.js';
import { IUnifiedModule, IUnifiedSkill, UnifiedModuleManifest, isUnifiedSkill } from './module-system/module-types.js';
import type { GetPromptRequest } from '@modelcontextprotocol/sdk/types.js';

type PromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

type PromptEntry = {
  name: string;
  title?: string;
  description?: string;
  arguments?: PromptArgument[];
  _meta?: Record<string, unknown>;
  documentation?: string;
  steps?: string[];
};

export class PromptManager {
  private prompts: Map<string, PromptEntry> = new Map();
  private readonly onModuleLoaded = this.handleModuleLoaded.bind(this);
  private readonly onModuleUnloaded = this.handleModuleUnloaded.bind(this);
  private isStarted = false;

  constructor(private server: McpServer, private moduleManager: ModuleManager) {
    this.server.server.setRequestHandler(ListPromptsRequestSchema, this.handleListPromptsRequest.bind(this));
    this.server.server.setRequestHandler(GetPromptRequestSchema, this.handleGetPromptRequest.bind(this));
  }

  start(): void {
    if (this.isStarted) {
      return;
    }
    this.moduleManager.on('moduleLoaded', this.onModuleLoaded);
    this.moduleManager.on('moduleUnloaded', this.onModuleUnloaded);
    this.isStarted = true;
  }

  stop(): void {
    if (!this.isStarted) {
      return;
    }
    this.moduleManager.off('moduleLoaded', this.onModuleLoaded);
    this.moduleManager.off('moduleUnloaded', this.onModuleUnloaded);
    this.isStarted = false;
  }

  private handleListPromptsRequest() {
    const prompts = Array.from(this.prompts.values());
    return ListPromptsResultSchema.parse({ prompts });
  }

  private handleGetPromptRequest(request: GetPromptRequest) {
    const prompt = this.prompts.get(request.params.name);
    if (!prompt) {
      throw new McpError(ErrorCode.InvalidParams, `Prompt ${request.params.name} not found`);
    }

    const messageText = this.composePromptMessage(prompt, request.params.arguments);
    const promptMessage = {
      role: 'assistant' as const,
      content: {
        type: 'text' as const,
        text: messageText,
      },
    };

    return GetPromptResultSchema.parse({
      description: prompt.description,
      messages: [promptMessage],
    });
  }

  private handleModuleLoaded(module: IUnifiedModule): void {
    if (!isUnifiedSkill(module)) {
      return;
    }
    const prompt = this.buildPromptFromSkill(module);
    if (prompt) {
      this.prompts.set(prompt.name, prompt);
      this.notifyPromptsChanged();
    }
  }

  private handleModuleUnloaded(module: IUnifiedModule): void {
    if (!isUnifiedSkill(module)) {
      return;
    }
    const promptKey = this.sanitizePromptId(module.manifest.id);
    if (this.prompts.delete(promptKey)) {
      this.notifyPromptsChanged();
    }
  }

  private buildPromptFromSkill(skill: IUnifiedSkill): PromptEntry | null {
    const manifest = skill.manifest;
    if (!manifest.id || !manifest.name) {
      return null;
    }

    const inputs = manifest.inputs;
    const args = inputs
      ? Object.entries(inputs).map(([name, info]) => ({
          name,
          description: info?.description,
          required: info?.required ?? true,
        }))
      : undefined;

    const promptId = this.sanitizePromptId(manifest.id);
    const prompt: PromptEntry = {
      name: promptId,
      title: manifest.name,
      description: manifest.description,
      arguments: args,
      _meta: {
        moduleType: 'skill',
        version: manifest.version,
      },
      documentation: this.buildSkillDocumentation(manifest),
      steps: manifest.steps,
    };

    return prompt;
  }

  private sanitizePromptId(id: string): string {
    const parts = id.split('.');
    const withoutPrefix = parts.length > 1 ? parts.slice(1).join('.') : parts[0];
    return withoutPrefix.replace(/\./g, '_');
  }

  private notifyPromptsChanged(): void {
    (this.server.sendPromptListChanged() as Promise<void> | undefined)?.catch(() => {
      // ignore errors (client may not be listening yet)
    });
  }

  private composePromptMessage(prompt: PromptEntry, args?: Record<string, string>) {
    const sections: string[] = [];

    if (prompt.title) {
      sections.push(`Prompt: ${prompt.title}`);
    }

    if (prompt.description) {
      sections.push(prompt.description);
    }

    if (prompt.arguments && prompt.arguments.length > 0) {
      const argLines = prompt.arguments.map((arg) => {
        const requiredLabel = arg.required ? ' (required)' : '';
        const description = arg.description ? `: ${arg.description}` : '';
        return `- ${arg.name}${requiredLabel}${description}`;
      });
      sections.push(`Inputs:\n${argLines.join('\n')}`);
    }

    if (args && Object.keys(args).length > 0) {
      const providedLines = Object.entries(args).map(([name, value]) => `- ${name}: ${value}`);
      sections.push(`Provided arguments:\n${providedLines.join('\n')}`);
    }

    if (prompt.documentation) {
      sections.push(`Documentation:\n${prompt.documentation}`);
      sections.push(this.buildStepByStep(prompt));
    }

    const message = sections.filter(Boolean).join('\n\n');
    return message || 'No prompt content available.';
  }

  private buildSkillDocumentation(manifest: UnifiedModuleManifest): string {
    const sections: string[] = [];
    sections.push(`Skill Name: ${manifest.name} (${manifest.id})`);
    sections.push(`Version: ${manifest.version}`);
    sections.push(manifest.description ? `Overview:\n${manifest.description}` : 'Overview: No description provided.');

    const inputsDoc = this.formatSchemaBlock(manifest.inputs, 'Inputs');
    if (inputsDoc) {
      sections.push(inputsDoc);
    }

    const outputsDoc = this.formatSchemaBlock(manifest.outputs, 'Outputs');
    if (outputsDoc) {
      sections.push(outputsDoc);
    }

    if (manifest.capabilities && manifest.capabilities.length > 0) {
      sections.push(`Capabilities:\n${manifest.capabilities.map((cap) => `- ${cap}`).join('\n')}`);
    }

    if (manifest.requiresTools && manifest.requiresTools.length > 0) {
      sections.push(`Requires Tools:\n${manifest.requiresTools.map((tool) => `- ${tool}`).join('\n')}`);
    }

    if (manifest.steps && manifest.steps.length > 0) {
      sections.push(`Steps:\n${manifest.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`);
    }

    sections.push(`Entry point: ${manifest.entry}`);
    return sections.join('\n\n');
  }

  private formatSchemaBlock(schema?: Record<string, any>, label?: string): string | undefined {
    if (!schema || Object.keys(schema).length === 0) {
      return undefined;
    }
    const lines = Object.entries(schema).map(([name, info]) => {
      const typeLabel = info?.type ? `Type: ${info.type}` : '';
      const requiredLabel = typeof info?.required === 'boolean' ? `Required: ${info.required}` : '';
      const description = info?.description ? `Description: ${info.description}` : '';
      const parts = [typeLabel, requiredLabel, description].filter(Boolean);
      return `- ${name}${parts.length ? ` (${parts.join('; ')})` : ''}`;
    });
    return `${label ?? 'Fields'}:\n${lines.join('\n')}`;
  }

  private buildStepByStep(prompt: PromptEntry): string {
    if (prompt.steps && prompt.steps.length > 0) {
      const mapped = prompt.steps.map((step, index) => `${index + 1}. ${step}`);
      return `Step-by-step Guidance:\n${mapped.join('\n')}`;
    }
    const steps: string[] = [];
    steps.push('Step 1: Review the overview and purpose above to ensure the skill matches your intent.');
    if (prompt.arguments && prompt.arguments.length > 0) {
      const argsSummary = prompt.arguments
        .map((arg) => `- Provide ${arg.name}${arg.required ? ' (required)' : ''}${arg.description ? `: ${arg.description}` : ''}`)
        .join('\n');
      steps.push(`Step 2: Supply inputs:\n${argsSummary}`);
    } else {
      steps.push('Step 2: No inputs are required for this skill.');
    }
    steps.push('Step 3: After execution, inspect the documented outputs to interpret the result.');
    steps.push('Step 4: Refer to the capability list above for any prerequisites or follow-up actions.');
    return `Step-by-step Guidance:\n${steps.join('\n\n')}`;
  }
}
