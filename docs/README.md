# Documentation Structure

The Infected MCP Server documentation is organized by purpose and topic for easy navigation.

## Directory Overview

### `/api/` - API Reference
Complete API documentation for the Infected MCP Server.
- **API_ENDPOINTS.md** - All available endpoints and their usage

### `/guides/` - Developer Guides
Step-by-step guides and learning resources.
- **GUIDE.md** - Getting started guide
- **STRUCTURE.md** - Project architecture and structure
- **MCP_SERVER.md** - MCP protocol server implementation details
- **CLIENT_QUICK_SETUP.md** - Quick setup for clients
- **CONFIGURATION_EXAMPLES.md** - Configuration examples and patterns
- **SUMMARY.md** - High-level project summary
- **SEQUENTALTHINKING.md** - Sequential thinking patterns in the system

### `/reference/` - Reference Documentation
Detailed reference material and specifications.
- **SHELL.md** - Shell module documentation
- **FILESYSTEM.md** - Filesystem module documentation
- **MEMORY.md** - Memory module documentation
- **SSH.md** - SSH module documentation (now with connection pooling)
- **ERROR_HANDLING.md** - Error handling patterns
- **RATING.md** - Project rating and assessment
- **RATING-v2.md** - Updated rating assessment
- **OFFICIAL_MCP_SDK_OVERVIEW.md** - Official MCP SDK documentation
- **AI_AGENT_SUPPORT_MATRIX.md** - AI agent compatibility matrix
- **AI_AGENTS_STREAMING_SUPPORT.md** - Streaming support for AI agents
- **AI_AGENT_RECOMMENDATION_ANSWER.md** - AI agent recommendations
- **03_CRITICAL_FEATURES_IMPLEMENTATION.md** - Critical features implementation
- **CRITICAL_FEATURES_SUMMARY.txt** - Summary of critical features
- **QUICK_REFERENCE.txt** - Quick reference guide

### `/streaming/` - Streaming Implementation
Documentation on real-time streaming capabilities.
- **HOW_STREAMING_WORKS.md** - How the streaming system works
- **STREAMING_COMPARISON.md** - Comparison of streaming approaches
- **STREAMING_IMPLEMENTATION_GUIDE.md** - Implementation guide for streaming
- **STREAMING_IMPLEMENTATION_SUMMARY.md** - Summary of streaming implementation
- **STREAMING_INTEGRATION_PATCHES.md** - Patches for streaming integration
- **COMPLETE_STREAMING_IMPLEMENTATION.md** - Complete streaming implementation details
- **REALTIME-OUTPUT.md** - Real-time output specification
- **REALTIME_STREAMING_ARCHITECTURE.md** - Architecture of real-time streaming
- **REALTIME_STREAMING_EXAMPLES.md** - Examples of real-time streaming
- **REALTIME_STREAMING_EXPLANATION.md** - Explanation of real-time streaming

### `/upgrade/` - Version Upgrades & Roadmap
Documentation for upgrading to v10.0.0 and strategic roadmap.
- **UPGRADE_ROADMAP.md** - Complete upgrade roadmap (Weeks 1-12)
- **UPGRADE_SUMMARY.md** - Quick summary of upgrades
- **MIGRATION_PHASE1.md** - Phase 1 migration guide (complete)
- **PROJECT_REVIEW.md** - Comprehensive project review and analysis
- **INFECTED_CODEBASE_ANALYSIS.md** - Deep codebase analysis

### `/examples/` - Code Examples
Working code examples demonstrating features.
- **execution-strategies-advanced.ts** - Advanced execution strategy patterns
- **resource-monitoring.ts** - Resource monitoring and alerting
- **ssh-pool-usage.ts** - SSH connection pool usage

### `/implementation/` - Implementation Details
Low-level implementation documentation.
- **REALTIME-STREAMING.md** - Real-time streaming implementation

### Root Level

- **INDEX.md** - Master documentation index

## Quick Navigation

### For New Users
1. Start with `/guides/GUIDE.md` - Getting started
2. Check `/guides/CLIENT_QUICK_SETUP.md` - Quick setup
3. Review `/guides/STRUCTURE.md` - Understand the architecture

### For Module Users
- Shell: `/reference/SHELL.md`
- Filesystem: `/reference/FILESYSTEM.md`
- Memory: `/reference/MEMORY.md`
- SSH: `/reference/SSH.md`

### For v10.0.0 Upgrade
1. Read `/upgrade/UPGRADE_SUMMARY.md` - Overview
2. Review `/upgrade/UPGRADE_ROADMAP.md` - Complete roadmap
3. Check `/upgrade/MIGRATION_PHASE1.md` - Phase 1 details
4. See Phase 2 in roadmap for next steps

### For Streaming Features
1. Start with `/streaming/HOW_STREAMING_WORKS.md`
2. Review `/streaming/STREAMING_IMPLEMENTATION_GUIDE.md`
3. Check `/streaming/REALTIME_STREAMING_EXAMPLES.md`

### For API Reference
- See `/api/API_ENDPOINTS.md`

### For Configuration
- See `/guides/CONFIGURATION_EXAMPLES.md`

### For Code Examples
- See `/examples/` directory

---

## Document Status

### Phase 1 Complete ✅
- ExecutionStrategy pattern implementation
- ProcessManager refactoring (1,803 → 982 LOC)
- SSH connection pooling (70-80% overhead reduction)
- SSH module refactoring into 5 focused modules
- Resource monitoring and limits
- 350+ unit tests with ~93% coverage
- Service container integration
- Complete migration guide

See `/upgrade/MIGRATION_PHASE1.md` for details.

### Phase 2 In Progress
- Error classification and recovery (Week 5)
- Security system pipeline (Week 6-7)
- Intelligence layer (Week 8)

See `/upgrade/UPGRADE_ROADMAP.md` for schedule.

---

## Contributing to Docs

When adding new documentation:
1. Choose the appropriate subdirectory
2. Use clear, descriptive filenames
3. Include a summary at the top
4. Link to related documents
5. Keep examples practical and current
6. Update this README if adding new categories

---

Last Updated: 2026-03-15  
Documentation Format: Markdown  
Total Documents: 37 files  
Total Categories: 7 directories
