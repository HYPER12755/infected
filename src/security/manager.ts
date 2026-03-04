import { SecurityRestrictions, SecurityMode } from '../types/shell-server/index.js'; // Adapted import
import {
  EnhancedSecurityConfig,
  DEFAULT_ENHANCED_SECURITY_CONFIG,
  DEFAULT_BASIC_SAFETY_RULES,
  CommandClassification,
  BasicSafetyRule,
} from '../types/shell-server/enhanced-security.js'; // Adapted import
import { SecurityError } from '../utils/shell-errors.js'; // Adapted import
import { isValidPath, generateId, getCurrentTimestamp } from '../utils/shell-helpers.js'; // Adapted import
import { EnhancedSafetyEvaluator } from './enhanced-evaluator.js'; // Adapted import
import { CommandHistoryManager } from '../core/enhanced-history-manager.js'; // Adapted import
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // Adapted SDK import
import logger from '../core/logger.js'; // Use our central logger
import { InfectedConfig } from '../config/index.js'; // Import InfectedConfig for llmSecurity type

const DEFAULT_LLM_SECURITY_CONFIG: InfectedConfig['llmSecurity'] = {
  enabled: false,
  provider: undefined,
  model: undefined,
  apiKey: undefined,
  elicitationEnabled: false,
  skipSafeCommands: true,
};

// Import SafetyEvaluationResult from types
import type { SafetyEvaluationResult } from '../types/shell-server/index.js'; // Adapted import

export class SecurityManager {
  private restrictions: SecurityRestrictions | null = null;
  private enhancedConfig: EnhancedSecurityConfig;
  private llmSecurityConfig: InfectedConfig['llmSecurity']; // Store llmSecurityConfig
  private basicSafetyRules: BasicSafetyRule[];
  private enhancedEvaluator?: EnhancedSafetyEvaluator;
  private historyManager?: CommandHistoryManager;
  private serverInstance?: McpServer; // To store the McpServer instance

  constructor(
    mcpShellConfig?: EnhancedSecurityConfig,
    llmSecurityConfig?: InfectedConfig['llmSecurity']
  ) {
    this.enhancedConfig = mcpShellConfig ? { ...mcpShellConfig } : { ...DEFAULT_ENHANCED_SECURITY_CONFIG };
    this.llmSecurityConfig = { ...DEFAULT_LLM_SECURITY_CONFIG, ...(llmSecurityConfig ?? {}) };
    this.basicSafetyRules = [...DEFAULT_BASIC_SAFETY_RULES];

    // Load Enhanced Security configuration from environment variables (fallback/override)
    this.loadEnhancedConfigFromEnv();

    // Consolidate LLM settings, giving precedence to llmSecurityConfig
    this.consolidateLlmSettings();

    // Set default security restrictions
    this.setDefaultRestrictions();
  }

  public setConfig(
    mcpShellConfig: EnhancedSecurityConfig,
    llmSecurityConfig: InfectedConfig['llmSecurity']
  ): void {
    this.enhancedConfig = { ...mcpShellConfig };
    this.llmSecurityConfig = { ...DEFAULT_LLM_SECURITY_CONFIG, ...(llmSecurityConfig ?? {}) };
    this.consolidateLlmSettings(); // Re-consolidate on config update
    this.setDefaultRestrictions(); // Re-set restrictions based on potentially updated config
    // If enhancedEvaluator exists, update its config as well
    if (this.enhancedEvaluator) {
        this.enhancedEvaluator.setConfig(this.enhancedConfig, this.llmSecurityConfig);
    }
  }

