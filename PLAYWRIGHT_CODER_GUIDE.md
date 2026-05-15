# Playwright Coder Agent Implementation Guide

## Overview

The **Playwright Coder** agent (`src/agents/playwright-coder.ts`) is a new node in the QA Factory workflow that automatically generates executable Playwright test specifications from approved test cases.

### Key Features

- **Selector Verification**: Uses Playwright MCP protocol to verify that DOM selectors extracted from UI components actually exist
- **Self-Healing Selectors**: When selectors are missing, performs automatic fallback to role-based or alternative locators
- **JavaScript-Only Output**: Generates modern `@playwright/test` specs in pure JavaScript (ES Modules)
- **Guided Step Code Generation**: Intelligently translates test steps into Playwright actions (click, fill, select, etc.)
- **MCP Integration**: Framework for connecting to `@modelcontextprotocol/sdk` for live browser verification

---

## Workflow Integration

### Graph Topology

The `playwright_coder` node is positioned in the workflow as follows:

```
memory_recall → surveyor → documenter → qa_architect → 
    hitl_review 
        ├─ [approved] → playwright_coder → memory_persist → END
        ├─ [revision_requested] → qa_architect (max 3 loops)
        └─ [rejected] → END
```

**Activation Condition**: `reviewDecision === "approved"`

### State Changes

When the `playwright_coder` node executes, it:

1. **Consumes**:
   - `testCases[]` — approved test cases from QA Architect
   - `uiComponents[]` — metadata including `testIds` for selector lookup
   - `projectConfig.outputPath` — output directory for generated specs

2. **Produces**:
   - `generatedPlaywrightSpecs[]` — array of generated spec metadata with selector match reports
   - `selectorMismatches[]` — summary of selectors that couldn't be verified
   - `errors[]` — any generation failures

---

## Implementation Details

### 1. MCP Client Initialization

```typescript
function initPlaywrightMCPClient()
```

**Current Status**: Placeholder implementation for reference.

**Production Implementation** would:
- Import `@modelcontextprotocol/sdk/client`
- Initialize transport (stdio, SSE, or WebSocket)
- Implement these methods:
  - `verifySelector(selector, componentName)` — calls `get_accessibility_tree` tool
  - `findAlternativeLocator(selector, componentName)` — searches for role-based fallback
  - `navigateAndVerify(url)` — calls `browser_navigate` + accessibility checks

**Example (Production)**:
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "playwright-mcp-server", // Start the MCP server process
});
const client = new Client({ name: "qa-factory", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);
```

### 2. Selector Registry Building

```typescript
function buildSelectorRegistry(uiComponents: UIComponent[]): Map<string, string[]>
```

- **Input**: Array of `UIComponent` objects (from Surveyor)
- **Output**: Map linking component names to their selectors

**Registry Sources**:
1. `data-testid` attributes from `component.testIds`
2. Role-based selectors inferred from component name

**Example Registry Entry**:
```
"BuildStageModal" → [
  "[data-testid='build-stage-modal']",
  "[data-testid='stage-name-input']",
  "[role='dialog']"
]
```

### 3. Selector Verification

```typescript
async function verifyTestCaseSelectors(
  testCase: TestCase,
  selectorRegistry: Map<string, string[]>,
  mcpClient: ...
): Promise<SelectorMatch[]>
```

For each test step:
1. Extract verification string (DOM selector, API query, or DB query)
2. Skip non-DOM verifications (API/DB queries)
3. Search registry for matching selectors
4. If found: verify via MCP `verify_selector` call
5. If not found: attempt self-healing via MCP `find_alternative_locator`
6. Record match status + fallback alternative

### 4. Spec Generation

```typescript
function generatePlaywrightSpec(
  testCase: TestCase,
  selectorMatches: SelectorMatch[],
  projectId: string,
  baseUrl?: string
): string
```

**Output Structure**:
```javascript
import { test, expect } from '@playwright/test';

test.describe('Test Case Title', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  // Optional preconditions setup

  test('Test Case Title (positive)', async ({ page, context }) => {
    // Step execution code
    await page.locator('[data-testid="button"]').click();
    // ...
  });
});
```

### 5. Step-to-Code Translation

```typescript
function generateStepCode(
  step: { action: string; expectedResult: string },
  selector: string
): string
```

**Action Patterns Recognized**:
- `click` → `locator(selector).click()`
- `fill`, `enter`, `type` → `locator(selector).fill('test-value')`
- `select` → `locator(selector).selectOption('option-1')`
- `hover` → `locator(selector).hover()`
- `check`, `uncheck` → `locator(selector).setChecked()`
- `navigate`, `go to` → `page.goto(url)`

**Fallback**: `await page.waitForLoadState()` with TODO comment

---

## Output Files

### Directory Structure

```
output/<projectId>/
├── specs/
│   ├── <testCaseId>.spec.js      # Generated Playwright spec
│   ├── <testCaseId>.spec.js      # ...
│   └── ...
├── <story-slug>-<timestamp>.md   # Test case summary (markdown)
└── .preview/                      # HITL review preview
    └── preview-<projectId>.md
```

### Spec File Naming

- **File name**: `{testCaseId}.spec.js`
- **Test description**: From `testCase.title`
- **Category marker**: Included in test output

### Running Generated Specs

```bash
# Run all specs for a project
npx playwright test ./output/build-nest/specs

# Run a single spec
npx playwright test ./output/build-nest/specs/test-abc123.spec.js

