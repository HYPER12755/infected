import logger from './logger.js';
export class PermissionManager {
    constructor(config) {
        this.config = config;
    }
    setConfig(config) {
        this.config = config;
    }
    /**
     * Checks if a given tool is allowed to be executed based on configured permissions.
     *
     * @param toolName The name of the tool to check.
     * @returns True if the tool is allowed, false otherwise.
     */
    check(toolName) {
        const { defaultPolicy, toolAllowlist, toolBlocklist } = this.config.permissions;
        // 1. Check blocklist (highest precedence)
        if (toolBlocklist.includes(toolName)) {
            logger.warn(`Tool '${toolName}' is blocked by toolBlocklist.`);
            return false;
        }
        // 2. Check allowlist
        if (toolAllowlist.includes(toolName)) {
            logger.debug(`Tool '${toolName}' is allowed by toolAllowlist.`);
            return true;
        }
        // 3. Apply default policy
        if (defaultPolicy === 'allow') {
            logger.debug(`Tool '${toolName}' is allowed by default policy (allow).`);
            return true;
        }
        else { // defaultPolicy === 'deny'
            logger.warn(`Tool '${toolName}' is denied by default policy (deny).`);
            return false;
        }
    }
}
