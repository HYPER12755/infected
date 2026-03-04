import { 
  CommandHistoryEntry, 
  SimplifiedLLMEvaluationResult,
  FunctionCallHandlerRegistry,
  FunctionCallContext,
  FunctionCallResult,
  FunctionCallHandler,
  EvaluateCommandSecurityArgs,
  ReevaluateWithUserIntentArgs,
  ReevaluateWithAdditionalContextArgs
} from '../types/shell-server/enhanced-security.js'; // Adapted import
import { SecurityManager } from './manager.js'; // Adapted import
import { 
  SafetyEvaluationResult,
  SafetyEvaluationResultFactory,
  ElicitationResult
} from '../types/shell-server/index.js'; // Adapted import to shell-server types
import { CommandHistoryManager } from '../core/enhanced-history-manager.js'; // Adapted import
import { getCurrentTimestamp, generateId } from '../utils/shell-helpers.js'; // Adapted import
import { repairAndParseJson } from '../utils/json-repair.js'; // Adapted import
import { adjustCriteria } from '../utils/criteria-manager.js'; // Adapted import
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types'; // Adapted SDK import
import logger from '../core/logger.js'; // Use our central logger
import { InfectedConfig } from '../config/index.js'; // Import InfectedConfig for llmSecurity type
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // Adapted SDK import

// Structured Output imports (minimal usage for fallback only)
import { SecurityLLMPromptGenerator } from './security-llm-prompt-generator.js'; // Adapted import
import { CCCToMCPCMAdapter } from './chat-completion-adapter.js'; // Adapted import

// Elicitation interfaces (based on mcp-confirm implementation)
interface ElicitationSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: string;
      title?: string;
      description?: string;
      minimum?: number;
      maximum?: number;
      enum?: string[];
      [key: string]: unknown;
    }
  >;
  required?: string[];
}

interface ElicitationResponse {
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
}

// Tool call interface for OpenAI API compatibility
interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// LLM evaluation result (using simplified structure)
// Enhanced LLM evaluation result interface that supports new function-based tools
// Base interface with common fields
interface LLMEvaluationResultBase {
  reasoning: string;
  suggested_alternatives?: string[];  // Common to all types for consistency
  elicitationResult?: ElicitationResult | undefined;  // Elicitation details when applicable
  
  // Legacy compatibility
  requires_additional_context?: {
    command_history_depth: number;
    execution_results_count: number;
    user_intent_search_keywords: string[] | null;
    user_intent_question: string | null;
    assistant_request_message?: string | null;
  };
}

// Discriminated union for type safety
type LLMEvaluationResult = 
  | (LLMEvaluationResultBase & {
      evaluation_result: 'allow';
    })
  | (LLMEvaluationResultBase & {
      evaluation_result: 'deny';
    })
  | (LLMEvaluationResultBase & {
      evaluation_result: 'add_more_history';
      command_history_depth?: number;
      execution_results_count?: number;
      user_intent_search_keywords?: string[];
    })
  | (LLMEvaluationResultBase & {
      evaluation_result: 'user_confirm';
      confirmation_question?: string;
    })
  | (LLMEvaluationResultBase & {
      evaluation_result: 'ai_assistant_confirm';
      assistant_request_message?: string;
      next_action: {  // Required for ai_assistant_confirm
        instruction: string;
        method: string;
        expected_outcome: string;
        executable_commands?: string[];
      };
    });

// User intent data from elicitation
interface UserIntentData {
  intent: string;
  justification: string;
  timestamp: string;
  confidence_level: 'low' | 'medium' | 'high';
  elicitation_id: string;
}

/**
 * Enhanced Security Evaluator (Unified)
 * LLM-centric security evaluation with structured output
 */