  private consolidateLlmSettings(): void {
    // LLM Security config from InfectedConfig takes precedence
    if (this.llmSecurityConfig.enabled !== undefined) {
        this.enhancedConfig.enhanced_mode_enabled = this.llmSecurityConfig.enabled;
        this.enhancedConfig.llm_evaluation_enabled = this.llmSecurityConfig.enabled;
    }
    if (this.llmSecurityConfig.provider) {
        this.enhancedConfig.llm_provider = this.llmSecurityConfig.provider as 'openai' | 'anthropic' | 'custom';
    }
    if (this.llmSecurityConfig.model) {
        this.enhancedConfig.llm_model = this.llmSecurityConfig.model;
    }
    if (this.llmSecurityConfig.apiKey) {
        this.enhancedConfig.llm_api_key = this.llmSecurityConfig.apiKey;
    }
    if (this.llmSecurityConfig.elicitationEnabled !== undefined) {
        this.enhancedConfig.elicitation_enabled = this.llmSecurityConfig.elicitationEnabled;
    }
    if (this.llmSecurityConfig.skipSafeCommands !== undefined) {
        this.enhancedConfig.enable_pattern_filtering = this.llmSecurityConfig.skipSafeCommands;
    }
  }

  private setDefaultRestrictions(): void {
    // Get default settings from environment variables
    const defaultMode = (process.env['MCP_SHELL_SECURITY_MODE'] as SecurityMode) || 'permissive';
    const defaultExecutionTime = parseInt(process.env['MCP_SHELL_MAX_EXECUTION_TIME'] || '300');
    const defaultMemoryMb = parseInt(process.env['MCP_SHELL_MAX_MEMORY_MB'] || '1024');
    const defaultNetworkEnabled = process.env['MCP_SHELL_ENABLE_NETWORK'] !== 'false';

    // Automatic configuration for Enhanced Mode based on defaultMode or llmSecurity.enabled
    if (defaultMode === 'enhanced' || defaultMode === 'enhanced-fast' || this.llmSecurityConfig.enabled) {
      this.enhancedConfig.enhanced_mode_enabled = true;
      this.enhancedConfig.llm_evaluation_enabled = true;

      // For enhanced-fast or if skipSafeCommands is true, enable pattern filtering
      if (defaultMode === 'enhanced-fast' || this.llmSecurityConfig.skipSafeCommands) {
        this.enhancedConfig.enable_pattern_filtering = true;
      }
    }

    this.restrictions = {
      restriction_id: generateId(),
      security_mode: defaultMode,
      max_execution_time: defaultExecutionTime, // 5 minutes
      max_memory_mb: defaultMemoryMb, // 1GB
      enable_network: defaultNetworkEnabled,
      active: true,
      configured_at: getCurrentTimestamp(),
    };
  }

  /**
   * Load enhanced security configuration from environment variables
   * (Used as fallback/initial load, will be consolidated with llmSecurityConfig)
   */
  private loadEnhancedConfigFromEnv(): void {
    // Enhanced mode (backward compatibility)
    if (process.env['MCP_SHELL_ENHANCED_MODE'] === 'true') {
      this.enhancedConfig.enhanced_mode_enabled = true;
    } else if (process.env['MCP_SHELL_ENHANCED_MODE'] === 'false') {
      this.enhancedConfig.enhanced_mode_enabled = false;
    }

    // LLM evaluation (backward compatibility)
    if (process.env['MCP_SHELL_LLM_EVALUATION'] === 'true') {
      this.enhancedConfig.llm_evaluation_enabled = true;
    } else if (process.env['MCP_SHELL_LLM_EVALUATION'] === 'false') {
      this.enhancedConfig.llm_evaluation_enabled = false;
    }

    // Safe command skip (new simplified naming)
    if (process.env['MCP_SHELL_SKIP_SAFE_COMMANDS'] === 'true') {
      this.enhancedConfig.enable_pattern_filtering = true;
    }

    // Pattern matching pre-filtering (backward compatibility)
    if (process.env['MCP_SHELL_ENABLE_PATTERN_FILTERING'] === 'true') {
      this.enhancedConfig.enable_pattern_filtering = true;
    }

    // Other enhanced security settings
    if (process.env['MCP_SHELL_ELICITATION'] === 'true') {
      this.enhancedConfig.elicitation_enabled = true;
    }

    if (process.env['MCP_SHELL_BASIC_SAFE_CLASSIFICATION'] === 'false') {
      this.enhancedConfig.basic_safe_classification = false;
    }

    // LLM provider settings from ENV
    if (process.env['MCP_SHELL_LLM_PROVIDER']) {
      this.enhancedConfig.llm_provider = process.env['MCP_SHELL_LLM_PROVIDER'] as
        | 'openai'
        | 'anthropic'
        | 'custom';
    }

    if (process.env['MCP_SHELL_LLM_MODEL']) {
      this.enhancedConfig.llm_model = process.env['MCP_SHELL_LLM_MODEL'];
    }

    if (process.env['MCP_SHELL_LLM_API_KEY']) {
      this.enhancedConfig.llm_api_key = process.env['MCP_SHELL_LLM_API_KEY'];
    }

    if (process.env['MCP_SHELL_LLM_TIMEOUT']) {
      const timeout = parseInt(process.env['MCP_SHELL_LLM_TIMEOUT']);
      if (!isNaN(timeout) && timeout > 0 && timeout <= 60) {
        this.enhancedConfig.llm_timeout_seconds = timeout;
      }
    }
  }

