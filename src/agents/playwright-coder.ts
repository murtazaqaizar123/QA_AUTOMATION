// ─────────────────────────────────────────────────────────────
// agents/playwright-coder.ts — Playwright spec generator with MCP
// ─────────────────────────────────────────────────────────────
import { QAFactoryState } from "../graph/state.js";
import { TestCase } from "../types/test-case.js";
import { UIComponent } from "../types/codebase.js";
import { agentLogger } from "../utils/logger.js";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

const log = agentLogger("PlaywrightCoder");

interface SelectorMatch {
  testId: string;
  componentName: string;
  found: boolean;
  locator?: string;
  fallback?: string;
}

interface SpecGenerationResult {
  testCaseId: string;
  specFile: string;
  content: string;
  selectorMatches: SelectorMatch[];
  errors?: string[];
}

/**
 * Initialize a basic Playwright client.
 * In a real environment with MCP server running, this would connect to
 * @modelcontextprotocol/sdk/client/index.js with proper transport.
 *
 * For now, we mock the selector verification and generate specs
 * that will be verified when executed against a real browser.
 */
function initPlaywrightMCPClient() {
  // In production, this connects to the Playwright MCP server
  // import { Client } from "@modelcontextprotocol/sdk/client/index.js";
  // const client = new Client(...);
  // For this implementation, we return a mock that tracks selector verification attempts
  return {
    async verifySelector(selector: string, componentName: string): Promise<boolean> {
      // In real MCP integration, this would call browser_navigate + get_accessibility_tree
      // For now, we assume testIds are valid if they exist in uiComponents
      log.info(`[MCP Selector Check] Component: ${componentName}, Selector: ${selector}`);
      return true; // Placeholder — in real scenario, queries the MCP server
    },

    async findAlternativeLocator(selector: string, componentName: string): Promise<string | null> {
      // Self-healing: if selector not found, search for alternative locators
      // In real MCP, this would use get_accessibility_tree to find role-based alternatives
      log.info(`[MCP Self-Healing] Searching alternatives for: ${selector}`);
      return `role='${componentName.toLowerCase()}'`; // Fallback to role-based locator
    },

    async navigateAndVerify(url: string): Promise<boolean> {
      // In real MCP: browser_navigate(url) + accessibility checks
      log.info(`[MCP Navigate] URL: ${url}`);
      return true;
    },
  };
}

/**
 * Extract testIds and role-based selectors from UI components for reference
 */
function buildSelectorRegistry(uiComponents: UIComponent[]): Map<string, string[]> {
  const registry = new Map<string, string[]>();

  for (const component of uiComponents) {
    const selectors: string[] = [];

    // Add data-testid selectors
    if (component.testIds && component.testIds.length > 0) {
      selectors.push(
        ...component.testIds.map((tid) => `[data-testid="${tid}"]`)
      );
    }

    // Add role-based selectors based on component name hints
    const roleName = component.name.toLowerCase().replace(/component|wrapper|container/gi, "").trim();
    if (roleName) {
      selectors.push(`[role="${roleName}"]`);
      selectors.push(`${roleName}`); // Direct tag or class hint
    }

    if (selectors.length > 0) {
      registry.set(component.name, selectors);
    }
  }

  return registry;
}

/**
 * Verify each test case's selectors against the UI component registry
 * and simulate MCP browser checks
 */
