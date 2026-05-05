# Universal Agentic QA Factory

A **multi-project, self-learning, multi-agent QA engine** that autonomously bridges business requirements (Project PRD) with technical reality (Codebase).

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18+ |
| Docker | (for Qdrant) |
| OpenRouter API Key | [openrouter.ai](https://openrouter.ai) |
| Ollama | (for embeddings) |

---

## Setup

### 1. Install Dependencies
```bash
cd qa-factory
npm install
```

### 2. Start Qdrant (Docker)
```bash
docker run -p 6333:6333 -v $(pwd)/qdrant_storage:/qdrant/storage qdrant/qdrant
```

### 3. Configure Environment
```bash
cp .env.example .env
# Fill in OPENROUTER_API_KEY
```

---

## Usage

### Manage Projects
```bash
# List registered projects
npx tsx src/index.ts projects list

# Add a new project
npx tsx src/index.ts projects add \
  --id my-app \
  --name "My App" \
  --path ../My-App \
  --prd ../My-App/PRD.md

# Remove a project
npx tsx src/index.ts projects remove my-app
```

### Run a QA Cycle
```bash
npx tsx src/index.ts run \
  --project build-nest \
  --story "As a Builder, I want to create a Draw Request so that I can request funds" \
  --output ./output
```

The pipeline will:
1. **Recall** relevant memory from previous runs
2. **Survey** the codebase (Prisma, API routes, UI components)
3. **Document** by cross-referencing the PRD with the code (gap analysis)
4. **Generate** test cases (positive, negative, edge) with code-level verification
5. **Pause** for your review (HITL gate)
6. **Persist** your feedback as learning for future runs

---

## Architecture

```
qa-factory/src/
├── graph/          # LangGraph state machine
│   ├── state.ts    # Central state definition
│   ├── workflow.ts # Graph topology + compile
│   └── edges.ts    # Conditional routing
├── agents/         # Agent node functions
│   ├── memory-manager.ts
│   ├── surveyor.ts
│   ├── documenter.ts
│   └── qa-architect.ts
├── parsers/        # Codebase scanners
│   ├── prisma-parser.ts
│   ├── api-route-parser.ts
│   └── component-parser.ts
├── memory/         # Qdrant integration
│   ├── semantic-store.ts    # Per-project facts
│   └── procedural-store.ts  # Cross-project rules
└── projects/       # Multi-project registry
    ├── registry.ts
    └── project-config.ts
```

---

## LLM Stack

| Purpose | Provider | Model |
|---|---|---|
| Reasoning (agents) | OpenRouter | `google/gemma-3-27b-it` |
| Embeddings (memory) | Ollama | `nomic-embed-text` |

> OpenRouter doesn't serve embedding endpoints. Ollama provides local, free embeddings.

---

## Output

Test cases are saved as Markdown files in `./output/<project-id>/`:

```
output/
└── build-nest/
    └── as-a-builder-i-want-to-create-a-draw-request-1234567890.md
```
