# SequentialThinking Module Documentation

## Purpose

The SequentialThinking module (`src/modules/sequentialthinking/index.ts` and `src/modules/sequentialthinking/lib.ts`) is a **structured thinking and problem-solving framework** that enables AI assistants to break down complex problems into sequential thought steps. It implements a Chain of Thought (CoT) methodology that allows for dynamic, reflective problem-solving where each thought can build upon, question, or revise previous insights. The module maintains thought history and branch tracking, supporting non-linear thinking patterns including revisions and branching.

---

## Main Features

### 1. **Sequential Thought Processing**
- Process individual thought steps in a structured sequence
- Track thought number and estimated total thoughts
- Automatically adjust total thoughts as understanding evolves
- Return structured response with progress information
- **Code**: `processThought()` (lib.ts lines 57-113), input schema (index.ts lines 18-29)

### 2. **Thought Revision**
- Revise previously expressed thoughts with `isRevision` flag
- Track which thought is being reconsidered via `revisesThought`
- Maintain full history including all revisions
- Enable iterative refinement of reasoning
- **Code**: `isRevision` handling (lib.ts lines 35-37, 63)

### 3. **Branching Support**
- Create thought branches from any thought number
- Track branch points with `branchFromThought`
- Maintain separate branch IDs for identification
- Support parallel exploration of alternative approaches
- **Code**: Branch handling (lib.ts lines 65-70, 38-40)

### 4. **Progress Tracking**
- Return thought number and total thoughts in response
- Calculate progress percentage (thoughtNumber / totalThoughts)
- Track thought history length
- Support continuation detection via `nextThoughtNeeded`
- **Code**: Response generation (lib.ts lines 88-98)

### 5. **Thought Logging**
- Format thoughts with visual box display
- Configurable logging via `DISABLE_THOUGHT_LOGGING` env var
- Prevents logging when disabled for cleaner output
- **Code**: `formatThought()` (lib.ts lines 29-55), logging (lib.ts lines 72-75)

### 6. **Background Process Notifications**
- Send thought progress to process manager
- Support execution_id for notification linking
- Enable real-time progress updates for long thinking sequences
- **Code**: Notification handling (lib.ts lines 77-86)

---

## How It Works

### Data Model

```
ThoughtData Interface:
  - thought: string (the actual thought content)
  - thoughtNumber: number (current step in sequence)
  - totalThoughts: number (estimated total steps)
  - isRevision?: boolean (whether this revises previous thought)
  - revisesThought?: number (which thought is being revised)
  - branchFromThought?: number (branching point)
  - branchId?: string (branch identifier)
  - needsMoreThoughts?: boolean (more thoughts needed)
  - nextThoughtNeeded: boolean (continue thinking)
  - execution_id?: string (optional notification linkage)
```

### Thought Processing Flow

```
processThought() (lib.ts lines 57-113):

1. VALIDATION
   ├─> Check if thoughtNumber > totalThoughts
   └─> Auto-adjust totalThoughts if needed

2. HISTORY UPDATE
   ├─> Push thought to thoughtHistory array
   └─> Track total count for reference

3. BRANCH HANDLING
   ├─> If branchFromThought && branchId provided:
   │   └─> Create branch array if not exists
   │   └─> Push thought to branch
   └─> Otherwise: main branch continues

4. LOGGING
   ├─> Check disableThoughtLogging flag
   ├─> Format thought as box display
   └─> Log to central logger

5. NOTIFICATION (if processManager available)
   ├─> Generate or use provided execution_id
   ├─> Create progress notification
   ├─> Calculate progress percentage
   └─> Send via processManager.sendBackgroundProcessOutput()

6. RESPONSE
   └─> Return JSON with:
       - thoughtNumber
       - totalThoughts
       - nextThoughtNeeded
       - branches (array of branch IDs)
       - thoughtHistoryLength
```

### Visual Thought Display

The module formats thoughts with a visual box:

```
┌─────────────────────────────────────┐
│ Thought 3/5                         │
├─────────────────────────────────────┤
│ Analyzing the edge cases...         │
└─────────────────────────────────────┘
```