export class EnhancedSafetyEvaluator {
  private chatAdapter: CCCToMCPCMAdapter;
  private promptGenerator: SecurityLLMPromptGenerator;
  private securityManager: SecurityManager;
  private historyManager: CommandHistoryManager;
  private mcpServer: McpServer; // Changed to McpServer
  private functionCallHandlers: FunctionCallHandlerRegistry;
  private enhancedConfig: EnhancedSecurityConfig; // Store enhancedConfig
  private llmSecurityConfig: InfectedConfig['llmSecurity']; // Store llmSecurityConfig

  constructor(
    securityManager: SecurityManager,
    historyManager: CommandHistoryManager,
    mcpServer: McpServer, // Directly receive McpServer
    enhancedConfig: EnhancedSecurityConfig, // Directly receive enhancedConfig
    llmSecurityConfig: InfectedConfig['llmSecurity'] // Directly receive llmSecurityConfig
  ) {
    this.securityManager = securityManager;
    this.historyManager = historyManager;
    this.mcpServer = mcpServer; // Assign McpServer
    this.enhancedConfig = enhancedConfig;
    this.llmSecurityConfig = llmSecurityConfig;

    // Initialize Function Call handler registry
    this.functionCallHandlers = this.initializeFunctionCallHandlers();

    // Initialize prompt generator only
    const generator = new SecurityLLMPromptGenerator();
    this.promptGenerator = generator;

    // Initialize chatAdapter with dynamic LLM settings
    this.chatAdapter = this.initializeChatAdapter(this.mcpServer, this.enhancedConfig, this.llmSecurityConfig);
  }

  /**
   * Initializes the ChatCompletionAdapter with LLM configuration.
   * Prioritizes llmSecurityConfig values.
   */
  private initializeChatAdapter(
    server: McpServer,
    enhancedConfig: EnhancedSecurityConfig,
    llmSecurityConfig: InfectedConfig['llmSecurity']
  ): CCCToMCPCMAdapter {
    const provider = llmSecurityConfig.provider || enhancedConfig.llm_provider;
    const model = llmSecurityConfig.model || enhancedConfig.llm_model;
    const apiKey = llmSecurityConfig.apiKey || enhancedConfig.llm_api_key;

    if (!provider || !model || !apiKey) {
      logger.warn('LLM security is enabled, but provider, model, or API key are missing. This may cause LLM evaluation to fail.', {
        provider, model, apiKey: apiKey ? '***' : 'Missing'
      });
    }

    return new CCCToMCPCMAdapter(server, provider, model, apiKey);
  }

  /**
   * Set configuration for the evaluator.
   */
  public setConfig(enhancedConfig: EnhancedSecurityConfig, llmSecurityConfig: InfectedConfig['llmSecurity']): void {
    this.enhancedConfig = enhancedConfig;
    this.llmSecurityConfig = llmSecurityConfig;
    // Re-initialize chat adapter with updated config
    this.chatAdapter = this.initializeChatAdapter(this.mcpServer, this.enhancedConfig, this.llmSecurityConfig);
  }

  /**
   * Initialize Function Call handlers registry
   */
  private initializeFunctionCallHandlers(): FunctionCallHandlerRegistry {
    return {
      'evaluate_command_security': this.handleEvaluateCommandSecurity.bind(this),
      'reevaluate_with_user_intent': this.handleReevaluateWithUserIntent.bind(this),
      'reevaluate_with_additional_context': this.handleReevaluateWithAdditionalContext.bind(this)
    };
  }