  setRestrictions(restrictions: Partial<SecurityRestrictions>): SecurityRestrictions {
    const newRestrictions: SecurityRestrictions = {
      restriction_id: generateId(),
      security_mode: restrictions.security_mode || this.restrictions?.security_mode || 'permissive',
      max_execution_time:
        restrictions.max_execution_time || this.restrictions?.max_execution_time || 300,
      max_memory_mb: restrictions.max_memory_mb || this.restrictions?.max_memory_mb || 1024,
      enable_network: restrictions.enable_network ?? this.restrictions?.enable_network ?? true,
      active: true,
      configured_at: getCurrentTimestamp(),
    };

    // customモードの場合のみ、詳細設定を適用
    if (newRestrictions.security_mode === 'custom') {
      if (restrictions.allowed_commands) {
        newRestrictions.allowed_commands = restrictions.allowed_commands;
      } else if (this.restrictions?.allowed_commands) {
        newRestrictions.allowed_commands = this.restrictions.allowed_commands;
      }

      if (restrictions.blocked_commands) {
        newRestrictions.blocked_commands = restrictions.blocked_commands;
      } else if (this.restrictions?.blocked_commands) {
        newRestrictions.blocked_commands = this.restrictions.blocked_commands;
      }

      if (restrictions.allowed_directories) {
        newRestrictions.allowed_directories = restrictions.allowed_directories;
      } else if (this.restrictions?.allowed_directories) {
        newRestrictions.allowed_directories = this.restrictions.allowed_directories;
      }
    }

    this.restrictions = newRestrictions;
    return newRestrictions;
  }

  getRestrictions(): SecurityRestrictions | null {
    return this.restrictions;
  }

  validateCommand(command: string): void {
    if (!this.restrictions?.active) {
      return;
    }

    switch (this.restrictions.security_mode) {
      case 'permissive':
  // permissive mode: legacy dangerous pattern blocking removed.
  // Intentionally no blocking here; rely on evaluator & downstream validation.
        break;

      case 'moderate':
  // moderate mode: legacy dangerous pattern blocking removed.
  // (Could add lightweight heuristics here in future if needed.)
        break;

      case 'enhanced':
      case 'enhanced-fast':
        // enhanced mode: Enhanced Safety Evaluator performs all validation
        // No pattern checks at validateCommand stage
        // All validation is delegated to Enhanced Safety Evaluator
        // Legacy pattern matching detection is completely skipped
        break;

      case 'restrictive':
        // restrictive mode: only allow read-only and information retrieval commands
        const restrictiveAllowedCommands = [
          // File/directory operations (read-only)
          'ls',
          'cat',
          'less',
          'more',
          'head',
          'tail',
          'file',
          'stat',
          'find',
          'locate',
          // Text processing
          'grep',
          'awk',
          'sed',
          'sort',
          'uniq',
          'wc',
          'cut',
          'tr',
          'column',
          // System information
          'pwd',
          'whoami',
          'id',
          'date',
          'uptime',
          'uname',
          'hostname',
          'ps',
          'top',
          'df',
          'du',
          'free',
          'lscpu',
          'lsblk',
          'lsusb',
          'lspci',
          // Network (read-only)
          'ping',
          'nslookup',
          'dig',
          'host',
          'netstat',
          'ss',
          'lsof',
          // Basic commands
          'echo',
          'printf',
          'which',
          'type',
          'command',
          'history',
          'env',
          'printenv',
        ];
        if (!this.isCommandAllowed(command, restrictiveAllowedCommands, [])) {
          throw new SecurityError(`Command '${command}' is not allowed in restrictive mode`, {
            command,
            allowedCommands: restrictiveAllowedCommands,
          });
        }
        break;

      case 'custom':
        // custom mode: use detailed settings
        if (
          !this.isCommandAllowed(
            command,
            this.restrictions.allowed_commands,
            this.restrictions.blocked_commands
          )
        ) {
          throw new SecurityError(`Command '${command}' is not allowed by security policy`, {
            command,
            allowedCommands: this.restrictions.allowed_commands,
            blockedCommands: this.restrictions.blocked_commands,
          });
        }
        break;
    }
  }

