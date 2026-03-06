import logger from '../../core/logger.js';
import { ProcessManager } from '../../core/process-manager.js';
import { v4 as uuidv4 } from 'uuid';

export interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
  execution_id?: string;
}

export class SequentialThinkingServer {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};
  private disableThoughtLogging: boolean;
  private processManager: ProcessManager | undefined;

  constructor(processManager?: ProcessManager) {
    this.processManager = processManager;
    this.disableThoughtLogging = (process.env.DISABLE_THOUGHT_LOGGING || "").toLowerCase() === "true";
  }

  private formatThought(thoughtData: ThoughtData): string {
    const { thoughtNumber, totalThoughts, thought, isRevision, revisesThought, branchFromThought, branchId } = thoughtData;

    let prefix = '';
    let context = '';

    if (isRevision) {
      prefix = 'Revision';
      context = ` (revising thought ${revisesThought})`;
    } else if (branchFromThought) {
      prefix = 'Branch';
      context = ` (from thought ${branchFromThought}, ID: ${branchId})`;
    } else {
      prefix = 'Thought';
      context = '';
    }

    const header = `${prefix} ${thoughtNumber}/${totalThoughts}${context}`;
    const border = '─'.repeat(Math.max(header.length, thought.length) + 4);

    return `
┌${border}┐
│ ${header} │
├${border}┤
│ ${thought.padEnd(border.length - 2)} │
└${border}┘`;
  }

  public processThought(input: ThoughtData): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
    try {
      if (input.thoughtNumber > input.totalThoughts) {
        input.totalThoughts = input.thoughtNumber;
      }

      this.thoughtHistory.push(input);

      if (input.branchFromThought && input.branchId) {
        if (!this.branches[input.branchId]) {
          this.branches[input.branchId] = [];
        }
        this.branches[input.branchId].push(input);
      }

      if (!this.disableThoughtLogging) {
        const formattedThought = this.formatThought(input);
        logger.info(formattedThought);
      }

      if (this.processManager) {
        const executionId = input.execution_id || uuidv4();
        const notification = {
          execution_id: executionId,
          thought_data: input,
          progress: input.thoughtNumber / input.totalThoughts,
          message: `Thought ${input.thoughtNumber}/${input.totalThoughts}: ${input.thought.substring(0, 100)}...`,
        };
      this.processManager.sendBackgroundProcessOutput(executionId, JSON.stringify(notification), false);
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            thoughtNumber: input.thoughtNumber,
            totalThoughts: input.totalThoughts,
            nextThoughtNeeded: input.nextThoughtNeeded,
            branches: Object.keys(this.branches),
            thoughtHistoryLength: this.thoughtHistory.length
          })
        }]
      };
    } catch (error) {
      logger.error('Error processing sequential thought:', { error: error instanceof Error ? error.message : String(error) });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          })
        }],
        isError: true
      };
    }
  }
}
