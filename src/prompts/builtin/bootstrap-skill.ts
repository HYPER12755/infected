import { IUnifiedSkill, UnifiedModuleContext, UnifiedModuleManifest } from '../../core/module-system/module-types.js';
import logger from '../../core/logger.js';

const manifest: UnifiedModuleManifest = {
  id: 'skill.core.bootstrap', // Add a unique ID
  name: 'Core Bootstrap Skill',
  version: '1.0.0',
  description: 'Initializes agent behavior and provides system prompts.',
  type: 'skill', // Specify module type
  entry: 'bootstrap-skill.js', // Assuming compiled to .js
  inputs: {}, // No specific inputs for a bootstrap skill
  outputs: {
    initialized: {
      type: 'boolean',
      description: 'Indicates if the bootstrap process was successful.',
    },
  },
};

class CoreBootstrapSkill implements IUnifiedSkill {
  manifest: UnifiedModuleManifest = manifest;

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    context.logger.info('Core Bootstrap Skill loaded.', { component: 'CoreBootstrapSkill' });
    // In a real scenario, this would set up global contexts, system prompts, etc.
  }

  async execute(input: { [key: string]: any }, context: UnifiedModuleContext): Promise<any> {
    context.logger.info('Core Bootstrap Skill executed.', { component: 'CoreBootstrapSkill', input });
    // This skill might return initial system prompts or agent configuration
    return { initialized: true, message: 'Agent bootstrapped successfully.' };
  }

  async onUnload(): Promise<void> {
    // Cleanup logic if needed
    logger.info('Core Bootstrap Skill unloaded.', { component: 'CoreBootstrapSkill' });
  }

  async onError(error: Error, context: UnifiedModuleContext): Promise<void> {
    context.logger.error('Core Bootstrap Skill encountered an error.', { error, component: 'CoreBootstrapSkill' });
  }
}

export default CoreBootstrapSkill;