async function verifyTestCaseSelectors(
  testCase: TestCase,
  selectorRegistry: Map<string, string[]>,
  mcpClient: ReturnType<typeof initPlaywrightMCPClient>
): Promise<SelectorMatch[]> {
  const matches: SelectorMatch[] = [];

  for (const step of testCase.steps) {
    const verification = step.verification;

    // Skip non-DOM verifications (e.g., API assertions, DB queries)
    if (verification.startsWith("prisma.") || verification.startsWith("GET ") || verification.startsWith("POST ")) {
      continue;
    }

    // Attempt to find matching selector in registry or via MCP
    let found = false;
    let locator: string | undefined;
    let fallback: string | undefined;
    let componentMatch = "";

    // Search for matching selectors in registry
    for (const [componentName, selectors] of selectorRegistry) {
      for (const selector of selectors) {
        if (verification.includes(selector) || selector.includes(verification)) {
          found = await mcpClient.verifySelector(selector, componentName);
          locator = selector;
          componentMatch = componentName;
          break;
        }
      }
      if (found) break;
    }

    // If not found, attempt self-healing
    if (!found) {
      const altLocator = await mcpClient.findAlternativeLocator(verification, componentMatch || "unknown");
      fallback = altLocator ?? undefined;
      if (fallback) {
        log.warn(
          `Selector mismatch for step ${step.stepNumber}: "${verification}" → falling back to "${fallback}"`
        );
      }
    }

    matches.push({
      testId: verification,
      componentName: componentMatch,
      found,
      locator,
      fallback,
    });
  }

  return matches;
}

/**
 * Generate a Playwright .spec.js file from a test case
 */
function generatePlaywrightSpec(
  testCase: TestCase,
  selectorMatches: SelectorMatch[],
  projectId: string,
  baseUrl: string = "http://localhost:3000"
): string {
  const specName = testCase.title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const testFunction = generateTestFunction(testCase, selectorMatches, baseUrl);
  const preconditionsSetup = generatePreconditionsSetup(testCase);
  const backendVerifications = generateBackendVerifications(testCase);

  const specContent = `// ─────────────────────────────────────────────────────────────
// Auto-generated Playwright spec for: ${testCase.title}
// Project: ${projectId}
// Category: ${testCase.category}
// Generated: ${new Date().toISOString()}
// ─────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

const BASE_URL = '${baseUrl}';

test.describe('${testCase.title}', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the base URL
    await page.goto(BASE_URL);
  });

${preconditionsSetup}

  test('${testCase.title} (${testCase.category})', async ({ page, context }) => {
    // Preconditions
${testCase.preconditions.map((p) => `    // ${p}`).join("\n")}

${testFunction}

${backendVerifications}
  });
});
`;

  return specContent;
}

/**
 * Generate step execution code for the test function
 */
function generateTestFunction(
  testCase: TestCase,
  selectorMatches: SelectorMatch[],
  baseUrl: string
): string {
  const steps = testCase.steps
    .map((step, idx) => {
      const match = selectorMatches[idx];
      const selector =
        match && match.locator ? match.locator : match && match.fallback ? match.fallback : `'[TODO: selector for ${step.action}]'`;

      return `    // Step ${step.stepNumber}: ${step.action}
    // Expected: ${step.expectedResult}
    ${generateStepCode(step, selector)}`;
    })
    .join("\n\n");

  return steps;
}

/**
 * Generate individual step code based on action context
 */
function generateStepCode(step: { action: string; expectedResult: string }, selector: string): string {
  const action = step.action.toLowerCase();

  if (action.includes("click")) {
    return `await page.locator(${selector}).click();`;
  } else if (action.includes("fill") || action.includes("enter") || action.includes("type")) {
    return `await page.locator(${selector}).fill('test-value');`;
  } else if (action.includes("select")) {
    return `await page.locator(${selector}).selectOption('option-1');`;
  } else if (action.includes("hover")) {
    return `await page.locator(${selector}).hover();`;
  } else if (action.includes("check") || action.includes("uncheck")) {
    return `await page.locator(${selector}).setChecked(${action.includes("check")});`;
  } else if (action.includes("navigate") || action.includes("go to")) {
    const urlMatch = step.expectedResult.match(/https?:\/\/[^\s]+/);
    const url = urlMatch ? urlMatch[0] : "/";
    return `await page.goto('${url}');`;
  } else {
    return `// TODO: Implement action for: ${step.action}\n    await page.waitForLoadState();`;
  }
}

/**
 * Generate preconditions setup (auth, data fixtures, etc.)
 */
