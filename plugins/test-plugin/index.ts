import { z } from 'zod';
import { IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest } from '../../src/core/module-system/module-types.js';

const schema = z.object({
  name: z.string().optional(),
});

class ExamplePlugin implements IUnifiedPlugin {
  manifest: UnifiedModuleManifest = {
    id: 'plugin.example_toolkit',
    name: 'Example Plugin',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.ts',
    description: 'Registers a simple greeting tool.',
  };

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    context.moduleManager.registerToolExecution(
      'plugin.tool_greet',
      async (args: z.infer<typeof schema>) => {
        const { name } = args;
        return { message: `Hello, ${name || 'world'}!` };
      },
      'example_plugin_greet',
      'Returns a friendly greeting.',
      schema,
      this.manifest.id
    );
  }
}

export default ExamplePlugin;