For revisions:
```
┌─────────────────────────────────────┐
│ Revision (revising thought 2)      │
├─────────────────────────────────────┤
│ Previous assumption was incorrect... │
└─────────────────────────────────────┘
```

For branches:
```
┌─────────────────────────────────────────┐
│ Branch (from thought 3, ID: branch-abc) │
├─────────────────────────────────────────┤
│ Exploring alternative approach...      │
└─────────────────────────────────────────┘
```

---

## Important Classes, Functions, and Utilities

### Core Classes

| Class | Lines | Role |
|-------|-------|------|
| `SequentialThinkingModule` | index.ts 7-131 | Main module class implementing `Module` interface. Registers the sequentialthinking tool. |
| `SequentialThinkingServer` | lib.ts 18-114 | Core server class managing thought processing, history, branches, and notifications. |

### SequentialThinkingServer Properties

| Property | Type | Role |
|----------|------|------|
| `thoughtHistory` | ThoughtData[] | Array storing all thoughts in sequence |
| `branches` | Record<string, ThoughtData[]> | Dictionary of thought branches by branchId |
| `disableThoughtLogging` | boolean | Flag to disable thought logging |
| `processManager` | ProcessManager \| undefined | Optional reference for notifications |

### SequentialThinkingServer Methods

| Method | Lines | Role |
|--------|-------|------|
| `constructor()` | 24-27 | Initialize server with optional ProcessManager |
| `formatThought()` | 29-55 | Format thought as visual box display |
| `processThought()` | 57-113 | Main method to process a single thought |

### Input Schema (Zod)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `thought` | string | Yes | Current thinking step content |
| `nextThoughtNeeded` | boolean | Yes | Whether another thought is needed |
| `thoughtNumber` | number (int, min 1) | Yes | Current thought number in sequence |
| `totalThoughts` | number (int, min 1) | Yes | Estimated total thoughts needed |
| `isRevision` | boolean | No | Whether this revises previous thinking |
| `revisesThought` | number (int, min 1) | No | Which thought is being reconsidered |
| `branchFromThought` | number (int, min 1) | No | Branching point thought number |
| `branchId` | string | No | Branch identifier for branching |
| `needsMoreThoughts` | boolean | No | If more thoughts needed after reaching end |
| `execution_id` | string | No | Optional ID to link notifications |

### Output Schema

| Field | Type | Description |
|-------|------|-------------|
| `thoughtNumber` | number | Current thought number |
| `totalThoughts` | Current total thoughts (may have been adjusted) |
| `nextThoughtNeeded` | boolean | Whether to continue thinking |
| `branches` | string[] | Array of branch IDs |
| `thoughtHistoryLength` | number | Total thoughts processed so far |

---

## Data Flow

### Input Flow
```
Client Request (JSON with thought data)
    ↓
MCP Server routes to sequentialthinking tool
    ↓
Zod Schema Validation (SequentialThinkingArgsSchema.parse)
    ↓
SequentialThinkingServer.processThought(input)
    ↓
Validate and adjust thought numbers
    ↓
Add to thoughtHistory
    ↓
Handle branching if applicable
    ↓
Format and log thought (if enabled)
    ↓
Send notification (if processManager available)
    ↓
Return structured response
```

### Output Flow
```
Thought Processing Complete
    ↓
Generate response JSON:
    {
      thoughtNumber,
      totalThoughts,
      nextThoughtNeeded,
      branches: Object.keys(branches),
      thoughtHistoryLength
    }
    ↓
Wrap in MCP response format:
    {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      structuredContent: parsedResponse
    }
    ↓
Return to client
```

---

## Integration

### Module System Integration

The SequentialThinking module implements the `Module` interface:

1. **register()**: Initializes SequentialThinkingServer, registers the sequentialthinking MCP tool
2. **shutdown()**: Deregisters tools gracefully

### MCP Tool Registered

| Tool Name | Description |
|-----------|-------------|
| `sequentialthinking` | A detailed tool for dynamic and reflective problem-solving through sequential thoughts |

### Dependencies

| Component | Dependency For |
|-----------|----------------|
| ProcessManager (optional) | Background process notifications for thought progress |
| logger | Centralized thought logging |

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `DISABLE_THOUGHT_LOGGING` | Set to "true" to disable thought logging | false (logging enabled) |