  validatePath(path: string): void {
    if (!this.restrictions?.active) {
      return;
    }

    if (!isValidPath(path, this.restrictions.allowed_directories)) {
      throw new SecurityError(`Path '${path}' is not accessible`, {
        path,
        allowedDirectories: this.restrictions.allowed_directories,
      });
    }
  }

  validateExecutionTime(timeoutSeconds: number): void {
    if (!this.restrictions?.active) {
      return;
    }

    if (
      this.restrictions.max_execution_time &&
      timeoutSeconds > this.restrictions.max_execution_time
    ) {
      throw new SecurityError(
        `Execution time ${timeoutSeconds}s exceeds maximum allowed ${this.restrictions.max_execution_time}s`,
        {
          requestedTime: timeoutSeconds,
          maxAllowedTime: this.restrictions.max_execution_time,
        }
      );
    }
  }

  validateMemoryUsage(memoryMb: number): void {
    if (!this.restrictions?.active) {
      return;
    }

    if (this.restrictions.max_memory_mb && memoryMb > this.restrictions.max_memory_mb) {
      throw new SecurityError(
        `Memory usage ${memoryMb}MB exceeds maximum allowed ${this.restrictions.max_memory_mb}MB`,
        {
          requestedMemory: memoryMb,
          maxAllowedMemory: this.restrictions.max_memory_mb,
        }
      );
    }
  }

  validateNetworkAccess(): void {
    if (!this.restrictions?.active) {
      return;
    }

    if (!this.restrictions.enable_network) {
      throw new SecurityError('Network access is disabled by security policy');
    }
  }

  auditCommand(command: string, workingDirectory?: string): void {
    if (
      this.restrictions?.security_mode === 'enhanced' ||
      this.restrictions?.security_mode === 'enhanced-fast' ||
      this.llmSecurityConfig.enabled // Check llmSecurity.enabled for enhanced mode behavior
    ) {
      this.validateCommand(command);

      if (workingDirectory) {
        this.validatePath(workingDirectory);
      }
      return;
    }

    this.validateCommand(command);

    if (workingDirectory) {
      this.validatePath(workingDirectory);
    }
  }

  private isCommandAllowed(
    command: string,
    allowedCommands?: string[],
    blockedCommands?: string[]
  ): boolean {
    const cmdName = command.trim().split(/\s+/)[0];

    if (!cmdName) {
      return false;
    }

    if (blockedCommands && blockedCommands.length > 0) {
      if (blockedCommands.some((blocked) => cmdName === blocked || cmdName.startsWith(blocked))) {
        return false;
      }
    }

    if (allowedCommands && allowedCommands.length > 0) {
      return allowedCommands.some((allowed) => cmdName === allowed || cmdName.startsWith(allowed));
    }

    return true;
  }