  /**
   * Handler for evaluate_command_security Function Call
   * This is for external API usage - returns the same evaluation logic
   */
  private async handleEvaluateCommandSecurity(
    args: EvaluateCommandSecurityArgs, 
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    try {
      // Validate required arguments
      if (!args.command || typeof args.command !== 'string') {
        throw new Error('Missing or invalid command parameter');
      }
      
      if (!args.working_directory || typeof args.working_directory !== 'string') {
        throw new Error('Missing or invalid working_directory parameter');
      }

      // For external API calls, we should use the same evaluation logic
      // but avoid infinite recursion by using basic analysis directly
      const basicAnalysis = this.securityManager.analyzeCommandSafety(args.command.trim());

      const simplifiedResult: SimplifiedLLMEvaluationResult = {
        evaluation_result: basicAnalysis.classification === 'basic_safe' ? 'allow' : 'user_confirm',
        reasoning: basicAnalysis.reasoning,
        requires_additional_context: {
          command_history_depth: 0,
          execution_results_count: 0,
          user_intent_search_keywords: null,
          user_intent_question: null
        },
        suggested_alternatives: basicAnalysis.dangerous_patterns ? [
          'Consider using a safer alternative command'
        ] : []
      };

      logger.info('Function Call Security Evaluation', {
        function_name: 'evaluate_command_security',
        command: args.command,
        working_directory: args.working_directory,
        evaluation_result: simplifiedResult.evaluation_result,
        reasoning: basicAnalysis.reasoning,
        execution_time_ms: 45
      }, 'function-call');

      return {
        success: true,
        result: simplifiedResult,
        context: context
      };
    } catch (error) {
      logger.error('Function Call Security Evaluation failed', {
        function_name: 'evaluate_command_security',
        error: error instanceof Error ? error.message : String(error),
        attempted_arguments: JSON.stringify(args)
      }, 'function-call');

      return {
        success: false,
        error: `Security evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        context: context
      };
    }
  }

  /**
   * Handler for reevaluate_with_user_intent Function Call
   * This performs reevaluation with user intent context
   */
  private async handleReevaluateWithUserIntent(
    args: ReevaluateWithUserIntentArgs, 
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    try {
      // Enhanced evaluation with user intent consideration
      const enhancedContext = `${args.additional_context || ''}\nUser Intent: ${args.user_intent}\nPrevious Evaluation: ${args.previous_evaluation.reasoning}`;
      
      const reevaluationResult = await this.performLLMCentricEvaluation(
        args.command,
        args.working_directory,
        [], // Empty history for function call context
        enhancedContext
      );

      // Convert result format
      const simplifiedResult: SimplifiedLLMEvaluationResult = {
        evaluation_result: reevaluationResult.evaluation_result,
        reasoning: reevaluationResult.reasoning,
        requires_additional_context: {
          command_history_depth: 0,
          execution_results_count: 0,
          user_intent_search_keywords: null,
          user_intent_question: null
        },
        suggested_alternatives: ('suggested_alternatives' in reevaluationResult) ? reevaluationResult.suggested_alternatives || [] : []
      };

      logger.info('Function Call User Intent Reevaluation', {
        command: args.command,
        user_intent: args.user_intent,
        previous_result: args.previous_evaluation.evaluation_result,
        new_result: simplifiedResult.evaluation_result
      }, 'function-call');

      return {
        success: true,
        result: simplifiedResult,
        context: context
      };
    } catch (error) {
      logger.error('Function Call User Intent Reevaluation failed', {
        function_name: 'reevaluate_with_user_intent',
        error: error instanceof Error ? error.message : String(error),
        attempted_arguments: JSON.stringify(args)
      }, 'function-call');
      return {
        success: false,
        error: `User intent reevaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        context: context
      };
    }
  }