---

## Example Workflow: Solving a Complex Problem

### Scenario: Client needs to solve a multi-step problem

```
1. FIRST THOUGHT
   └─> sequentialthinking({
         thought: "I need to understand the problem requirements first...",
         thoughtNumber: 1,
         totalThoughts: 5,
         nextThoughtNeeded: true
       })
   
   └─> processThought() adds to history
   └─> Returns: { thoughtNumber: 1, totalThoughts: 5, nextThoughtNeeded: true, branches: [], thoughtHistoryLength: 1 }

2. SECOND THOUGHT
   └─> sequentialthinking({
         thought: "Let me break down the key components...",
         thoughtNumber: 2,
         totalThoughts: 5,
         nextThoughtNeeded: true
       })
   
   └─> processThought() adds to history
   └─> Returns: { thoughtNumber: 2, totalThoughts: 5, nextThoughtNeeded: true, branches: [], thoughtHistoryLength: 2 }

3. REVISION (realizing thought 2 was incomplete)
   └─> sequentialthinking({
         thought: "I need to reconsider the component breakdown - missed a critical part...",
         thoughtNumber: 3,
         totalThoughts: 6,
         nextThoughtNeeded: true,
         isRevision: true,
         revisesThought: 2
       })
   
   └─> processThought() marks as revision
   └─> History now contains: [Thought 1, Thought 2, Revision of 2]
   └─> Returns: { thoughtNumber: 3, totalThoughts: 6, nextThoughtNeeded: true, branches: [], thoughtHistoryLength: 3 }

4. BRANCH (exploring alternative approach)
   └─> sequentialthinking({
         thought: "Let me explore a different approach using X...",
         thoughtNumber: 4,
         totalThoughts: 6,
         nextThoughtNeeded: true,
         branchFromThought: 3,
         branchId: "alt-approach-1"
       })
   
   └─> processThought() creates new branch
   └─> Branches now contains: ["alt-approach-1"]
   └─> Returns: { thoughtNumber: 4, totalThoughts: 6, nextThoughtNeeded: true, branches: ["alt-approach-1"], thoughtHistoryLength: 4 }

5. FINAL THOUGHT (conclusion)
   └─> sequentialthinking({
         thought: "Based on the analysis, the optimal solution is...",
         thoughtNumber: 6,
         totalThoughts: 6,
         nextThoughtNeeded: false  // Done!
       })
   
   └─> processThought() adds final thought
   └─> Returns: { thoughtNumber: 6, totalThoughts: 6, nextThoughtNeeded: false, branches: ["alt-approach-1"], thoughtHistoryLength: 6 }
```

---

## Example Workflow: Using Branching for Exploration

### Scenario: Client wants to explore multiple solution paths

```
1. INITIAL PATH
   └─> thought: "Approach A seems promising...",
       thoughtNumber: 1, totalThoughts: 3, nextThoughtNeeded: true

2. BRANCH TO EXPLORE ALTERNATIVE
   └─> thought: "But Approach B might be better because...",
       thoughtNumber: 2, totalThoughts: 3, nextThoughtNeeded: true,
       branchFromThought: 1,
       branchId: "approach-b"

3. CONTINUE ON BRANCH
   └─> thought: "Let me develop this approach further...",
       thoughtNumber: 3, totalThoughts: 4, nextThoughtNeeded: true,
       branchId: "approach-b"

4. REALIZE MAIN BRANCH NEEDS MORE
   └─> thought: "I should continue analyzing Approach A as well...",
       thoughtNumber: 4, totalThoughts: 4, nextThoughtNeeded: false,
       branchId: "approach-b"

Result:
- Main history: 2 thoughts
- Branch "approach-b": 3 thoughts
- Client can now compare both approaches
```

---

## When to Use This Tool

| Use Case | Description |
|----------|-------------|
| **Complex Problem Decomposition** | Breaking down complex problems into manageable steps |
| **Planning with Room for Revision** | Design and planning where initial plans may need adjustment |
| **Analysis with Course Correction** | Analysis that might need to revisit earlier conclusions |
| **Unclear Scope Problems** | Problems where full scope isn't immediately apparent |
| **Multi-step Solutions** | Tasks requiring sequential solution steps |
| **Context Maintenance** | Tasks needing to maintain context over multiple interactions |
| **Information Filtering** | Filtering out irrelevant details at each step |

