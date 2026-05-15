# Graph Report - qa-factory  (2026-05-05)

## Corpus Check
- 25 files · ~8,441 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 79 nodes · 206 edges · 6 communities
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `70e79c1a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]

## God Nodes (most connected - your core abstractions)
1. `parseComponents()` - 10 edges
2. `parseAPIRoutes()` - 9 edges
3. `readFileSafe()` - 9 edges
4. `runParsers()` - 7 edges
5. `getLLM()` - 7 edges
6. `getEmbeddings()` - 7 edges
7. `parsePrismaSchemaFromProject()` - 6 edges
8. `scanFiles()` - 6 edges
9. `agentLogger()` - 6 edges
10. `memoryPersistNode()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `documenterNode()` --calls--> `readFileSafe()`  [INFERRED]
  agents/documenter.ts → utils/file-scanner.ts
- `classifyFeedback()` --calls--> `getLLM()`  [INFERRED]
  agents/memory-manager.ts → utils/llm.ts
- `parseComponents()` --calls--> `scanFiles()`  [INFERRED]
  parsers/component-parser.ts → utils/file-scanner.ts
- `parseComponents()` --calls--> `readFileSafe()`  [INFERRED]
  parsers/component-parser.ts → utils/file-scanner.ts
- `documenterNode()` --calls--> `getLLM()`  [INFERRED]
  agents/documenter.ts → utils/llm.ts

## Communities (6 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.26
Nodes (10): classifyFeedback(), memoryPersistNode(), memoryRecallNode(), queryProceduralRules(), seedBuiltInRules(), upsertProceduralRule(), querySemanticFacts(), upsertSemanticFact() (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.21
Nodes (7): documenterNode(), extractFeatureGroups(), generateForFeature(), qaArchitectNode(), routeAfterReview(), buildWorkflow(), getLLM()

### Community 2 - "Community 2"
Cohesion: 0.29
Nodes (12): detectMethods(), detectMiddleware(), detectPrismaOps(), filePathToRoute(), parseAPIRoutes(), extractBlock(), parseField(), parsePrismaSchema() (+4 more)

### Community 3 - "Community 3"
Cohesion: 0.3
Nodes (11): ensureCollections(), resolveProjectPaths(), validateProjectConfig(), getProject(), listProjects(), loadRegistry(), removeProject(), saveRegistry() (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.57
Nodes (4): surveyorNode(), extractScopeEntities(), runParsers(), agentLogger()

### Community 5 - "Community 5"
Cohesion: 0.52
Nodes (6): detectApiCalls(), detectConditionalRenders(), detectStateHooks(), detectTestIds(), extractComponentName(), parseComponents()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `readFileSafe()` connect `Community 2` to `Community 1`, `Community 5`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `parseComponents()` connect `Community 5` to `Community 2`, `Community 4`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `parseAPIRoutes()` connect `Community 2` to `Community 4`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `parseComponents()` (e.g. with `scanFiles()` and `readFileSafe()`) actually correct?**
  _`parseComponents()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `parseAPIRoutes()` (e.g. with `scanFiles()` and `readFileSafe()`) actually correct?**
  _`parseAPIRoutes()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `readFileSafe()` (e.g. with `documenterNode()` and `parseAPIRoutes()`) actually correct?**
  _`readFileSafe()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `runParsers()` (e.g. with `surveyorNode()` and `parsePrismaSchemaFromProject()`) actually correct?**
  _`runParsers()` has 4 INFERRED edges - model-reasoned connections that need verification._