  /**
   * Handler for reevaluate_with_additional_context Function Call
   * This performs reevaluation with additional command history and execution results
   */
  private async handleReevaluateWithAdditionalContext(
    args: ReevaluateWithAdditionalContextArgs, 
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    try {
      // Build enhanced context from history and execution results
      let enhancedContext = args.additional_context || '';
      
      if (args.command_history && args.command_history.length > 0) {
        enhancedContext += `\nCommand History: ${args.command_history.join(', ')}`;
      }
      
      if (args.execution_results && args.execution_results.length > 0) {
        enhancedContext += `\nExecution Results: ${args.execution_results.join('; ')}`;
      }

      const reevaluationResult = await this.performLLMCentricEvaluation(
        args.command,
        args.working_directory,
        [], // Empty history for function call context
        enhancedContext
      );

      // Convert result format
      const simplifiedResult: SimplifiedLLMEvaluationResult = {
        evaluation_result: reevaluationResult.evaluation_result,
        reasoning: reevaluationResult.reasoning,
        requires_additional_context: {
          command_history_depth: 0,
          execution_results_count: 0,
          user_intent_search_keywords: null,
          user_intent_question: null
        },
        suggested_alternatives: ('suggested_alternatives' in reevaluationResult) ? reevaluationResult.suggested_alternatives || [] : []
      };

      logger.info('Function Call Additional Context Reevaluation', {
        command: args.command,
        context_length: enhancedContext.length,
        result: simplifiedResult.evaluation_result
      }, 'function-call');

      return {
        success: true,
        result: simplifiedResult,
        context: context
      };
    } catch (error) {
      logger.error('Function Call Additional Context Reevaluation failed', {
        function_name: 'reevaluate_with_additional_context',
        error: error instanceof Error ? error.message : String(error),
        attempted_arguments: JSON.stringify(args)
      }, 'function-call');
      return {
        success: false,
        error: `Additional context reevaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        context: context
      };
    }
  }

  /**
   * Execute a Function Call by looking up the handler and calling it
   */
  private async executeFunctionCall(
    functionName: string, 
    args: unknown, 
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    const handler = this.functionCallHandlers[functionName as keyof FunctionCallHandlerRegistry];
    
    if (!handler) {
      return {
        success: false,
        error: `No handler found for function: ${functionName}`
      };
    }

    try {
      // Type-safe handler invocation with explicit casting
      return await (handler as (args: unknown, context: FunctionCallContext) => Promise<FunctionCallResult>)(args, context);
    } catch (error) {
      logger.error(`Handler execution failed for function ${functionName}:`, { error: error instanceof Error ? error.message : String(error) });
      return {
        success: false,
        error: `Handler execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Public method for testing Function Call execution
   * Execute a Function Call with OpenAI-style function call object
   */
  async executeTestFunctionCall(
    functionCall: { name: string; arguments: string },
    context: FunctionCallContext
  ): Promise<FunctionCallResult> {
    try {
      const args = JSON.parse(functionCall.arguments);
      return await this.executeFunctionCall(functionCall.name, args, context);
    } catch (error) {
      logger.error('Failed to parse function call arguments for test function call:', { error: error instanceof Error ? error.message : String(error) });
      return {
        success: false,
        error: `Failed to parse function call arguments: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get the function call registry for testing
   */
  getFunctionCallRegistry(): Map<string, FunctionCallHandler> {
    return new Map(Object.entries(this.functionCallHandlers));
  }

  /**
   * Simple LLM-centric command safety evaluation
   */
  async evaluateCommandSafety(
    command: string,
    workingDirectory: string,
    history: CommandHistoryEntry[],
    comment?: string,
    forceUserConfirm?: boolean
  ): Promise<SafetyEvaluationResult> {
    const llmResult = await this.performLLMCentricEvaluation(
      command,
      workingDirectory,
      history,
      comment,
      forceUserConfirm
    );
    
    // Direct conversion from LLMEvaluationResult to SafetyEvaluationResult
    const elicitationResult = llmResult.elicitationResult;
    return this.convertLLMResultToSafetyResult(llmResult, 'llm_required', elicitationResult);
  }

  /**
   * Handle elicitation and add result to messages
   */
  private async handleElicitationInLoop(
    command: string,
    question: string,
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
      timestamp?: string;
      type?: 'history' | 'elicitation' | 'execution_result' | 'user_response';
    }>
  ): Promise<{
    userIntent: UserIntentData | null;
    elicitationResponse: ElicitationResponse | null;
    elicitationResult?: ElicitationResult;
  }> {
    if (!this.securityManager.getEnhancedConfig().elicitation_enabled && !this.llmSecurityConfig.elicitationEnabled) { // Check both
      logger.warn('User intent elicitation is disabled in config');
      return { userIntent: null, elicitationResponse: null };
    }

    if (!this.mcpServer) {
      throw new Error('MCP server not available for elicitation');
    }

    const shellBlock = `\`\`\`shell\n${command}\n\`\`\``;
    const elicitationMessage = userIntentQuestion 
      ? `🔐 SECURITY CONFIRMATION REQUIRED\n\nCommand:\n${shellBlock}\n\n${userIntentQuestion}`
      : `🔐 SECURITY CONFIRMATION REQUIRED\n\nCommand:\n${shellBlock}\n\nThis command has been flagged for review. Please provide your intent:\n\n- What are you trying to accomplish?\n- Why is this specific command needed?\n- Are you sure this is what you want to execute?`;

    const elicitationSchema: ElicitationSchema = {
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          title: 'Execute this command?',
          description: "Select 'Yes' if you understand the risks and want to proceed",
        },
        reason: {
          type: 'string',
          title: 'Why do you need to run this command?',
          description: 'Briefly explain your intent',
        },
      },
      required: ['confirmed'],
    };

    const startTime = Date.now();
    const timestamp = getCurrentTimestamp();

    try {
      const requestPayload = {
        method: 'elicitation/create',
        params: {
          message: elicitationMessage,
          requestedSchema: elicitationSchema,
          timeoutMs: 180000,
          level: 'question',
        },
      };

      const response = await this.mcpServer.request(requestPayload, ElicitResultSchema);
      const endTime = Date.now();
      const duration = endTime - startTime;

      if (response && typeof response === 'object' && 'action' in response) {
        const result = response as { action: string; content?: Record<string, unknown> };

        const elicitationResult: ElicitationResult = {
          question_asked: elicitationMessage,
          timestamp,
          timeout_duration_ms: duration,
          status: 'timeout',  // Will be updated based on actual response
          user_response: result.content,
        };

        if (result.action === 'accept' && result.content) {
          const confirmed = result.content['confirmed'] as boolean;
          const reason = (result.content['reason'] as string) || 'No reason provided';

          const userIntent: UserIntentData = {
            intent: `Execute command: ${command}`,
            justification: reason,
            timestamp: getCurrentTimestamp(),
            confidence_level: confirmed ? 'high' : 'low',
            elicitation_id: generateId(),
          };

          elicitationResult.status = confirmed ? 'confirmed' : 'declined';
          elicitationResult.comment = confirmed 
            ? 'User confirmed command execution' 
            : 'User declined command execution';

          return {
            userIntent,
            elicitationResponse: { 
              action: 'accept',  // User accepted elicitation process
              content: { ...result.content, command_execution_approved: confirmed }  // Add clear execution decision
            },
            elicitationResult,
          };
        } else {
          elicitationResult.status = result.action === 'decline' ? 'declined' : 'canceled';
          elicitationResult.comment = result.action === 'decline' 
            ? 'User declined elicitation process' 
            : 'User canceled elicitation process';

          return {
            userIntent: null,
            elicitationResponse: { action: result.action as 'decline' | 'cancel' },
            elicitationResult,
          };
        }
      }

      throw new Error('Invalid elicitation response format');
    } catch (error) {
      logger.error('User intent elicitation failed:', { error: error instanceof Error ? error.message : String(error) });
      const endTime = Date.now();
      const duration = endTime - startTime;

      const elicitationResult: ElicitationResult = {
        status: 'timeout',
        question_asked: elicitationMessage,
        timestamp,
        timeout_duration_ms: duration,
        comment: `Elicitation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };

      return { 
        userIntent: null, 
        elicitationResponse: null,
        elicitationResult,
      };
    }
  }

  /**
   * Convert LLMEvaluationResult directly to SafetyEvaluationResult using factory pattern
   */
  private convertLLMResultToSafetyResult(
    llmResult: LLMEvaluationResult,
    _classification: string,
    elicitationResult?: ElicitationResult
  ): SafetyEvaluationResult {
    switch (llmResult.evaluation_result) {
      case 'allow':
        return SafetyEvaluationResultFactory.createAllow(
          llmResult.reasoning,
          {
            llmEvaluationUsed: true,
            suggestedAlternatives: llmResult.suggested_alternatives,
            elicitationResult,
          }
        );
      
      case 'deny':
        return SafetyEvaluationResultFactory.createDeny(
          llmResult.reasoning,
          {
            llmEvaluationUsed: true,
            suggestedAlternatives: llmResult.suggested_alternatives,
            elicitationResult,
          }
        );
      
      case 'ai_assistant_confirm':
        if (!llmResult.next_action) {
          throw new Error('next_action is required for ai_assistant_confirm results');
        }
        return SafetyEvaluationResultFactory.createAiAssistantConfirm(
          llmResult.reasoning,
          llmResult.next_action,
          {
            llmEvaluationUsed: true,
            suggestedAlternatives: llmResult.suggested_alternatives,
            confirmationMessage: llmResult.assistant_request_message,
            elicitationResult,
          }
        );
      
      case 'user_confirm':
      case 'add_more_history':
        throw new Error(`${llmResult.evaluation_result} results are not supported in final responses. These should be handled internally.`);
      
      default:
        const exhaustiveCheck: never = llmResult;
        throw new Error(`Unexpected evaluation result in convertLLMResultToSafetyResult: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }

  /**
   * Parse 'allow' tool - command is safe to execute
   */
  private async parseAllowTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'Command allowed';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      
      return {
        evaluation_result: 'allow',
        reasoning: expandedReasoning,
        suggested_alternatives: []
      };
    } catch (error) {
      logger.error('Failed to parse allow tool', { error, command });
      throw error;
    }
  }

  /**
   * Parse 'deny' tool - command is too dangerous
   */
  private async parseDenyTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning', 'suggested_alternatives']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'Command denied';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      const alternatives = Array.isArray(result['suggested_alternatives']) ? result['suggested_alternatives'] : [];
      
      return {
        evaluation_result: 'deny',
        reasoning: expandedReasoning,
        suggested_alternatives: alternatives
      };
    } catch (error) {
      logger.error('Failed to parse deny tool', { error, command });
      throw error;
    }
  }

  /**
   * Parse 'user_confirm' tool - requires user confirmation
   */
  private async parseUserConfirmTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning', 'confirmation_question']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'Requires confirmation';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      const question = typeof result['confirmation_question'] === 'string' ? result['confirmation_question'] : 'Do you want to proceed?';
      
      return {
        evaluation_result: 'user_confirm',
        reasoning: expandedReasoning,
        confirmation_question: question,
        suggested_alternatives: []
      };
    } catch (error) {
      logger.error('Failed to parse user_confirm tool', { error, command });
      throw error;
    }
  }

  /**
   * Parse 'add_more_history' tool - needs additional context
   */
  private async parseAddMoreHistoryTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning', 'command_history_depth']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'Need more context';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      const historyDepth = typeof result['command_history_depth'] === 'number' ? result['command_history_depth'] : 0;
      const resultsCount = typeof result['execution_results_count'] === 'number' ? result['execution_results_count'] : 0;
      const keywords = Array.isArray(result['user_intent_search_keywords']) ? result['user_intent_search_keywords'] : [];
      
      return {
        evaluation_result: 'add_more_history',
        reasoning: expandedReasoning,
        command_history_depth: historyDepth,
        execution_results_count: resultsCount,
        user_intent_search_keywords: keywords,
        suggested_alternatives: []
      };
    } catch (error) {
      logger.error('Failed to parse add_more_history tool', { error, command });
      throw error;
    }
  }

  /**
   * Parse 'ai_assistant_confirm' tool - needs AI assistant info
   */
  private async parseAiAssistantConfirmTool(toolCall: ToolCall, command: string): Promise<LLMEvaluationResult> {
    try {
      const result = await this.parseToolArguments(toolCall, ['reasoning', 'assistant_request_message', 'next_action']);
      const reasoning = typeof result['reasoning'] === 'string' ? result['reasoning'] : 'AI assistant confirmation needed';
      const expandedReasoning = this.expandCommandVariable(reasoning, command);
      const message = typeof result['assistant_request_message'] === 'string' ? result['assistant_request_message'] : 'Please provide additional information';
      
      if (!result['next_action'] || typeof result['next_action'] !== 'object') {
        throw new Error('next_action is required for ai_assistant_confirm tool');
      }
      
      const nextActionObj = result['next_action'] as Record<string, unknown>;
      const executableCommands = Array.isArray(nextActionObj['executable_commands']) ? 
        nextActionObj['executable_commands'].filter((cmd): cmd is string => typeof cmd === 'string') : 
        undefined;
      
      const nextAction = {
        instruction: typeof nextActionObj['instruction'] === 'string' ? nextActionObj['instruction'] : 'Gather required information',
        method: typeof nextActionObj['method'] === 'string' ? nextActionObj['method'] : 'Execute provided commands',
        expected_outcome: typeof nextActionObj['expected_outcome'] === 'string' ? nextActionObj['expected_outcome'] : 'Information for security evaluation',
        ...(executableCommands && executableCommands.length > 0 && { executable_commands: executableCommands })
      };
      
      return {
        evaluation_result: 'ai_assistant_confirm',
        reasoning: expandedReasoning,
        assistant_request_message: message,
        suggested_alternatives: [],
        next_action: nextAction
      };
    } catch (error) {
      logger.error('Failed to parse ai_assistant_confirm tool', { error, command });
      throw error;
    }
  }

  /**
   * Helper: Parse and validate tool arguments with JSON repair fallback
   */
  private async parseToolArguments(toolCall: ToolCall, requiredFields: string[]): Promise<Record<string, unknown>> {
    const rawArgs = toolCall.function.arguments;
    let result;
    
    try {
      result = JSON.parse(rawArgs);
    } catch (parseError) {
      logger.warn(`JSON parse failed, attempting repair. Error: ${parseError}. Raw: ${rawArgs.substring(0, 200)}...`);
      
      const repairResult = repairAndParseJson(rawArgs);
      if (repairResult.success) {
        result = repairResult.value;
        logger.info(`JSON repair successful after ${repairResult.repairAttempts?.length || 0} attempts`);
      } else {
        throw new Error(`JSON parse and repair failed. Original error: ${parseError}. Repair attempts: ${repairResult.repairAttempts?.length || 0}. Final error: ${repairResult.finalError}`);
      }
    }
    
    const missingFields = [];
    for (const field of requiredFields) {
      if (!result[field]) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      throw new Error(`Tool call missing required fields: ${missingFields.join(', ')}. Received: ${Object.keys(result).join(', ')}`);
    }
    
    return result;
  }

  /**
   * Expand $COMMAND variable in text with the actual command
   */
  private expandCommandVariable(text: string, command: string): string {
    if (!text || !command) {
      return text || '';
    }
    
    return text.replace(/\$COMMAND/g, command);
  }

  /**
   * Validator-side criteria adjustment
   */
  async adjustValidatorCriteria(
    criteriaText: string,
    appendMode: boolean = false,
    backupExisting: boolean = true
  ): Promise<{
    success: boolean;
    message: string;
    backupPath?: string;
    criteriaPath: string;
  }> {
    logger.info('Validator adjusting security criteria', {
      appendMode,
      backupExisting,
      criteriaLength: criteriaText.length
    });

    try {
      const result = await adjustCriteria(criteriaText, appendMode, backupExisting);
      
      logger.info('Validator criteria adjustment completed', {
        success: result.success,
        criteriaPath: result.criteriaPath,
        backupPath: result.backupPath
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Validator criteria adjustment failed', { error: errorMessage });
      
      return {
        success: false,
        message: `Validator criteria adjustment failed: ${errorMessage}`,
        criteriaPath: ''
      };
    }
  }
}
