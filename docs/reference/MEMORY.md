# Memory Module Documentation

## Purpose

The Memory module (`src/modules/memory/index.ts` and `src/modules/memory/memory-core.ts`) is a **Knowledge Graph-based persistent memory system** that enables AI assistants to maintain stateful information across conversations. It implements an entity-relation-observation model where information is stored as entities (nodes), relations (edges between nodes), and observations (facts about entities). The module persists data to a JSONL (JSON Lines) file, allowing for efficient append-only storage and easy parsing.

---

## Main Features

### 1. **Entity Management**
- Create multiple entities with name, type, and initial observations
- Entities represent distinct concepts, objects, or subjects in the knowledge graph
- Automatic duplicate detection prevents overwriting existing entities
- **Code**: `createEntities()` (memory-core.ts lines 124-130), `deleteEntities()` (memory-core.ts lines 159-164)

### 2. **Relation Management**
- Create directed relations between entities with relation types
- Relations represent connections or associations between entities (e.g., "owns", "depends_on", "located_in")
- Duplicate relation detection prevents redundant edges
- **Code**: `createRelations()` (memory-core.ts lines 132-142), `deleteRelations()` (memory-core.ts lines 177-185)

### 3. **Observation Management**
- Add new observations to existing entities
- Observations represent facts, details, or pieces of information about an entity
- Automatic deduplication within each entity's observations
- Delete specific observations from entities
- **Code**: `addObservations()` (memory-core.ts lines 144-157), `deleteObservations()` (memory-core.ts lines 166-175)

### 4. **Graph Reading**
- Read the entire knowledge graph with all entities and relations
- Returns complete graph state for full context retrieval
- **Code**: `readGraph()` (memory-core.ts lines 187-189)

### 5. **Node Search**
- Search entities by name, type, or observation content (case-insensitive)
- Returns filtered subgraph with only matching entities and their connecting relations
- Basic substring matching for flexible querying
- **Code**: `searchNodes()` (memory-core.ts lines 192-216)

### 6. **Node Retrieval**
- Open/fetch specific entities by name
- Retrieve exact entities without search matching
- Returns subgraph containing only specified entities and their relations
- **Code**: `openNodes()` (memory-core.ts lines 218-238)

### 7. **File Management**
- Automatic memory file path resolution with backward compatibility
- Legacy memory.json to memory.jsonl migration support
- Environment variable configuration support (MEMORY_FILE_PATH)
- **Code**: `ensureMemoryFilePath()` (memory-core.ts lines 11-51)

---

## How It Works

### Data Model

The module uses a **Knowledge Graph** structure:

```
Entity:
  - name: string (unique identifier)
  - entityType: string (category/type)
  - observations: string[] (facts about the entity)

Relation:
  - from: string (source entity name)
  - to: string (target entity name)
  - relationType: string (type of relationship)

KnowledgeGraph:
  - entities: Entity[]
  - relations: Relation[]
```

### Storage Format

The knowledge graph is stored in **JSONL (JSON Lines)** format:

```
{"type":"entity","name":"Alice","entityType":"person","observations":["works at Acme Corp","lives in NYC"]}
{"type":"entity","name":"Acme Corp","entityType":"company","observations":["founded in 2020"]}
{"type":"relation","from":"Alice","to":"Acme Corp","relationType":"works_at"}
```

Each line is a complete JSON object representing either an entity or a relation.

### Persistence Model

```
loadGraph() (memory-core.ts lines 75-104):
1. Read entire file content
2. Split by newlines, filter empty lines
3. Parse each line as JSON
4. Accumulate into KnowledgeGraph object
5. Return { entities: [], relations: [] }

saveGraph() (memory-core.ts lines 106-122):
1. Map entities to JSON strings with type: "entity"
2. Map relations to JSON strings with type: "relation"
3. Join all lines with newlines
4. Write to file (overwrites entire file)
```

### Module Initialization

