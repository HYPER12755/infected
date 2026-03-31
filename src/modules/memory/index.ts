import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"; // Adapted SDK import
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
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

const createEntitiesSchema = z.object({
  entities: z.array(EntitySchema)
});

const createRelationsSchema = z.object({
  relations: z.array(RelationSchema)
});

const observationEntrySchema = z.object({
  entityName: z.string().describe("The name of the entity to add the observations to"),
  contents: z.array(z.string()).describe("An array of observation contents to add")
});

const observationInputSchema = z.object({
  observations: z.array(observationEntrySchema)
});

const observationResultsSchema = z.object({
  results: z.array(
    z.object({
      entityName: z.string(),
      addedObservations: z.array(z.string())
    })
  )
});

const deleteEntitiesSchema = z.object({
  entityNames: z.array(z.string()).describe("An array of entity names to delete")
});

const deleteSuccessSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  deleted: z.array(z.unknown()).optional(),
  notFound: z.array(z.unknown()).optional()
});

const deleteObservationsSchema = z.object({
  deletions: z.array(
    z.object({
      entityName: z.string().describe("The name of the entity containing the observations"),
      observations: z.array(z.string()).describe("An array of observations to delete")
    })
  )
});

const deleteRelationsSchema = z.object({
  relations: z.array(RelationSchema).describe("An array of relations to delete")
});

const graphSchema = z.object({
  entities: z.array(EntitySchema),
  relations: z.array(RelationSchema)
});

const searchNodesSchema = z.object({
  query: z.string().describe("The search query to match against entity names, types, and observation content")
});

const openNodesSchema = z.object({
  names: z.array(z.string()).describe("An array of entity names to retrieve")
});

const emptySchema = z.object({});

type ToolRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function createZodToolHandler<Schema extends z.ZodTypeAny>(
  schema: Schema,
  handler: (args: z.infer<Schema>) => Promise<any>
) {
  return async (rawArgs: unknown, _extra: ToolRequestExtra) => {
    const args = schema.parse(rawArgs);
    return handler(args);
  };
}

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

    // Register CreateEntities tool
    this.deregisterFunctions.push(server.registerTool(
      "CreateEntities",
      {
        title: "Create Entities",
        description: "Create multiple new entities (with metadata/tags) in the knowledge graph to capture fresh concepts, files, or resources discovered during a session.",
        inputSchema: createEntitiesSchema,
        outputSchema: createEntitiesSchema
      },
      createZodToolHandler(createEntitiesSchema, async (args) => {
        const result = await knowledgeGraphManager.createEntities(args.entities);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: { entities: result }
        };
      })
    ));

    // Register CreateRelations tool
    this.deregisterFunctions.push(server.registerTool(
      "CreateRelations",
      {
        title: "Create Relations",
        description: "Create multiple relationships between entities using active-voice descriptions so facts stay readable; useful when linking related incidents, files, or observations together.",
        inputSchema: createRelationsSchema,
        outputSchema: createRelationsSchema
      },
      createZodToolHandler(createRelationsSchema, async (args) => {
        const result = await knowledgeGraphManager.createRelations(args.relations);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: { relations: result }
        };
      })
    ));

    // Register AddObservations tool
    this.deregisterFunctions.push(server.registerTool(
      "AddObservations",
      {
        title: "Add Observations",
        description: "Add observations (timestamped facts) to existing entities so you can record outcomes, CLI outputs, or follow-up notes without redefining the entity.",
        inputSchema: observationInputSchema,
        outputSchema: observationResultsSchema
      },
      createZodToolHandler(observationInputSchema, async (args) => {
        const result = await knowledgeGraphManager.addObservations(args.observations);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: { results: result }
        };
      })
    ));

    // Register DeleteEntities tool
    this.deregisterFunctions.push(server.registerTool(
      "DeleteEntities",
      {
        title: "Delete Entities",
        description: "Delete multiple entities and their associated relations to clean up outdated or erroneous records before rebuilding your knowledge base.",
        inputSchema: deleteEntitiesSchema,
        outputSchema: deleteSuccessSchema
      },
      createZodToolHandler(deleteEntitiesSchema, async (args) => {
        const result = await knowledgeGraphManager.deleteEntities(args.entityNames);
        const message = result.notFound.length > 0
          ? `Deleted ${result.deleted.length} entities. Not found: ${result.notFound.join(', ')}`
          : `Deleted ${result.deleted.length} entities successfully`;
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent: { success: true, deleted: result.deleted, notFound: result.notFound }
        };
      })
    ));

    // Register DeleteObservations tool
    this.deregisterFunctions.push(server.registerTool(
      "DeleteObservations",
      {
        title: "Delete Observations",
        description: "Remove precise observations from entities when that data is stale or incorrect, keeping the graph focused on current facts.",
        inputSchema: deleteObservationsSchema,
        outputSchema: deleteSuccessSchema
      },
      createZodToolHandler(deleteObservationsSchema, async (args) => {
        const result = await knowledgeGraphManager.deleteObservations(args.deletions);
        const message = result.notFound.length > 0
          ? `Deleted observations from ${result.deleted.length} entities. Entities not found: ${result.notFound.join(', ')}`
          : `Deleted observations from ${result.deleted.length} entities successfully`;
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent: { success: true, deleted: result.deleted, notFound: result.notFound }
        };
      })
    ));

    // Register DeleteRelations tool
    this.deregisterFunctions.push(server.registerTool(
      "DeleteRelations",
      {
        title: "Delete Relations",
        description: "Delete multiple relations to prune incorrect links or simplify the graph before adding corrected connections.",
        inputSchema: deleteRelationsSchema,
        outputSchema: deleteSuccessSchema
      },
      createZodToolHandler(deleteRelationsSchema, async (args) => {
        const result = await knowledgeGraphManager.deleteRelations(args.relations);
        const message = result.notFound.length > 0
          ? `Deleted ${result.deleted.length} relations. Not found: ${result.notFound.length}`
          : `Deleted ${result.deleted.length} relations successfully`;
        return {
          content: [{ type: "text" as const, text: message }],
          structuredContent: { success: true, deleted: result.deleted, notFound: result.notFound }
        };
      })
    ));

    // Register ReadGraph tool
    this.deregisterFunctions.push(server.registerTool(
      "ReadGraph",
      {
        title: "Read Graph",
        description: "Read the entire knowledge graph snapshot (entities, relations, observations) for auditing, backups, or exporting summaries.",
        inputSchema: emptySchema,
        outputSchema: graphSchema
      },
      createZodToolHandler(emptySchema, async () => {
        const graph = await knowledgeGraphManager.readGraph();
        const entities = graph.entities || [];
        const relations = graph.relations || [];
        const lines: string[] = [`entities: ${entities.length}`, `relations: ${relations.length}`];
        for (const entity of entities) {
          const obs = entity.observations?.length || 0;
          lines.push(`${entity.name} [${entity.entityType}] ${obs} observations`);
        }
        for (const rel of relations) {
          lines.push(`${rel.from} --${rel.relationType}--> ${rel.to}`);
        }
        return {
          content: [{ type: "text" as const, text: lines.join('\n') }],
          structuredContent: { ...graph }
        };
      })
    ));

    // Register SearchNodes tool
    this.deregisterFunctions.push(server.registerTool(
      "SearchNodes",
      {
        title: "Search Nodes",
        description: "Search for nodes by natural-language query, type, or keyword to locate relevant facts and then load their context into the current reasoning chain.",
        inputSchema: searchNodesSchema,
        outputSchema: graphSchema
      },
      createZodToolHandler(searchNodesSchema, async (args) => {
        const graph = await knowledgeGraphManager.searchNodes(args.query);
        const entities = graph.entities || [];
        const relations = graph.relations || [];
        const lines: string[] = [`entities: ${entities.length}`, `relations: ${relations.length}`];
        for (const entity of entities) {
          const obs = entity.observations?.length || 0;
          lines.push(`${entity.name} [${entity.entityType}] ${obs} observations`);
        }
        for (const rel of relations) {
          lines.push(`${rel.from} --${rel.relationType}--> ${rel.to}`);
        }
        return {
          content: [{ type: "text" as const, text: lines.join('\n') }],
          structuredContent: { ...graph }
        };
      })
    ));

    // Register OpenNodes tool
    this.deregisterFunctions.push(server.registerTool(
      "OpenNodes",
      {
        title: "Open Nodes",
        description: "Open named nodes to fetch their full details and connected observations before editing or referencing them in the current task.",
        inputSchema: openNodesSchema,
        outputSchema: graphSchema
      },
      createZodToolHandler(openNodesSchema, async (args) => {
        const graph = await knowledgeGraphManager.openNodes(args.names);
        const entities = graph.entities || [];
        const relations = graph.relations || [];
        const lines: string[] = [`entities: ${entities.length}`, `relations: ${relations.length}`];
        for (const entity of entities) {
          const obs = entity.observations?.length || 0;
          lines.push(`${entity.name} [${entity.entityType}] ${obs} observations`);
        }
        for (const rel of relations) {
          lines.push(`${rel.from} --${rel.relationType}--> ${rel.to}`);
        }
        return {
          content: [{ type: "text" as const, text: lines.join('\n') }],
          structuredContent: { ...graph }
        };
      })
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