function generatePreconditionsSetup(testCase: TestCase): string {
  if (testCase.preconditions.length === 0) {
    return "";
  }

  return `  test.beforeEach(async ({ page }) => {
    // Preconditions setup
${testCase.preconditions
  .map((pc) => {
    if (pc.includes("authenticated") || pc.includes("logged in")) {
      return `    // TODO: Implement login flow: ${pc}`;
    } else if (pc.includes("role")) {
      return `    // TODO: Assume role: ${pc}`;
    } else {
      return `    // TODO: Set up: ${pc}`;
    }
  })
  .join("\n")}
  });
`;
}

/**
 * Generate backend verification code (Prisma queries, API assertions)
 */
function generateBackendVerifications(testCase: TestCase): string {
  if (testCase.backendVerification.length === 0) {
    return "";
  }

  const verifications = testCase.backendVerification
    .map((bv) => {
      return `    // Backend Verification: ${bv.query}
    // Expected: ${bv.expectedResult}
    // TODO: Implement backend check (e.g., via API call or database query)`;
    })
    .join("\n\n");

  return `    // ── Backend Verifications ──\n${verifications}`;
}

/**
 * Main node function: transform approved test cases into Playwright specs
 */
export async function playwrightCoderNode(
  state: typeof QAFactoryState.State
): Promise<Partial<typeof QAFactoryState.State>> {
  const { testCases, uiComponents, projectConfig } = state;

  log.info(`Generating Playwright specs for ${testCases.length} approved test cases...`);

  if (testCases.length === 0) {
    log.warn("No test cases to generate specs from");
    return {
      generatedPlaywrightSpecs: [],
      selectorMismatches: [],
      currentAgent: "playwright_coder",
    };
  }

  try {
    // Initialize MCP client for selector verification
    const mcpClient = initPlaywrightMCPClient();

    // Build selector registry from UI components
    const selectorRegistry = buildSelectorRegistry(uiComponents);

    // Generate specs for each test case
    const results: SpecGenerationResult[] = [];
    const allMismatches: Array<{
      testCaseId: string;
      testCaseTitle: string;
      mismatches: SelectorMatch[];
    }> = [];

    for (const testCase of testCases) {
      try {
        // Verify selectors via MCP
        const selectorMatches = await verifyTestCaseSelectors(testCase, selectorRegistry, mcpClient);

        // Track mismatches
        const mismatches = selectorMatches.filter((m) => !m.found);
        if (mismatches.length > 0) {
          allMismatches.push({
            testCaseId: testCase.id,
            testCaseTitle: testCase.title,
            mismatches,
          });
        }

        // Generate spec
        const specContent = generatePlaywrightSpec(
          testCase,
          selectorMatches,
          projectConfig.projectId
        );

        results.push({
          testCaseId: testCase.id,
          specFile: `${testCase.id}.spec.js`,
          content: specContent,
          selectorMatches,
        });

        log.info(`✓ Generated spec for: ${testCase.title}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`Failed to generate spec for ${testCase.title}: ${errMsg}`);
        results.push({
          testCaseId: testCase.id,
          specFile: `${testCase.id}.spec.js`,
          content: "",
          selectorMatches: [],
          errors: [errMsg],
        });
      }
    }

    // Write specs to output directory
    const specsDir = path.resolve(projectConfig.outputPath ?? "./output", projectConfig.projectId, "specs");
    fs.mkdirSync(specsDir, { recursive: true });

    for (const result of results) {
      if (result.content) {
        const specPath = path.join(specsDir, result.specFile);
        fs.writeFileSync(specPath, result.content, "utf-8");
        log.info(`📝 Wrote spec to: ${specPath}`);
      }
    }

    log.info(`Playwright spec generation complete. ${results.length} specs created.`);
    if (allMismatches.length > 0) {
      log.warn(`Found ${allMismatches.length} test case(s) with selector mismatches.`);
    }

    return {
      generatedPlaywrightSpecs: results.map((r) => ({
        testCaseId: r.testCaseId,
        specFile: r.specFile,
        selectorMatches: r.selectorMatches,
        errors: r.errors ?? [],
      })),
      selectorMismatches: allMismatches,
      currentAgent: "playwright_coder",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`PlaywrightCoder failed: ${message}`);
    return {
      errors: [...state.errors, `PlaywrightCoder: ${message}`],
      currentAgent: "playwright_coder",
    };
  }
}