```
register() (index.ts lines 97-267):
1. Get or create memory file path
2. Create KnowledgeGraphManager instance
3. Register 9 MCP tools
4. Each tool uses createZodToolHandler wrapper
```

---

## Important Classes, Functions, and Utilities

### Core Classes

| Class | Lines | Role |
|-------|-------|------|
| `MemoryModule` | index.ts 93-283 | Main module class implementing `Module` interface. Registers all tools and manages deregistration. |
| `KnowledgeGraphManager` | memory-core.ts 72-238 | Core class managing all knowledge graph operations. Handles loading, saving, and querying. |

### KnowledgeGraphManager Methods

| Method | Lines | Role |
|--------|-------|------|
| `loadGraph()` | 75-104 | Load entire graph from JSONL file |
| `saveGraph()` | 106-122 | Save graph to JSONL file (overwrite) |
| `createEntities()` | 124-130 | Add new entities (skip duplicates) |
| `createRelations()` | 132-142 | Add new relations (skip duplicates) |
| `addObservations()` | 144-157 | Add observations to existing entities |
| `deleteEntities()` | 159-164 | Remove entities and their relations |
| `deleteObservations()` | 166-175 | Remove specific observations |
| `deleteRelations()` | 177-185 | Remove specific relations |
| `readGraph()` | 187-189 | Return full graph |
| `searchNodes()` | 192-216 | Search by name/type/observation |
| `openNodes()` | 218-238 | Get specific entities by name |

### Utility Functions

| Function | Lines | Role |
|----------|-------|------|
| `ensureMemoryFilePath()` | 11-51 | Resolve memory file path with backward compatibility |

### Input Schemas (Zod)

| Schema | Lines | Purpose |
|--------|-------|---------|
| `createEntitiesSchema` | index.ts 18-20 | Validates array of entities |
| `createRelationsSchema` | index.ts 22-24 | Validates array of relations |
| `observationEntrySchema` | index.ts 26-29 | Single observation entry (entity + contents) |
| `observationInputSchema` | index.ts 31-33 | Multiple observation entries |
| `deleteEntitiesSchema` | index.ts 44-46 | Array of entity names to delete |
| `deleteObservationsSchema` | index.ts 53-60 | Deletion spec with entity + observations |
| `deleteRelationsSchema` | index.ts 62-64 | Array of relations to delete |
| `graphSchema` | index.ts 66-69 | Full graph (entities + relations) |
| `searchNodesSchema` | index.ts 71-73 | Search query string |
| `openNodesSchema` | index.ts 75-77 | Array of entity names |

### Zod Export Schemas (memory-core.ts)

| Schema | Lines | Purpose |
|--------|-------|---------|
| `EntitySchema` | 242-246 | Validates entity structure |
| `RelationSchema` | 248-252 | Validates relation structure |

---

## Data Flow

### Input Flow
```
Client Request (JSON with tool name and arguments)
    ↓
MCP Server routes to registered tool handler
    ↓
Zod schema validation (via createZodToolHandler)
    ↓
KnowledgeGraphManager method (e.g., createEntities)
    ↓
loadGraph() - read from JSONL file
    ↓
Modify in-memory graph
    ↓
saveGraph() - write to JSONL file
    ↓
Response formatting
    ↓
Return to client
```

### Output Flow
```
JSONL File
    ↓
loadGraph() parses lines
    ↓
KnowledgeGraph object
    ↓
Response: { content: [{type: 'text', text: JSON.stringify}], structuredContent: {...} }
    ↓
Client receives graph data
```

---

## Integration

### Module System Integration

The Memory module implements the `Module` interface:

1. **register()**: Initializes KnowledgeGraphManager, registers 9 MCP tools
2. **shutdown()**: Deregisters all tools gracefully

### MCP Tools Registered

