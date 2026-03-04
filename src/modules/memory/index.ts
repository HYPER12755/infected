import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"; // Adapted SDK import
import { z } from "zod";
import { Module, InfectedConfig, ManagerInstances } from '../../types/index.js'; // Adjusted path for types and ManagerInstances
import logger from '../../core/logger.js'; // Import the new logger
import {
  Entity,
  Relation,
  KnowledgeGraph,
  KnowledgeGraphManager,
  ensureMemoryFilePath,
  defaultMemoryPath,
  EntitySchema,
  RelationSchema
} from './memory-core.js'; // Import from new memory-core.ts

export class MemoryModule implements Module {
  name = 'memory';
  private deregisterFunctions: any[] = []; // Store SDK tool handles/deregister functions

  async register(server: McpServer, config: InfectedConfig, managers: ManagerInstances): Promise<void> {
    logger.info(`  MemoryModule: Registering with config: ${JSON.stringify(config.memory)}`);

    // Initialize memory file path
    // If config.memory?.filePath is undefined, defaultMemoryPath will be used.
    // ensureMemoryFilePath handles backward compatibility and ensures the file exists.
    const memoryFilePath = await ensureMemoryFilePath(config.memory?.filePath);
    const knowledgeGraphManager = new KnowledgeGraphManager(memoryFilePath);

    // Register create_entities tool
    this.deregisterFunctions.push(server.registerTool(
      "create_entities",
      {
        title: "Create Entities",
        description: "Create multiple new entities in the knowledge graph",
        inputSchema: {
          entities: z.array(EntitySchema)
        },
        outputSchema: {
          entities: z.array(EntitySchema)
        }
      },
      async ({ entities }) => {
        const result = await knowledgeGraphManager.createEntities(entities);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: { entities: result }
        };
      }
    ));

    // Register create_relations tool
    this.deregisterFunctions.push(server.registerTool(
      "create_relations",
      {
        title: "Create Relations",
        description: "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
        inputSchema: {
          relations: z.array(RelationSchema)
        },
        outputSchema: {
          relations: z.array(RelationSchema)
        }
      },
      async ({ relations }) => {
        const result = await knowledgeGraphManager.createRelations(relations);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: { relations: result }
        };
      }
    ));

    // Register add_observations tool
    this.deregisterFunctions.push(server.registerTool(
      "add_observations",
      {
        title: "Add Observations",
        description: "Add new observations to existing entities in the knowledge graph",
        inputSchema: {
          observations: z.array(z.object({
            entityName: z.string().describe("The name of the entity to add the observations to"),
            contents: z.array(z.string()).describe("An array of observation contents to add")
          }))
        },
        outputSchema: {
          results: z.array(z.object({
            entityName: z.string(),
            addedObservations: z.array(z.string())
          }))
        }
      },
      async ({ observations }) => {
        const result = await knowledgeGraphManager.addObservations(observations);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: { results: result }
        };
      }
    ));

    // Register delete_entities tool
    this.deregisterFunctions.push(server.registerTool(
      "delete_entities",
      {
        title: "Delete Entities",
        description: "Delete multiple entities and their associated relations from the knowledge graph",
        inputSchema: {
          entityNames: z.array(z.string()).describe("An array of entity names to delete")
        },
        outputSchema: {
          success: z.boolean(),
          message: z.string()
        }
      },
      async ({ entityNames }) => {
        await knowledgeGraphManager.deleteEntities(entityNames);
        return {
          content: [{ type: "text" as const, text: "Entities deleted successfully" }],
          structuredContent: { success: true, message: "Entities deleted successfully" }
        };
      }
    ));

    // Register delete_observations tool
    this.deregisterFunctions.push(server.registerTool(
      "delete_observations",
      {
        title: "Delete Observations",
        description: "Delete specific observations from entities in the knowledge graph",
        inputSchema: {
          deletions: z.array(z.object({
            entityName: z.string().describe("The name of the entity containing the observations"),
            observations: z.array(z.string()).describe("An array of observations to delete")
          }))
        },
        outputSchema: {
          success: z.boolean(),
          message: z.string()
        }
      },
      async ({ deletions }) => {
        await knowledgeGraphManager.deleteObservations(deletions);
        return {
          content: [{ type: "text" as const, text: "Observations deleted successfully" }],
          structuredContent: { success: true, message: "Observations deleted successfully" }
        };
      }
    ));

    // Register delete_relations tool
    this.deregisterFunctions.push(server.registerTool(
      "delete_relations",
      {
        title: "Delete Relations",
        description: "Delete multiple relations from the knowledge graph",
        inputSchema: {
          relations: z.array(RelationSchema).describe("An array of relations to delete")
        },
        outputSchema: {
          success: z.boolean(),
          message: z.string()
        }
      },
      async ({ relations }) => {
        await knowledgeGraphManager.deleteRelations(relations);
        return {
          content: [{ type: "text" as const, text: "Relations deleted successfully" }],
          structuredContent: { success: true, message: "Relations deleted successfully" }
        };
      }
    ));

    // Register read_graph tool
    this.deregisterFunctions.push(server.registerTool(
      "read_graph",
      {
        title: "Read Graph",
        description: "Read the entire knowledge graph",
        inputSchema: {},
        outputSchema: {
          entities: z.array(EntitySchema),
          relations: z.array(RelationSchema)
        }
      },
      async () => {
        const graph = await knowledgeGraphManager.readGraph();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(graph, null, 2) }],
          structuredContent: { ...graph }
        };
      }
    ));

    // Register search_nodes tool
    this.deregisterFunctions.push(server.registerTool(
      "search_nodes",
      {
        title: "Search Nodes",
        description: "Search for nodes in the knowledge graph based on a query",
        inputSchema: {
          query: z.string().describe("The search query to match against entity names, types, and observation content")
        },
        outputSchema: {
          entities: z.array(EntitySchema),
          relations: z.array(RelationSchema)
        }
      },
      async ({ query }) => {
        const graph = await knowledgeGraphManager.searchNodes(query);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(graph, null, 2) }],
          structuredContent: { ...graph }
        };
      }
    ));

    // Register open_nodes tool
    this.deregisterFunctions.push(server.registerTool(
      "open_nodes",
      {
        title: "Open Nodes",
        description: "Open specific nodes in the knowledge graph by their names",
        inputSchema: {
          names: z.array(z.string()).describe("An array of entity names to retrieve")
        },
        outputSchema: {
          entities: z.array(EntitySchema),
          relations: z.array(RelationSchema)
        }
      },
      async ({ names }) => {
        const graph = await knowledgeGraphManager.openNodes(names);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(graph, null, 2) }],
          structuredContent: { ...graph }
        };
      }
    ));
  }

  async shutdown(): Promise<void> {
    logger.info('  MemoryModule: Shutting down, deregistering tools...');
    this.deregisterFunctions.forEach((deregister) => {
      if (typeof deregister === 'function') {
        deregister();
      } else if (deregister && typeof deregister.remove === 'function') {
        deregister.remove();
      }
    });
    this.deregisterFunctions = []; // Clear the array
    logger.info('  MemoryModule: All tools deregistered.');
  }
}

export default MemoryModule;
