import { spawn } from 'node:child_process'; // Use node:child_process
import * as fs from 'node:fs/promises';
import * as path from 'node:path'; // Use node:path
import { generateId, getCurrentTimestamp, getSafeEnvironment, sanitizeString, ensureDirectory, } from '../utils/shell-helpers.js'; // Adapted import
import { ExecutionError, ResourceNotFoundError, ResourceLimitError, } from '../utils/shell-errors.js'; // Adapted import
import { StreamPublisher } from './stream-publisher.js'; // Adapted import
import { FileStorageSubscriber } from './file-storage-subscriber.js'; // Adapted import
import { StreamingPipelineReader } from './streaming-pipeline-reader.js'; // Adapted import
import { RealtimeStreamSubscriber } from './realtime-stream-subscriber.js'; // Adapted import
import logger from './logger.js'; // Use our central logger
import { ExecutionStrategyFactory, } from './execution-strategies/index.js'; // Wave 1: ExecutionStrategy pattern
import { RetryStrategy } from './recovery/retry-strategy.js';
import { CircuitBreaker } from './recovery/circuit-breaker.js';
import { RecoveryHandler } from './recovery/recovery-handler.js';
import { ResourceError, TimeoutError as BaseTimeoutError } from './error-system/error-categories.js';
import { ProcessErrorCode, ResourceErrorCode, TimeoutErrorCode, ErrorSeverity } from './error-system/error-taxonomy.js';
// Configuration constants
const DEFAULT_PROCESS_TIMEOUT = 5000; // 5 seconds for process operations
export class ProcessManager {
    constructor(maxConcurrentProcesses = 50, outputDir = '/tmp/mcp-shell-outputs', fileManager) {
        this.executions = new Map();
        this.processes = new Map();
        this.backgroundProcessCallbacks = {}; // バックグラウンドプロセス終了コールバック
        this.enableStreaming = false; // Feature Flag
        this.recoveryHandlers = new Map();
        this.maxConcurrentProcesses = maxConcurrentProcesses;
        this.outputDir = outputDir;
        this.fileManager = fileManager;
        this.defaultWorkingDirectory = process.env['MCP_SHELL_DEFAULT_WORKDIR'] || process.cwd();
        this.allowedWorkingDirectories = process.env['MCP_SHELL_ALLOWED_WORKDIRS']
            ? process.env['MCP_SHELL_ALLOWED_WORKDIRS'].split(',').map((dir) => dir.trim())
            : [process.cwd()];
        // StreamPublisher初期化
        this.streamPublisher = new StreamPublisher({
            enableRealtimeStreaming: false, // 初期状態は無効
            bufferSize: 8192,
            notificationInterval: 100,
        });
        // Wave 1: ExecutionStrategy Factory 初期化
        this.strategyFactory = new ExecutionStrategyFactory({
            defaultTimeoutMs: 300000, // 5 minutes
            defaultKillGracePeriodMs: 5000, // 5 seconds
        });
        // Phase 2.3: Initialize recovery strategies
        this.limiterCircuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 60000,
            windowSize: 60000
        });
        this.streamingCircuitBreaker = new CircuitBreaker({
            failureThreshold: 3,
            successThreshold: 2,
            timeout: 30000,
            windowSize: 60000
        });
        this.fileIORetry = new RetryStrategy({
            maxAttempts: 3,
            initialDelayMs: 50,
            maxDelayMs: 1000,
            useJitter: true
        });
        this.terminalCreationRetry = new RetryStrategy({
            maxAttempts: 2,
            initialDelayMs: 200,
            maxDelayMs: 2000,
            useJitter: true
        });
        this.commandExecutionRecoveryHandler = new RecoveryHandler({
            enableRetry: true,
            enableCircuitBreaker: true,
            retry: {
                maxRetries: 3,
                initialDelayMs: 100,
                maxDelayMs: 5000,
                backoffMultiplier: 2,
                jitterFactor: 0.1
            },
            circuitBreaker: {
                failureThreshold: 10,
                successThreshold: 3,
                timeoutMs: 30000,
                halfOpenMaxAttempts: 1
            },
            recoveryHandlers: this.recoveryHandlers
        });
        // Register default recovery handlers
        this.registerRecoveryHandler(ProcessErrorCode.TIMEOUT, async (error, context) => {
            logger.warn(`Process timeout on attempt ${context.attempt}`, { executionPath: context.executionPath });
        });
        this.registerRecoveryHandler(ResourceErrorCode.NOT_AVAILABLE, async (error, context) => {
            logger.warn(`Resource not available, will retry on attempt ${context.attempt}`, { executionPath: context.executionPath });
        });
        // 環境変数でStreaming機能を制御（段階的展開、デフォルト有効）
        this.enableStreaming = process.env['MCP_SHELL_ENABLE_STREAMING'] !== 'false';
        if (this.enableStreaming) {
            this.initializeStreamingComponents();
        }
        this.initializeOutputDirectory();
    }
    // TerminalManager への参照を設定
    setTerminalManager(terminalManager) {
        this.terminalManager = terminalManager;
    }
    // FileManager への参照を設定
    setFileManager(fileManager) {
        this.fileManager = fileManager;
        // FileManagerが設定された時にStreaming機能を再初期化
        if (this.enableStreaming) {
            this.initializeStreamingComponents();
        }
    }
    // バックグラウンドプロセス終了時のコールバックを設定
    setBackgroundProcessCallbacks(callbacks) {
        this.backgroundProcessCallbacks = callbacks;
    }
    // Emit background process output notifications if configured
    sendBackgroundProcessOutput(executionId, data, isStderr = false) {
        this.backgroundProcessCallbacks.onOutputData?.(executionId, data, isStderr);
    }
    // Issue #13: Streaming コンポーネントの初期化
    initializeStreamingComponents() {
        if (!this.fileManager) {
            logger.error('ProcessManager: FileManager is required for streaming components');
            return;
        }
        // FileStorageSubscriber初期化（既存FileManager機能を代替）
        this.fileStorageSubscriber = new FileStorageSubscriber(this.fileManager, this.outputDir);
        this.streamPublisher.subscribe(this.fileStorageSubscriber);
        // RealtimeStreamSubscriber初期化
        this.realtimeStreamSubscriber = new RealtimeStreamSubscriber({
            bufferSize: 8192,
            notificationInterval: 100,
            maxRetentionSeconds: 3600,
            maxBuffers: 1000,
        });
        this.streamPublisher.subscribe(this.realtimeStreamSubscriber);
        logger.info('ProcessManager: Streaming components initialized');
    }
    // Issue #13: Streaming機能の有効/無効切り替え
    enableStreamingFeature(enable = true) {
        this.enableStreaming = enable;
        if (enable && this.fileManager) {
            this.initializeStreamingComponents();
        }
        else if (!enable) {
            // Streaming無効化時のクリーンアップ
            if (this.realtimeStreamSubscriber) {
                this.streamPublisher.unsubscribe(this.realtimeStreamSubscriber.id);
                this.realtimeStreamSubscriber.destroy();
                this.realtimeStreamSubscriber = undefined;
            }
            if (this.fileStorageSubscriber) {
                this.streamPublisher.unsubscribe(this.fileStorageSubscriber.id);
                this.fileStorageSubscriber = undefined;
            }
        }
    }
    // Issue #13: RealtimeStreamSubscriber への参照を取得（新しいMCPツール用）
    getRealtimeStreamSubscriber() {
        return this.realtimeStreamSubscriber;
    }
    /**
     * Issue #13: output_idから実行IDを取得
     */
    /**
     * Categorize process errors for recovery strategy selection
     */
    categorizeProcessError(error) {
        if (error instanceof BaseTimeoutError) {
            return {
                retryable: true,
                code: TimeoutErrorCode.OPERATION_TIMEOUT,
                severity: ErrorSeverity.HIGH
            };
        }
        if (error instanceof ResourceLimitError) {
            return {
                retryable: true,
                code: ResourceErrorCode.NOT_AVAILABLE,
                severity: ErrorSeverity.MEDIUM
            };
        }
        return {
            retryable: false,
            code: ProcessErrorCode.SPAWN_FAILED,
            severity: ErrorSeverity.HIGH
        };
    }
    /**
     * Register a recovery handler for a specific error code
     */
    registerRecoveryHandler(errorCode, handler) {
        this.recoveryHandlers.set(errorCode, handler);
    }
    /**
     * Invoke recovery handlers for an error
     */
    async invokeRecoveryHandlers(errorCode, error, context) {
        const handler = this.recoveryHandlers.get(errorCode);
        if (handler) {
            try {
                await handler(error, context);
            }
            catch (e) {
                logger.warn(`Recovery handler failed for error code ${errorCode}`, { error: String(e) });
            }
        }
    }
    findExecutionIdByOutputId(outputId) {
        return this.fileManager?.getExecutionIdByOutputId(outputId);
    }
    async initializeOutputDirectory() {
        await ensureDirectory(this.outputDir);
    }
    /**
     * Wave 1: Get the ExecutionStrategy for a given mode.
     * This provides access to the strategy directly if needed for advanced use cases.
     */
    getExecutionStrategy(mode) {
        return this.strategyFactory.createStrategy(mode, {
            timeoutMs: 300000, // 5 minutes
            killGracePeriodMs: 5000,
            captureStderr: true,
            maxOutputSize: 10 * 1024 * 1024,
            workingDirectory: this.defaultWorkingDirectory,
        });
    }
    async executeCommand(options) {
        // 同時実行数のチェック
        const runningProcesses = Array.from(this.executions.values()).filter((exec) => exec.status === 'running').length;
        try {
            await this.limiterCircuitBreaker.execute(async () => {
                if (runningProcesses >= this.maxConcurrentProcesses) {
                    throw new ResourceLimitError('concurrent processes', this.maxConcurrentProcesses);
                }
                return true;
            });
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('CIRCUIT_BREAKER_OPEN')) {
                throw new ResourceError('Process execution temporarily disabled due to resource limits', {
                    code: ResourceErrorCode.NOT_AVAILABLE,
                    severity: ErrorSeverity.HIGH,
                    retryable: true,
                    context: { runningProcesses, maxConcurrent: this.maxConcurrentProcesses }
                });
            }
            throw error;
        }
        // 入力データの準備 - input_output_idが指定された場合の処理
        let resolvedInputData = options.inputData;
        let inputStream = undefined;
        if (options.inputOutputId) {
            if (!this.fileManager) {
                throw new ExecutionError('FileManager is not available for input_output_id processing', {
                    inputOutputId: options.inputOutputId,
                });
            }
            // output_idから実行IDを特定
            const sourceExecutionId = this.findExecutionIdByOutputId(options.inputOutputId);
            if (sourceExecutionId && this.realtimeStreamSubscriber) {
                // 実行中プロセスの場合: StreamingPipelineReaderを使用
                const streamState = this.realtimeStreamSubscriber.getStreamState(sourceExecutionId);
                if (streamState && streamState.isActive) {
                    logger.info(`ProcessManager: Using streaming pipeline for active process ${sourceExecutionId}`);
                    inputStream = new StreamingPipelineReader(this.fileManager, this.realtimeStreamSubscriber, options.inputOutputId, sourceExecutionId);
                }
            }
            // 実行中プロセスでない場合、または失敗した場合: 従来のファイル読み取り
            if (!inputStream) {
                try {
                    logger.info(`ProcessManager: Using traditional file read for ${options.inputOutputId}`);
                    const result = await this.fileManager.readFile(options.inputOutputId, 0, 100 * 1024 * 1024, // 100MB まで読み取り
                    'utf-8');
                    resolvedInputData = result.content;
                }
                catch (error) {
                    throw new ExecutionError(`Failed to read input from output_id: ${options.inputOutputId}`, {
                        inputOutputId: options.inputOutputId,
                        originalError: String(error),
                    });
                }
            }
        }
        const executionId = generateId();
        const startTime = getCurrentTimestamp();
        // 実行情報の初期化
        const resolvedWorkingDirectory = this.resolveWorkingDirectory(options.workingDirectory);
        const executionInfo = {
            execution_id: executionId,
            command: options.command,
            status: 'running',
            working_directory: resolvedWorkingDirectory,
            default_working_directory: this.defaultWorkingDirectory,
            working_directory_changed: resolvedWorkingDirectory !== this.defaultWorkingDirectory,
            created_at: startTime,
            started_at: startTime,
        };
        if (options.environmentVariables) {
            executionInfo.environment_variables = options.environmentVariables;
        }
        this.executions.set(executionId, executionInfo);
        // 新規ターミナル作成オプションがある場合
        if (options.createTerminal && this.terminalManager) {
            try {
                const terminalOptions = {
                    sessionName: `exec-${executionId}`,
                    shellType: options.terminalShell || 'bash',
                    dimensions: options.terminalDimensions || { width: 80, height: 24 },
                    autoSaveHistory: true,
                };
                if (options.workingDirectory) {
                    terminalOptions.workingDirectory = options.workingDirectory;
                }
                if (options.environmentVariables) {
                    terminalOptions.environmentVariables = options.environmentVariables;
                }
                const terminalInfo = await this.terminalCreationRetry.execute(async () => this.terminalManager.createTerminal(terminalOptions));
                executionInfo.terminal_id = terminalInfo.terminal_id;
                // ターミナルにコマンドを送信
                this.terminalManager.sendInput(terminalInfo.terminal_id, options.command, true);
                // 実行情報を更新
                executionInfo.status = 'completed';
                executionInfo.completed_at = getCurrentTimestamp();
                this.executions.set(executionId, executionInfo);
                return executionInfo;
            }
            catch (error) {
                executionInfo.status = 'failed';
                executionInfo.completed_at = getCurrentTimestamp();
                this.executions.set(executionId, executionInfo);
                throw new ExecutionError(`Failed to create terminal: ${error}`, {
                    originalError: String(error),
                });
            }
        }
        try {
            // 実行オプションを準備
            const { inputOutputId: _inputOutputId, ...baseOptions } = options;
            const updatedOptions = {
                ...baseOptions,
                ...(resolvedInputData !== undefined && { inputData: resolvedInputData }),
            };
            // StreamingPipelineReaderがある場合は特別処理
            if (inputStream) {
                return await this.executeCommandWithInputStream(executionId, updatedOptions, inputStream);
            }
            // Wave 1: ExecutionStrategy への委譲
            const strategy = this.getExecutionStrategy(options.executionMode);
            const strategyResult = await this.commandExecutionRecoveryHandler.executeWithRecovery(() => strategy.execute(options.command, executionId), {
                circuitBreakerName: `exec-${options.executionMode}`,
                tag: executionId
            });
            // 戦略の結果をExecutionInfoに変換（後方互換性）
            return await this.convertStrategyResultToExecutionInfo(executionId, executionInfo, strategyResult, options);
        }
        catch (error) {
            // エラー時の実行情報更新
            const updatedInfo = this.executions.get(executionId);
            if (updatedInfo) {
                updatedInfo.status = 'failed';
                updatedInfo.completed_at = getCurrentTimestamp();
                this.executions.set(executionId, updatedInfo);
            }
            throw error;
        }
    }
    /**
     * Wave 1: Convert strategy execution result to ExecutionInfo for backward compatibility.
     * This ensures the public API remains unchanged while using the strategy pattern internally.
     */
    async convertStrategyResultToExecutionInfo(executionId, executionInfo, strategyResult, options) {
        const updated = { ...executionInfo };
        updated.status = strategyResult.exitCode === 0 ? 'completed' : 'failed';
        updated.exit_code = strategyResult.exitCode;
        updated.stdout = sanitizeString(strategyResult.stdout);
        updated.stderr = sanitizeString(strategyResult.stderr);
        updated.execution_time_ms = strategyResult.duration;
        updated.completed_at = getCurrentTimestamp();
        updated.output_truncated = strategyResult.outputTruncated;
        // 出力をFileManagerに保存
        if (this.fileManager && (strategyResult.stdout || strategyResult.stderr)) {
            try {
                const combinedOutput = strategyResult.stdout +
                    (options.captureStderr && strategyResult.stderr ? '\n--- STDERR ---\n' + strategyResult.stderr : '');
                const outputId = await this.fileManager.createOutputFile(combinedOutput, executionId);
                updated.output_id = outputId;
            }
            catch (error) {
                logger.error(`Failed to save output for ${executionId}:`, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        // 出力状態情報の設定
        if (strategyResult.outputTruncated) {
            this.setOutputStatus(updated, true, 'size_limit', updated.output_id);
        }
        else {
            this.setOutputStatus(updated, false, 'size_limit', updated.output_id);
        }
        this.executions.set(executionId, updated);
        return updated;
    }
    /**
     * Issue #13: StreamingPipelineReaderを使用したコマンド実行
     */
    async executeCommandWithInputStream(executionId, options, inputStream) {
        logger.info(`ProcessManager: Executing command with input stream for ${executionId}`);
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let stdout = '';
            let stderr = '';
            let outputTruncated = false;
            // 環境変数の準備
            const env = getSafeEnvironment(process.env, options.environmentVariables);
            // プロセスの起動
            const child = spawn('sh', ['-c', options.command], {
                cwd: this.resolveWorkingDirectory(options.workingDirectory),
                env,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            // StreamingPipelineReaderをSTDINに接続
            if (child.stdin) {
                inputStream.pipe(child.stdin);
            }
            inputStream.on('error', (error) => {
                logger.error(`StreamingPipelineReader error for ${executionId}:`, { error: error instanceof Error ? error.message : String(error) });
                child.kill('SIGTERM');
            });
            // StreamPublisher通知
            if (this.streamPublisher) {
                this.streamPublisher.notifyProcessStart(executionId, options.command);
            }
            // STDOUT処理
            if (child.stdout) {
                child.stdout.on('data', (data) => {
                    const chunk = data.toString();
                    if (stdout.length + chunk.length <= options.maxOutputSize) {
                        stdout += chunk;
                    }
                    else {
                        outputTruncated = true;
                    }
                    // StreamPublisher通知
                    if (this.streamPublisher) {
                        this.streamPublisher.notifyOutputData(executionId, chunk, false);
                    }
                });
            }
            // STDERR処理
            if (options.captureStderr && child.stderr) {
                child.stderr.on('data', (data) => {
                    const chunk = data.toString();
                    if (stderr.length + chunk.length <= options.maxOutputSize) {
                        stderr += chunk;
                    }
                    else {
                        outputTruncated = true;
                    }
                    // StreamPublisher通知
                    if (this.streamPublisher) {
                        this.streamPublisher.notifyOutputData(executionId, chunk, true);
                    }
                });
            }
            // プロセス終了処理
            child.on('close', async (code) => {
                const executionInfo = this.executions.get(executionId);
                if (!executionInfo) {
                    reject(new ExecutionError('Execution info not found', { executionId }));
                    return;
                }
                // 実行時間の計算
                const executionTime = Date.now() - startTime;
                // 実行情報の更新
                executionInfo.status = code === 0 ? 'completed' : 'failed';
                executionInfo.completed_at = getCurrentTimestamp();
                if (code !== null) {
                    executionInfo.exit_code = code;
                }
                executionInfo.execution_time_ms = executionTime;
                // 出力の保存
                if (this.fileManager) {
                    try {
                        const combinedOutput = stdout + (options.captureStderr ? stderr : '');
                        if (combinedOutput) {
                            const outputId = await this.fileManager.createOutputFile(combinedOutput, executionId);
                            executionInfo.output_id = outputId;
                            executionInfo.output_truncated = outputTruncated;
                        }
                    }
                    catch (error) {
                        logger.error(`Failed to save output for ${executionId}:`, { error: error instanceof Error ? error.message : String(error) });
                    }
                }
                this.executions.set(executionId, executionInfo);
                // StreamPublisher通知
                if (this.streamPublisher) {
                    this.streamPublisher.notifyProcessEnd(executionId, code);
                }
                logger.info(`Command completed: ${options.command} (exit code: ${code})`);
                resolve(executionInfo);
            });
            child.on('error', (error) => {
                logger.error(`Process error for ${executionId}:`, { error: error instanceof Error ? error.message : String(error) });
                // StreamPublisher通知
                if (this.streamPublisher) {
                    this.streamPublisher.notifyError(executionId, error);
                }
                reject(new ExecutionError(`Process error: ${error.message}`, { originalError: String(error) }));
            });
            // タイムアウト処理
            const timeout = setTimeout(() => {
                logger.warn(`Process timeout for ${executionId}`);
                child.kill('SIGTERM');
                setTimeout(() => {
                    if (!child.killed) {
                        child.kill('SIGKILL');
                    }
                }, DEFAULT_PROCESS_TIMEOUT);
            }, options.timeoutSeconds * 1000);
            child.on('close', () => {
                clearTimeout(timeout);
            });
        });
    }
    async saveOutputToFile(executionId, stdout, stderr) {
        if (!this.fileManager) {
            // FileManagerが利用できない場合は、従来の方法でファイルを保存
            const outputFileId = generateId();
            const filePath = path.join(this.outputDir, `${outputFileId}.json`);
            const outputData = {
                execution_id: executionId,
                stdout,
                stderr,
                created_at: getCurrentTimestamp(),
            };
            await fs.writeFile(filePath, JSON.stringify(outputData, null, 2), 'utf-8');
            return outputFileId;
        }
        // FileManagerを使用して出力ファイルを作成
        const combinedOutput = stdout + (stderr ? '\n--- STDERR ---\n' + stderr : '');
        return await this.fileManager.createOutputFile(combinedOutput, executionId);
    }
    /**
     * 出力状態の詳細情報を設定するヘルパー関数
     * Issue #14: Enhanced guidance messages for adaptive mode transitions
     * 改善: outputTruncated の代わりに reason ベースで状態を判定
     */
    setOutputStatus(executionInfo, actuallyTruncated, // 実際に出力が切り捨てられたか
    reason, outputId) {
        // reasonに基づいて出力状態を設定
        const needsGuidance = !!outputId; // output_idがあれば常にガイダンスを提供
        // 後方互換性のため outputTruncated を設定
        executionInfo.output_truncated =
            actuallyTruncated || reason === 'timeout' || reason === 'background_transition';
        // Issue #14: バックグラウンド移行とタイムアウトは特別扱い
        if (reason === 'background_transition') {
            executionInfo.truncation_reason = reason;
            executionInfo.output_status = {
                complete: false, // バックグラウンド実行中は未完了
                reason: reason,
                available_via_output_id: !!outputId,
                recommended_action: outputId ? 'use_read_execution_output' : undefined,
            };
            executionInfo.message = `Command moved to background execution. Use process_list to monitor progress.`;
            executionInfo.next_steps = [
                'Use process_list to check status',
                'Use read_execution_output when completed',
                'Use output_id for real-time pipeline processing',
            ];
            if (needsGuidance) {
                executionInfo.guidance = {
                    pipeline_usage: `Background process active. Use "input_output_id": "${outputId}" for real-time processing`,
                    suggested_commands: [
                        'tail -f equivalent using input_output_id for live monitoring',
                        'grep for real-time log filtering',
                        'awk for live data extraction and formatting',
                    ],
                    background_processing: {
                        status_check: 'Use process_get_execution for detailed status',
                        monitoring: 'Output_id supports real-time streaming while process runs',
                    },
                };
            }
            return;
        }
        if (reason === 'timeout') {
            executionInfo.truncation_reason = reason;
            executionInfo.output_status = {
                complete: false, // タイムアウトは未完了
                reason: reason,
                available_via_output_id: !!outputId,
                recommended_action: outputId ? 'use_read_execution_output' : undefined,
            };
            executionInfo.message = `Command timed out. ${outputId ? 'Use read_execution_output with output_id for complete results.' : 'Partial output available.'}`;
            if (needsGuidance) {
                executionInfo.next_steps = [
                    'Use read_execution_output to get complete output',
                    'Use output_id for pipeline processing with grep/sed/awk commands',
                ];
                executionInfo.guidance = {
                    pipeline_usage: `Use "input_output_id": "${outputId}" parameter for further processing`,
                    suggested_commands: [
                        'grep pattern search using input_output_id',
                        'sed text transformations using input_output_id',
                        'awk data processing using input_output_id',
                    ],
                };
            }
            return;
        }
        // 実際に出力が切り捨てられた場合
        if (actuallyTruncated) {
            executionInfo.truncation_reason = reason;
            executionInfo.output_status = {
                complete: false,
                reason: reason,
                available_via_output_id: !!outputId,
                recommended_action: outputId ? 'use_read_execution_output' : undefined,
            };
            // 状況に応じたメッセージとアクションの設定
            switch (reason) {
                case 'size_limit':
                    executionInfo.message = `Output exceeded size limit. ${outputId ? 'Complete output available via output_id.' : 'Output was truncated.'}`;
                    if (needsGuidance) {
                        executionInfo.next_steps = [
                            'Use read_execution_output to get complete output',
                            'Use output_id for streaming pipeline processing',
                        ];
                        executionInfo.guidance = {
                            pipeline_usage: `Large output detected. Use "input_output_id": "${outputId}" for efficient processing`,
                            suggested_commands: [
                                'head/tail for output sampling using input_output_id',
                                'grep for pattern matching without loading full output',
                                'wc for counting lines/words/bytes efficiently',
                            ],
                        };
                    }
                    break;
                default:
                    executionInfo.message = `Output truncated due to ${reason}. ${outputId ? 'Complete output may be available via output_id.' : ''}`;
                    if (needsGuidance) {
                        executionInfo.next_steps = [
                            'Use read_execution_output to get complete output',
                            'Use output_id for pipeline processing',
                        ];
                        executionInfo.guidance = {
                            pipeline_usage: `Use "input_output_id": "${outputId}" parameter for further processing`,
                            suggested_commands: [
                                'grep for pattern searching',
                                'sed for text transformations',
                                'awk for data processing',
                            ],
                        };
                    }
            }
        }
        else {
            // 完了した場合（切り捨てなし）
            executionInfo.output_status = {
                complete: true,
                available_via_output_id: !!outputId,
            };
            // Issue #14: Add guidance even for complete outputs to promote pipeline usage
            if (needsGuidance) {
                executionInfo.guidance = {
                    pipeline_usage: `Output saved. Use "input_output_id": "${outputId}" for further processing`,
                    suggested_commands: [
                        'grep for pattern searching',
                        'sed for text transformations',
                        'awk for data processing and formatting',
                    ],
                };
            }
        }
    }
    getExecution(executionId) {
        return this.executions.get(executionId);
    }
    listExecutions(filter) {
        let executions = Array.from(this.executions.values());
        // フィルタリング
        if (filter) {
            if (filter.status) {
                executions = executions.filter((exec) => exec.status === filter.status);
            }
            if (filter.commandPattern) {
                const pattern = new RegExp(filter.commandPattern, 'i');
                executions = executions.filter((exec) => pattern.test(exec.command));
            }
            if (filter.sessionId) {
                // セッション管理は今後実装
            }
        }
        const total = executions.length;
        // ページネーション
        if (filter?.offset || filter?.limit) {
            const offset = filter.offset || 0;
            const limit = filter.limit || 50;
            executions = executions.slice(offset, offset + limit);
        }
        return { executions, total };
    }
    async killProcess(processId, signal = 'TERM', force = false) {
        const childProcess = this.processes.get(processId);
        if (!childProcess) {
            throw new ResourceNotFoundError('process', processId.toString());
        }
        try {
            // プロセスを終了
            const signalName = signal === 'KILL' ? 'SIGKILL' : `SIG${signal}`;
            const killed = childProcess.kill(signalName);
            if (!killed && force && signal !== 'KILL') {
                // 強制終了
                childProcess.kill('SIGKILL');
            }
            // プロセスが終了するまで待機
            await new Promise((resolve) => {
                childProcess.on('close', () => resolve());
                setTimeout(() => resolve(), 5000); // 5秒でタイムアウト
            });
            this.processes.delete(processId);
            return {
                success: true,
                signal_sent: signal,
                exit_code: childProcess.exitCode || undefined,
                message: 'Process terminated successfully',
            };
        }
        catch (error) {
            return {
                success: false,
                signal_sent: signal,
                message: `Failed to kill process: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    listProcesses() {
        const processes = [];
        for (const [pid] of this.processes) {
            // 対応する実行情報を検索
            const execution = Array.from(this.executions.values()).find((exec) => exec.process_id === pid);
            if (execution) {
                const processInfo = {
                    process_id: pid,
                    execution_id: execution.execution_id,
                    command: execution.command,
                    status: execution.status,
                    created_at: execution.created_at,
                };
                if (execution.working_directory) {
                    processInfo.working_directory = execution.working_directory;
                }
                if (execution.environment_variables) {
                    processInfo.environment_variables = execution.environment_variables;
                }
                if (execution.started_at) {
                    processInfo.started_at = execution.started_at;
                }
                if (execution.completed_at) {
                    processInfo.completed_at = execution.completed_at;
                }
                processes.push(processInfo);
            }
        }
        return processes;
    }
    cleanup() {
        // 実行中のプロセスを全て終了
        for (const [, childProcess] of this.processes) {
            try {
                childProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (!childProcess.killed) {
                        childProcess.kill('SIGKILL');
                    }
                }, DEFAULT_PROCESS_TIMEOUT);
            }
            catch (error) {
                logger.error(`Failed to cleanup process:`, { error: error instanceof Error ? error.message : String(error) });
            }
        }
        this.processes.clear();
        this.executions.clear();
    }
    // ワーキングディレクトリ管理
    setDefaultWorkingDirectory(workingDirectory) {
        const previousWorkdir = this.defaultWorkingDirectory;
        // ディレクトリの検証
        if (!this.isAllowedWorkingDirectory(workingDirectory)) {
            throw new Error(`Working directory not allowed: ${workingDirectory}`);
        }
        this.defaultWorkingDirectory = workingDirectory;
        return {
            success: true,
            previous_working_directory: previousWorkdir,
            new_working_directory: workingDirectory,
            working_directory_changed: previousWorkdir !== workingDirectory,
        };
    }
    getDefaultWorkingDirectory() {
        return this.defaultWorkingDirectory;
    }
    getAllowedWorkingDirectories() {
        return [...this.allowedWorkingDirectories];
    }
    isAllowedWorkingDirectory(workingDirectory) {
        // パスの正規化を行って比較
        const normalizedPath = path.resolve(workingDirectory);
        return this.allowedWorkingDirectories.some((allowedDir) => {
            const normalizedAllowed = path.resolve(allowedDir);
            return (normalizedPath === normalizedAllowed ||
                normalizedPath.startsWith(normalizedAllowed + path.sep));
        });
    }
    resolveWorkingDirectory(workingDirectory) {
        const resolved = workingDirectory || this.defaultWorkingDirectory;
        if (!this.isAllowedWorkingDirectory(resolved)) {
            throw new Error(`Working directory not allowed: ${resolved}`);
        }
        return resolved;
    }
}