| Tool Name | Description |
|-----------|-------------|
| `create_entities` | Create multiple new entities |
| `create_relations` | Create relations between entities |
| `add_observations` | Add observations to existing entities |
| `delete_entities` | Delete entities and their relations |
| `delete_observations` | Delete specific observations |
| `delete_relations` | Delete specific relations |
| `read_graph` | Read entire knowledge graph |
| `search_nodes` | Search nodes by query |
| `open_nodes` | Get specific nodes by name |

### Configuration

| Source | Priority | Example |
|--------|----------|---------|
| config.memory?.filePath | 1st | `/custom/path/memory.jsonl` |
| MEMORY_FILE_PATH env var | 2nd | `/data/memory.jsonl` |
| Default | 3rd | `<module-dir>/memory.jsonl` |

### Key Dependencies

| Dependency | Purpose |
|------------|---------|
| `@modelcontextprotocol/sdk` | MCP server and tool registration |
| `zod` | Input validation schemas |
| `node:fs/promises` | File I/O operations |
| `node:path` | Path manipulation |

---

## Example Workflow: Creating Entities and Relations

### Scenario: Client wants to store information about a user and their project

```
1. CREATE ENTITIES
   └─> create_entities({
         entities: [
           { name: "John", entityType: "person", observations: ["developer", "works on AI"] },
           { name: "ProjectX", entityType: "project", observations: ["machine learning", "in progress"] }
         ]
       })
   
   └─> loadGraph() - reads existing graph (empty)
   └─> Filter duplicates - none exist, add both entities
   └─> saveGraph() - writes to memory.jsonl:
       {"type":"entity","name":"John","entityType":"person","observations":["developer"]}
       {"type":"entity","name":"ProjectX","entityType":"project","observations":["machine learning","in progress"]}
   
   └─> Response: { entities: [John, ProjectX] }

2. CREATE RELATION
   └─> create_relations({
         relations: [
           { from: "John", to: "ProjectX", relationType: "works_on" }
         ]
       })
   
   └─> loadGraph() - reads entities
   └─> Filter duplicates - none exist, add relation
   └─> saveGraph() - appends:
       {"type":"relation","from":"John","to":"ProjectX","relationType":"works_on"}
   
   └─> Response: { relations: [{ from: "John", to: "ProjectX", relationType: "works_on" }] }

3. ADD OBSERVATIONS
   └─> add_observations({
         observations: [
           { entityName: "John", contents: ["located in San Francisco"] }
         ]
       })
   
   └─> loadGraph() - finds John entity
   └─> Filter duplicates - "located in San Francisco" is new
   └─> Add observation to John's observations array
   └─> saveGraph() - updates entity
   
   └─> Response: { results: [{ entityName: "John", addedObservations: ["located in San Francisco"] }] }
```

---

## Example Workflow: Querying the Knowledge Graph

### Scenario: Client wants to find all information about "ProjectX"

```
1. SEARCH NODES
   └─> search_nodes({ query: "ProjectX" })
   
   └─> loadGraph() - reads entire graph
   
   └─> Filter entities:
       - "ProjectX" matches name (case-insensitive)
       - "project" matches entityType
       - "machine learning", "in progress" match observations
   
   └─> Filter relations:
       - Keep relations where both from and to are in filtered entities
   
   └─> Response:
       {
         entities: [{ name: "ProjectX", entityType: "project", observations: [...] }],
         relations: [{ from: "John", to: "ProjectX", relationType: "works_on" }]
       }

2. READ FULL GRAPH
   └─> read_graph({})
   
   └─> loadGraph() - returns entire graph
   
   └─> Response: Complete graph with all entities and relations

3. OPEN SPECIFIC NODES
   └─> open_nodes({ names: ["John"] })
   
   └─> loadGraph() - reads entire graph
   
   └─> Filter entities: exact match on "John"
   └─> Filter relations: only between filtered entities
   
   └─> Response:
       {
         entities: [{ name: "John", ... }],
         relations: [{ from: "John", to: "ProjectX", relationType: "works_on" }]
       }
```

