import { LoggingContext } from '../../core/logging/logging-context.js';
import { CorrelationContext } from '../../core/logging/correlation-context.js';
/**
 * SSHPromptDetector handles interactive shell prompt detection
 * - Detects various shell prompts (bash, zsh, fish, etc.)
 * - Identifies interactive states (password, yes/no, menu, etc.)
 * - Supports prompt caching
 */
export class SSHPromptDetector {
    constructor() {
        this.promptCache = new Map();
        this.CACHE_TTL = 5000; // 5 seconds
        this.loggingContext = new LoggingContext();
    }
    /**
     * Detects interactive prompts in output
     */
    detectPrompt(output) {
        const patterns = [
            // Password/passphrase prompts
            { regex: /(?:password|passphrase)[:\s]/i, type: 'password' },
            // Yes/no confirmation
            {
                regex: /(?:yes|no|continue|confirm|accept|approve|delete|overwrite)\s*[\(\[]?[yYnN]?[\)\]]?/i,
                type: 'yes_no',
            },
            // Interactive menu - select option
            { regex: /(?:select|choose|option|menu|enter choice)[:\s]/i, type: 'menu' },
            // Press any key
            { regex: /press\s+(any\s+)?key/i, type: 'any_key' },
            // Numbered menu
            { regex: /\[\s*[0-9]+\s*\]\s*$/m, type: 'numbered_menu' },
            // Username prompt
            { regex: /(?:login|username|user)[:\s]/i, type: 'username' },
            // SSH host key verification
            { regex: /(?:host\s+key|authenticity|are you sure|known hosts)/i, type: 'host_key' },
            // Two-factor authentication
            { regex: /(?:2fa|verification code|authenticator|sms code|token)[:\s]/i, type: '2fa' },
            // sudo password
            { regex: /\[sudo\]\s*password/i, type: 'sudo_password' },
            // Terminal interrupt
            { regex: /\^C\s*interrupt/i, type: 'interrupted' },
            // EOF/end of file
            { regex: /(?:end of file|ctrl\+d|ctrl\+c)/i, type: 'eof' },
        ];
        for (const pattern of patterns) {
            const match = output.match(pattern.regex);
            if (match) {
                return { detected: true, type: pattern.type, prompt: match[0] };
            }
        }
        return { detected: false };
    }
    /**
     * Checks if a prompt is detected in session output
     */
    isPromptDetected(sessionId, session) {
        const promptInfo = this.detectPrompt(session.outputBuffer);
        return promptInfo.detected;
    }
    /**
     * Waits for a prompt to be detected
     */
    async waitForPrompt(sessionId, session, timeoutMs = 5000) {
        const context = CorrelationContext.generate(undefined, undefined, sessionId);
        return CorrelationContext.runAsync(context, async () => {
            const startTime = Date.now();
            while (Date.now() - startTime < timeoutMs) {
                if (this.isPromptDetected(sessionId, session)) {
                    return;
                }
                await this.sleep(100);
            }
            this.loggingContext.warn('Prompt detection timeout', {
                sessionId,
                timeoutMs,
            });
        });
    }
    /**
     * Detects interactive prompts in output and returns structured info
     */
    detectInteractivePrompts(output) {
        return this.detectPrompt(output);
    }
    /**
     * Gets prompt information from cache or detects it
     */
    getPromptInfo(sessionId, output) {
        const cacheKey = `${sessionId}`;
        const cached = this.promptCache.get(cacheKey);
        if (cached && Date.now() - Date.now() < this.CACHE_TTL) {
            return cached;
        }
        const info = this.detectPrompt(output);
        if (info.detected) {
            this.promptCache.set(cacheKey, info);
        }
        return info;
    }
    /**
     * Clears the prompt cache
     */
    clearCache() {
        this.promptCache.clear();
        this.loggingContext.debug('Prompt detector cache cleared');
    }
    // ===== PRIVATE METHODS =====
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