---

## Key Features Explained

### Dynamic Total Thoughts Adjustment

The system automatically adjusts `totalThoughts` if `thoughtNumber` exceeds it:

```
Input: thoughtNumber: 5, totalThoughts: 3
Result: totalThoughts auto-adjusted to 5
```

This allows thinking to extend naturally without explicit adjustment.

### Revision Tracking

When `isRevision: true` is set:
- The thought is marked as a revision in formatting
- Original thought remains in history
- Enables tracking of evolving understanding

### Branch Support

Branches allow parallel exploration:
- Each branch has a unique `branchId`
- Branch starts from a specific thought (`branchFromThought`)
- All branches are tracked in `branches` property
- Main thinking continues independently of branches

### Progress Notification

When `processManager` is available:
- Each thought sends a notification with `execution_id`
- Progress is calculated as `thoughtNumber / totalThoughts`
- Enables real-time progress tracking in UI

---

## Known Issues

| Issue | Location | Severity |
|-------|----------|----------|
| No persistence of thought history | lib.ts - thoughtHistory | Medium - lost on restart |
| No thought history retrieval | lib.ts | Low - cannot query past thoughts |
| Branches cannot be merged | lib.ts | Low - no branch integration |
| No thought timeout/TTL | lib.ts | Low - stale sessions possible |
| processManager is optional | lib.ts line 22 | Low - notifications may not work without it |
| No thought validation against history | lib.ts processThought | Low - can add contradictory thoughts |
| Memory growth with long sessions | lib.ts thoughtHistory | Low - unbounded array growth |

---

## Configuration

### Enabling Notifications

To enable background process notifications for thought progress, pass the ProcessManager during module initialization:

```typescript
// In module registration
const thinkingServer = new SequentialThinkingServer(processManager);
```

### Disabling Logging

To disable the visual thought logging to console:

```bash
export DISABLE_THOUGHT_LOGGING=true
```

---

## Usage Example with MCP Client

```json
// Start thinking process
{
  "name": "sequentialthinking",
  "arguments": {
    "thought": "Let me analyze this problem step by step. First, I need to understand the requirements.",
    "thoughtNumber": 1,
    "totalThoughts": 5,
    "nextThoughtNeeded": true
  }
}

// Continue to next thought
{
  "name": "sequentialthinking",
  "arguments": {
    "thought": "Now let me break down the core components needed...",
    "thoughtNumber": 2,
    "totalThoughts": 5,
    "nextThoughtNeeded": true
  }
}

// Mark as revision
{
  "name": "sequentialthinking",
  "arguments": {
    "thought": "Actually, I need to reconsider the initial assumption - it was flawed.",
    "thoughtNumber": 3,
    "totalThoughts": 6,
    "nextThoughtNeeded": true,
    "isRevision": true,
    "revisesThought": 1
  }
}

// Create a branch
{
  "name": "sequentialthinking",
  "arguments": {
    "thought": "Let me explore an alternative approach here...",
    "thoughtNumber": 4,
    "totalThoughts": 6,
    "nextThoughtNeeded": true,
    "branchFromThought": 2,
    "branchId": "alternative-path"
  }
}

// Complete the thinking
{
  "name": "sequentialthinking",
  "arguments": {
    "thought": "Based on my analysis, the optimal solution is to implement approach X.",
    "thoughtNumber": 6,
    "totalThoughts": 6,
    "nextThoughtNeeded": false
  }
}
```

---

## Response Format Example

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"thoughtNumber\": 3,\n  \"totalThoughts\": 6,\n  \"nextThoughtNeeded\": true,\n  \"branches\": [\"alternative-path\"],\n  \"thoughtHistoryLength\": 3\n}"
    }
  ],
  "structuredContent": {
    "thoughtNumber": 3,
    "totalThoughts": 6,
    "nextThoughtNeeded": true,
    "branches": ["alternative-path"],
    "thoughtHistoryLength": 3
  }
}
```