---

## Example Workflow: Deleting Data

### Scenario: Client wants to delete an entity and its associated data

```
1. DELETE ENTITY
   └─> delete_entities({ entityNames: ["ProjectX"] })
   
   └─> loadGraph() - reads graph
   
   └─> Filter entities: remove "ProjectX"
   └─> Filter relations: remove any where from="ProjectX" OR to="ProjectX"
   └─> saveGraph() - writes updated graph
   
   └─> Response: { success: true, message: "Entities deleted successfully" }

2. DELETE SPECIFIC OBSERVATIONS
   └─> delete_observations({
         deletions: [
           { entityName: "John", observations: ["works on AI"] }
         ]
       })
   
   └─> loadGraph() - reads graph
   └─> Find "John" entity
   └─> Filter observations: remove specified ones
   └─> saveGraph() - writes updated graph
   
   └─> Response: { success: true, message: "Observations deleted successfully" }

3. DELETE RELATIONS
   └─> delete_relations({
         relations: [
           { from: "John", to: "ProjectX", relationType: "works_on" }
         ]
       })
   
   └─> loadGraph() - reads graph
   └─> Filter relations: remove matching
   └─> saveGraph() - writes updated graph
   
   └─> Response: { success: true, message: "Relations deleted successfully" }
```

---

## Data Persistence

### File Location Resolution

```
ensureMemoryFilePath(customPath?) priority order:

1. If customPath provided:
   - If absolute: use as-is
   - If relative: resolve relative to module directory

2. Else if MEMORY_FILE_PATH env var:
   - Same absolute/relative resolution

3. Else check for legacy file:
   - If memory.json exists but memory.jsonl doesn't → migrate
   - Otherwise use memory.jsonl
```

### JSONL Format Benefits

| Benefit | Description |
|---------|-------------|
| **Append-friendly** | Can append new entries without rewriting entire file |
| **Line-by-line parsing** | Each line is independent JSON object |
| **Easy debugging** | Can read file line by line |
| **Streaming support** | Can process line by line for large files |
| **No corruption risk** | Bad line doesn't affect others |

---

## Known Issues

| Issue | Location | Severity |
|-------|----------|----------|
| Full file rewrite on every save | memory-core.ts saveGraph() | Medium - inefficient for large graphs |
| No transaction/locking mechanism | memory-core.ts | Medium - concurrent writes could conflict |
| Basic search (case-insensitive substring) | memory-core.ts searchNodes() | Low - limited query capabilities |
| No pagination for large graphs | memory-core.ts | Low - memory issues with huge graphs |
| Entity name is unique key only | memory-core.ts | Low - cannot have entities with same name but different types |
| No schema validation on observation content | memory-core.ts | Low - any string accepted |
| Memory file path in module directory | ensureMemoryFilePath() | Low - portability issue |

---

## Configuration Example

```typescript
// In infected.config.json
{
  "memory": {
    "filePath": "/data/knowledge-graph.jsonl"
  }
}

// Or via environment variable
export MEMORY_FILE_PATH=/var/data/memory.jsonl
```

---

## Usage Example with MCP Client

```json
// Create entities
{
  "name": "create_entities",
  "arguments": {
    "entities": [
      { "name": "GPT-4", "entityType": "model", "observations": ["latest OpenAI model", "released 2023"] },
      { "name": "OpenAI", "entityType": "company", "observations": ["AI research company", "founded 2015"] }
    ]
  }
}

// Create relation
{
  "name": "create_relations",
  "arguments": {
    "relations": [
      { "from": "OpenAI", "to": "GPT-4", "relationType": "developed" }
    ]
  }
}

// Search
{
  "name": "search_nodes",
  "arguments": {
    "query": "GPT"
  }
}

// Read full graph
{
  "name": "read_graph",
  "arguments": {}
}
```
