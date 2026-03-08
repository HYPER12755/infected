import { z } from "zod";
import { promises as fs } from 'node:fs'; // Use node:fs/promises
import * as path from 'node:path'; // Use node:path
import { fileURLToPath } from 'node:url'; // Use node:url
import logger from '../../core/logger.js'; // Use our central logger
import { resolveRuntimePath } from '../../utils/runtime-roots.js';
// Define memory file path in runtime workspace by default
export const defaultMemoryPath = resolveRuntimePath('.infected/memory.jsonl');
async function ensureStorageFile(filePath) {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    try {
        await fs.access(filePath);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile(filePath, '', 'utf-8');
            return;
        }
        throw error;
    }
}
// Handle backward compatibility: migrate memory.json to memory.jsonl if needed
export async function ensureMemoryFilePath(customPath) {
    const runtimeRoot = resolveRuntimePath();
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const resolveConfiguredPath = (inputPath) => path.isAbsolute(inputPath) ? path.resolve(inputPath) : resolveRuntimePath(inputPath);
    if (customPath && customPath.length > 0) {
        const target = resolveConfiguredPath(customPath);
        await ensureStorageFile(target);
        return target;
    }
    if (process.env.MEMORY_FILE_PATH) {
        const target = resolveConfiguredPath(process.env.MEMORY_FILE_PATH);
        await ensureStorageFile(target);
        return target;
    }
    // No custom path set, check for backward compatibility migration
    const oldMemoryCandidates = [
        path.join(runtimeRoot, '.infected/memory.json'),
        path.join(moduleDir, 'memory.json')
    ];
    const newMemoryPath = defaultMemoryPath;
    try {
        // Check for legacy memory.json and migrate if needed.
        for (const oldMemoryPath of oldMemoryCandidates) {
            try {
                await fs.access(oldMemoryPath);
                try {
                    await fs.access(newMemoryPath);
                    break;
                }
                catch {
                    await fs.mkdir(path.dirname(newMemoryPath), { recursive: true });
                    logger.warn('DETECTED: Found legacy memory.json file, migrating to memory.jsonl for JSONL format compatibility');
                    await fs.rename(oldMemoryPath, newMemoryPath);
                    logger.info('COMPLETED: Successfully migrated memory.json to memory.jsonl');
                    break;
                }
            }
            catch {
                // Continue checking other candidate paths.
            }
        }
        await ensureStorageFile(newMemoryPath);
        return newMemoryPath;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            await ensureStorageFile(newMemoryPath);
            return newMemoryPath;
        }
        logger.error('Error during memory file path ensureance:', { error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}
// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
export class KnowledgeGraphManager {
    constructor(memoryFilePath) {
        this.memoryFilePath = memoryFilePath;
    }
    async loadGraph() {
        try {
            const data = await fs.readFile(this.memoryFilePath, "utf-8");
            const lines = data.split("\n").filter(line => line.trim() !== "");
            return lines.reduce((graph, line) => {
                const item = JSON.parse(line);
                if (item.type === "entity") {
                    graph.entities.push({
                        name: item.name,
                        entityType: item.entityType,
                        observations: item.observations
                    });
                }
                if (item.type === "relation") {
                    graph.relations.push({
                        from: item.from,
                        to: item.to,
                        relationType: item.relationType
                    });
                }
                return graph;
            }, { entities: [], relations: [] });
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === "ENOENT") {
                return { entities: [], relations: [] };
            }
            logger.error('Failed to load knowledge graph:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }
    async saveGraph(graph) {
        const lines = [
            ...graph.entities.map(e => JSON.stringify({
                type: "entity",
                name: e.name,
                entityType: e.entityType,
                observations: e.observations
            })),
            ...graph.relations.map(r => JSON.stringify({
                type: "relation",
                from: r.from,
                to: r.to,
                relationType: r.relationType
            })),
        ];
        await fs.writeFile(this.memoryFilePath, lines.join("\n"));
    }
    async createEntities(entities) {
        const errors = [];
        // Validate entities
        for (const entity of entities) {
            if (!entity.name || typeof entity.name !== 'string' || entity.name.trim() === '') {
                errors.push('Entity name is required and must be a non-empty string');
            }
            if (!entity.entityType || typeof entity.entityType !== 'string') {
                errors.push(`Entity "${entity.name}": entityType is required`);
            }
            if (!Array.isArray(entity.observations)) {
                errors.push(`Entity "${entity.name}": observations must be an array`);
            }
        }
        if (errors.length > 0) {
            throw new Error(`Validation failed: ${errors.join('; ')}`);
        }
        const graph = await this.loadGraph();
        // Check for duplicates
        const duplicates = entities.filter(e => graph.entities.some(existingEntity => existingEntity.name === e.name));
        if (duplicates.length > 0) {
            throw new Error(`Entities already exist: ${duplicates.map(e => e.name).join(', ')}`);
        }
        const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name));
        graph.entities.push(...newEntities);
        await this.saveGraph(graph);
        return newEntities;
    }
    async createRelations(relations) {
        const errors = [];
        // Validate relations
        for (const relation of relations) {
            if (!relation.from || typeof relation.from !== 'string' || relation.from.trim() === '') {
                errors.push('Relation "from" is required and must be a non-empty string');
            }
            if (!relation.to || typeof relation.to !== 'string' || relation.to.trim() === '') {
                errors.push('Relation "to" is required and must be a non-empty string');
            }
            if (!relation.relationType || typeof relation.relationType !== 'string') {
                errors.push(`Relation (${relation.from} -> ${relation.to}): relationType is required`);
            }
        }
        if (errors.length > 0) {
            throw new Error(`Validation failed: ${errors.join('; ')}`);
        }
        const graph = await this.loadGraph();
        // Check if entities exist
        const missingEntities = relations.filter(r => !graph.entities.some(e => e.name === r.from) ||
            !graph.entities.some(e => e.name === r.to));
        if (missingEntities.length > 0) {
            const missing = missingEntities.map(r => !graph.entities.some(e => e.name === r.from) ? r.from : r.to).filter((v, i, a) => a.indexOf(v) === i);
            throw new Error(`Entities not found: ${missing.join(', ')}. Create entities first before creating relations.`);
        }
        // Check for duplicates
        const duplicates = relations.filter(r => graph.relations.some(existingRelation => existingRelation.from === r.from &&
            existingRelation.to === r.to &&
            existingRelation.relationType === r.relationType));
        if (duplicates.length > 0) {
            throw new Error(`Relations already exist: ${duplicates.map(r => `${r.from} --${r.relationType}--> ${r.to}`).join(', ')}`);
        }
        const newRelations = relations.filter(r => !graph.relations.some(existingRelation => existingRelation.from === r.from &&
            existingRelation.to === r.to &&
            existingRelation.relationType === r.relationType));
        graph.relations.push(...newRelations);
        await this.saveGraph(graph);
        return newRelations;
    }
    async addObservations(observations) {
        const graph = await this.loadGraph();
        const results = observations.map(o => {
            const entity = graph.entities.find(e => e.name === o.entityName);
            if (!entity) {
                throw new Error(`Entity with name ${o.entityName} not found`);
            }
            const newObservations = o.contents.filter(content => !entity.observations.includes(content));
            entity.observations.push(...newObservations);
            return { entityName: o.entityName, addedObservations: newObservations };
        });
        await this.saveGraph(graph);
        return results;
    }
    async deleteEntities(entityNames) {
        const graph = await this.loadGraph();
        const existingNames = entityNames.filter(name => graph.entities.some(e => e.name === name));
        const notFound = entityNames.filter(name => !graph.entities.some(e => e.name === name));
        graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
        graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
        await this.saveGraph(graph);
        return { deleted: existingNames, notFound };
    }
    async deleteObservations(deletions) {
        const graph = await this.loadGraph();
        const deleted = [];
        const notFound = [];
        for (const d of deletions) {
            const entity = graph.entities.find(e => e.name === d.entityName);
            if (!entity) {
                notFound.push(d.entityName);
                continue;
            }
            const beforeCount = entity.observations.length;
            entity.observations = entity.observations.filter(o => !d.observations.includes(o));
            const deletedCount = beforeCount - entity.observations.length;
            if (deletedCount > 0) {
                deleted.push({ entityName: d.entityName, observations: d.observations.slice(0, deletedCount) });
            }
        }
        await this.saveGraph(graph);
        return { deleted, notFound };
    }
    async deleteRelations(relations) {
        const graph = await this.loadGraph();
        const deleted = [];
        const notFound = [];
        for (const r of relations) {
            const exists = graph.relations.some(existing => existing.from === r.from &&
                existing.to === r.to &&
                existing.relationType === r.relationType);
            if (exists) {
                deleted.push(r);
            }
            else {
                notFound.push(r);
            }
        }
        graph.relations = graph.relations.filter(r => !relations.some(delRelation => r.from === delRelation.from &&
            r.to === delRelation.to &&
            r.relationType === delRelation.relationType));
        await this.saveGraph(graph);
        return { deleted, notFound };
    }
    async readGraph() {
        return this.loadGraph();
    }
    // Very basic search function
    async searchNodes(query) {
        const graph = await this.loadGraph();
        // Filter entities
        const filteredEntities = graph.entities.filter(e => e.name.toLowerCase().includes(query.toLowerCase()) ||
            e.entityType.toLowerCase().includes(query.toLowerCase()) ||
            e.observations.some(o => o.toLowerCase().includes(query.toLowerCase())));
        // Create a Set of filtered entity names for quick lookup
        const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
        // Filter relations to only include those between filtered entities
        const filteredRelations = graph.relations.filter(r => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to));
        const filteredGraph = {
            entities: filteredEntities,
            relations: filteredRelations,
        };
        return filteredGraph;
    }
    async openNodes(names) {
        const graph = await this.loadGraph();
        // Filter entities
        const filteredEntities = graph.entities.filter(e => names.includes(e.name));
        // Create a Set of filtered entity names for quick lookup
        const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
        // Filter relations to only include those between filtered entities
        const filteredRelations = graph.relations.filter(r => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to));
        const filteredGraph = {
            entities: filteredEntities,
            relations: filteredRelations,
        };
        return filteredGraph;
    }
}
// Zod schemas for entities and relations
export const EntitySchema = z.object({
    name: z.string().describe("The name of the entity"),
    entityType: z.string().describe("The type of the entity"),
    observations: z.array(z.string()).describe("An array of observation contents associated with the entity")
});
export const RelationSchema = z.object({
    from: z.string().describe("The name of the entity where the relation starts"),
    to: z.string().describe("The name of the entity where the relation ends"),
    relationType: z.string().describe("The type of the relation")
});