  setEnhancedConfig(config: Partial<EnhancedSecurityConfig>): void {
    this.enhancedConfig = { ...this.enhancedConfig, ...config };
  }

  getEnhancedConfig(): EnhancedSecurityConfig {
    return { ...this.enhancedConfig };
  }

  setBasicSafetyRules(rules: BasicSafetyRule[]): void {
    this.basicSafetyRules = [...rules];
  }

  getBasicSafetyRules(): BasicSafetyRule[] {
    return [...this.basicSafetyRules];
  }

  isEnhancedModeEnabled(): boolean {
    const enabled = this.enhancedConfig.enhanced_mode_enabled || this.llmSecurityConfig.enabled; // Check both
    logger.info('isEnhancedModeEnabled() called:', { enabled });
    return enabled;
  }

  isLLMEvaluationEnabled(): boolean {
    return this.enhancedConfig.llm_evaluation_enabled || this.llmSecurityConfig.enabled; // Check both
  }

  isCommandHistoryEnhanced(): boolean {
    return this.enhancedConfig.command_history_enhanced;
  }

  analyzeCommandSafety(command: string): {
    classification: CommandClassification;
    reasoning: string;
    safety_level?: number;
    matched_rule?: string;
    dangerous_patterns?: string[];
  } {
    const trimmedCommand = command.trim();

    if (!this.enhancedConfig.basic_safe_classification) {
      return {
        classification: 'llm_required',
        reasoning: 'Basic safety classification is disabled',
      };
    }

    if (!trimmedCommand) {
      return {
        classification: 'basic_safe',
        reasoning: 'Empty command',
        safety_level: 1,
      };
    }

    for (const rule of this.basicSafetyRules) {
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(trimmedCommand)) {
          return {
            classification: rule.safety_level <= 3 ? 'basic_safe' : 'llm_required',
            reasoning: rule.reasoning,
            safety_level: rule.safety_level,
            matched_rule: rule.pattern,
          };
        }
      } catch (e) {
        logger.warn(`Invalid regex pattern in basic safety rule: ${rule.pattern}`, { error: e instanceof Error ? e.message : String(e) });
        continue;
      }
    }

    return {
      classification: 'llm_required',
      reasoning: 'No matching safety rule found - requires LLM evaluation',
      safety_level: 4,
    };
  }

  initializeEnhancedEvaluator(historyManager: CommandHistoryManager, server: McpServer): void { // Ensure server is always passed
    this.serverInstance = server; // Store server instance
    if (this.enhancedConfig.enhanced_mode_enabled || this.llmSecurityConfig.enabled) { // Check both
      this.historyManager = historyManager;

      // Create enhanced evaluator with server for automatic createMessage setup
      // Pass both enhancedConfig and llmSecurityConfig
      this.enhancedEvaluator = new EnhancedSafetyEvaluator(this, historyManager, this.serverInstance, this.enhancedConfig, this.llmSecurityConfig);

      // The mcpServer is already set in the constructor of EnhancedSafetyEvaluator
    }
  }

  async evaluateCommandSafetyByEnhancedEvaluator(
    command: string,
    workingDirectory: string,
    comment?: string,
    forceUserConfirm?: boolean
  ): Promise<SafetyEvaluationResult> {
    if (!this.isEnhancedModeEnabled()) { // Use isEnhancedModeEnabled() for consistency
      throw new Error('Enhanced mode is not enabled');
    }

    if (!this.enhancedEvaluator) {
      throw new Error('Enhanced evaluator not initialized');
    }
    
    // Get recent command history for context
    const history = this.historyManager ? this.historyManager.searchHistory({ limit: 10 }) : [];
    
    logger.debug(`Enhanced Evaluator - Command: ${command}`);
    logger.debug(`Enhanced Evaluator - History entries: ${history.length}`);
    logger.debug(`Enhanced Evaluator - History commands: ${history.map((h: { command: string }) => h.command).join(', ')}`);
    
    return await this.enhancedEvaluator.evaluateCommandSafety(command, workingDirectory, history, comment, forceUserConfirm);
  }
}
