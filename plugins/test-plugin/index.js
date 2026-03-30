import { z } from 'zod';

const schema = z.object({
  name: z.string().optional(),
});

class ExamplePlugin {
  manifest = {
    id: 'plugin.example_toolkit',
    name: 'Example Plugin',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.js',
    description: 'Registers a simple greeting tool.',
  };

  async onLoad(context) {
    context.moduleManager.registerToolExecution(
      'PluginToolGreet',
      async (args = {}) => {
        const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'world';
        const message = `Hello, ${name}!`;
        return {
          content: [{ type: 'text', text: message }],
          structuredContent: { message }
        };
      },
      'PluginToolGreet',
      'Returns a friendly greeting.',
      schema,
      this.manifest.id
    );
  }
}

export default ExamplePlugin;