# Run with UI mode for debugging
npx playwright test --ui ./output/build-nest/specs
```

---

## Configuration

### Required Environment Variables

No new environment variables required beyond existing QA Factory setup.

### Optional Configs

#### 1. Base URL for Specs

By default, specs use `http://localhost:3000`. Override in `generatePlaywrightSpec()`:

```typescript
const specContent = generatePlaywrightSpec(
  testCase,
  selectorMatches,
  projectId,
  "https://staging.example.com"  // Custom base URL
);
```

#### 2. MCP Server Location

When connecting to Playwright MCP server in production:

```typescript
const transport = new StdioClientTransport({
  command: process.env.PLAYWRIGHT_MCP_SERVER || "playwright-mcp-server",
});
```

---

## Integration Points

### 1. Conditional Routing (`src/graph/edges.ts`)

When user approves test cases at HITL gate:

```typescript
case "approved":
  return "playwright_coder";  // Route to playwright_coder instead of memory_persist
```

### 2. Workflow Definition (`src/graph/workflow.ts`)

Node registration:

```typescript
.addNode("playwright_coder", playwrightCoderNode)
.addConditionalEdges("hitl_review", routeAfterReview, {
  playwright_coder: "playwright_coder",  // ← NEW
  memory_persist: "memory_persist",
  qa_architect: "qa_architect",
  __end__: END,
})
.addEdge("playwright_coder", "memory_persist")  // ← NEW
```

### 3. CLI Output (`src/index.ts`)

After approval, displays generated specs:

```
📋 Generated 12 Playwright spec file(s):
  ✓ test-abc123.spec.js
  ✓ test-def456.spec.js
  ...
📂 Location: /path/to/output/build-nest/specs
   Run specs: npx playwright test /path/to/output/build-nest/specs
```

---

## Selector Mismatch Handling

### Detection

When a selector verification fails:
- MCP client logs warning: `Selector mismatch for step X: "selector" → fallback to "alternative"`
- Entry added to `selectorMismatches[]` in state
- Fallback selector used in generated spec (marked with comment)

### Output Example

```typescript
// In generated spec:
// ⚠  Selector mismatch: [data-testid="original"] → fallback to [role="button"]
await page.locator('[role="button"]').click();
```

### Review Process

After specs are generated, developers should:
1. Review selector fallbacks in generated specs
2. Run specs in headless mode to catch failures:
   ```bash
   npx playwright test --reporter=list
   ```
3. Update `uiComponents` metadata in Surveyor if selectors change

---

## Error Handling

All errors are caught and logged to `state.errors[]`:

```typescript
try {
  const selectorMatches = await verifyTestCaseSelectors(...);
  // ... generation logic
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  log.error(`Failed to generate spec for ${testCase.title}: ${errMsg}`);
  // Record error and continue with next test case
}
```

If all test cases fail, the error is propagated and pipeline halts.

---

## Testing the Implementation

### 1. Unit Test: Test Step Code Generation

```typescript
// In specs file:
test('generates correct Playwright code for click action', () => {
  const step = { 
    action: 'Click the submit button',
    expectedResult: 'Form is submitted'
  };
  const selector = '[data-testid="submit"]';
  const code = generateStepCode(step, selector);
  expect(code).toContain("await page.locator('[data-testid=\"submit\"]').click()");
});
```

### 2. Integration Test: Full Pipeline

```bash
cd qa-factory

# 1. Run the QA cycle
npx tsx src/index.ts run \
  --project build-nest \
  --story "As a Builder, I want to create a draw request" \
  --output ./test-output

# 2. At HITL prompt, approve (press 'A')

# 3. Verify specs were generated
ls -la ./test-output/build-nest/specs/

# 4. Run generated specs
npx playwright test ./test-output/build-nest/specs/
```

### 3. E2E Test: Real Browser Verification

With Playwright MCP server running:

```bash
# Start MCP server (in separate terminal)
playwright-mcp-server

# Run QA Factory with MCP enabled
PLAYWRIGHT_MCP_ENABLED=true \
npx tsx src/index.ts run \
  --project build-nest \
  --story "Build stage management" \
  --output ./test-output
```

---

## Future Enhancements

1. **Live Browser Verification**: Connect to actual browser instance via MCP for selector validation
2. **Screenshot Comparison**: Generate screenshot baselines for visual regression tests
3. **Performance Metrics**: Extract and verify response times from test steps
4. **API Mock Integration**: Auto-generate MSW/nock mocks from backend verification steps
5. **Report Generation**: Create HTML reports from generated specs with metrics
6. **Selector Optimization**: Learn and cache successful selector patterns per project

---

## Troubleshooting

### Issue: Generated specs fail to run

**Symptom**: `Error: Locator not found`

**Solution**:
1. Check Base URL is correct for test environment
2. Verify `testIds` in UI components are current
3. Run spec with `--headed --debug` for interactive debugging:
   ```bash
   npx playwright test --headed --debug ./output/build-nest/specs/test-abc.spec.js
   ```

### Issue: All selectors marked as mismatches

**Symptom**: MCP client not responding

**Solution**:
1. Verify MCP server is running (for production implementation)
2. Check environment variables for server endpoint
3. Fall back to mock verification (current behavior)

### Issue: Backend verification steps missing

**Symptom**: Generated spec lacks API/DB checks

**Current Behavior**: Backend verifications are included as TODO comments

**Solution** (production):
1. Add API client to spec imports
2. Generate fetch/axios calls for API verifications
3. Use Prisma client for DB queries in Node.js test setup

---

## References

- [Playwright Test Documentation](https://playwright.dev/docs/intro)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
