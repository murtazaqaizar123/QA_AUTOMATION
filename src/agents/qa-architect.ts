// ─────────────────────────────────────────────────────────────
// agents/qa-architect.ts — Test case generator agent
// ─────────────────────────────────────────────────────────────
import { QAFactoryState } from "../graph/state.js";
import { getLLM } from "../utils/llm.js";
import { queuedLLMInvoke, drainQueue, getQueueStatus } from "../utils/queued-llm.js";
import { TestCase, TestSuite } from "../types/test-case.js";
import { TechnicalPRD } from "../types/documents.js";
import { agentLogger } from "../utils/logger.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";

const log = agentLogger("QAArchitect");

const SYSTEM_PROMPT = `You are an elite QA Architect specializing in production-grade test case generation.

You receive a Technical PRD, gap analysis, user story, and procedural rules.

Generate comprehensive test cases using a **PAIRED SCENARIO STRATEGY**.
For every core feature or action you identify, you MUST generate at least one POSITIVE test case and its exact corresponding NEGATIVE or EDGE test case. 

Example Pairing:
- (+) Add a new Phase with valid data
- (-) Attempt to add a Phase with empty name / missing role

This ensures every single feature is tested for both success and failure modes. You must go into extreme detail so that every single bit of the UI, data validation, and role authorization is tested.

Mandatory Categories for each feature:
1. POSITIVE — happy path, valid data, authorized role
2. NEGATIVE/EDGE — invalid inputs, unauthorized access, missing required fields, extremely long strings, etc.

DEPTH REQUIREMENT:
Every test case MUST include:
- Specific Prisma queries for backend verification
- Exact API response codes and body shapes
- Specific DOM selectors or data-testid attributes
- Role-based preconditions

Apply the procedural rules to every applicable test case.

CRITICAL INSTRUCTION ON VOLUME AND PAIRING:
Generate a compact, reliable set of scenarios. Prefer 2 to 4 paired scenarios per feature, not 10 to 15.
Every positive test case MUST have a matching negative/edge case immediately following it.
Keep each step concise so the response stays small and fast to generate.

Respond ONLY with valid JSON:
{
  "testCases": [
    {
      "category": "positive|negative|edge",
      "title": "string",
      "preconditions": ["string"],
      "steps": [
        {
          "stepNumber": 1,
          "action": "string",
          "expectedResult": "string",
          "verification": "string (DOM selector, API assertion, or DB query)"
        }
      ],
      "backendVerification": [
        {
          "query": "prisma.model.operation({...})",
          "expectedResult": "string"
        }
      ],
      "mutationNote": "string or null"
    }
  ],
  "mutationInsights": ["string"]
}`;

// ── Helper: extract feature groups from the user story ─────────

async function extractFeatureGroups(userStory: string, llm: ReturnType<typeof getLLM>): Promise<string[]> {
  const response = await queuedLLMInvoke([
    new SystemMessage("You are a QA analyst. Extract all distinct testable feature groups from the user story. Each feature group should represent one specific user action or UI behavior (e.g., 'Add Phase', 'Delete Phase', 'Import CSV', etc.)."),
    new HumanMessage(`User Story:\n${userStory}\n\nRespond ONLY with a JSON array of short feature group names:\n["feature 1", "feature 2", ...]`),
  ], { temperature: 0.2 }, 1); // priority 1 = higher priority for initial feature extraction
  const text = typeof response.content === "string" ? response.content : "";
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return ["All Features"];
  try { return JSON.parse(match[0]); } catch { return ["All Features"]; }
}

// ── Helper: generate paired test cases for one feature group ────

async function generateForFeature(
  feature: string,
  userStory: string,
  technicalPRD: TechnicalPRD | null,
  gapAnalysis: Array<{ severity: string; area: string; businessRequirement: string; technicalReality: string }>,
  relevantProceduralRules: string[],
  projectConfig: { projectName: string; projectId: string },
  llm: ReturnType<typeof getLLM>,
): Promise<{ testCases: Array<Record<string, unknown>>; mutationInsights: string[] }> {
  const prompt = `
## Feature to Test
${feature}

## Full User Story (for context)
${userStory}

## Technical PRD
Auth: ${JSON.stringify(technicalPRD?.authModel ?? {})}
Data Layer: ${technicalPRD?.dataLayerSummary ?? "N/A"}
API Layer: ${technicalPRD?.apiLayerSummary ?? "N/A"}
UI Layer: ${technicalPRD?.uiLayerSummary ?? "N/A"}

## Gap Analysis
${gapAnalysis.map((g) => `[${g.severity.toUpperCase()}] ${g.area}: ${g.businessRequirement} → ${g.technicalReality}`).join("\n")}

## Procedural Testing Rules (MUST apply)
${relevantProceduralRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

Project: ${projectConfig.projectName} (${projectConfig.projectId})

For the feature "${feature}", generate paired test cases:
1. One POSITIVE scenario (valid data, correct role, happy path)
2. One NEGATIVE or EDGE scenario (invalid inputs, wrong role, boundary values, or concurrent access)
3. Keep the response concise and focused on the core assertions

Generate test cases now.`;

  const response = await queuedLLMInvoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(prompt),
  ], { temperature: 0.2 }, 0); // priority 0 = normal priority for feature generation
  const text = typeof response.content === "string" ? response.content : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { testCases: [], mutationInsights: [] };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      testCases: parsed.testCases ?? [],
      mutationInsights: parsed.mutationInsights ?? [],
    };
  } catch {
    return { testCases: [], mutationInsights: [] };
  }
}

// ── Main Agent Node ───────────────────────────────────────────────

export async function qaArchitectNode(
  state: typeof QAFactoryState.State
): Promise<Partial<typeof QAFactoryState.State>> {
  const {
    projectConfig, userStory, technicalPRD, gapAnalysis,
    relevantProceduralRules, humanFeedback, iterationCount,
  } = state;

  log.info(
    `Generating test cases (iteration ${iterationCount + 1}) for: "${userStory.slice(0, 80)}..."`
  );

  try {
    const llm = getLLM({ temperature: 0.2 });

    // Step 1: Extract all feature groups from the user story
    log.info("Extracting feature groups from user story...");
    const featureGroups = await extractFeatureGroups(userStory, llm);
    log.info(`Found ${featureGroups.length} feature groups: ${featureGroups.join(", ")}`);

    // Step 2: If there's revision feedback, prepend it to SYSTEM_PROMPT context
    const effectiveSystemPrompt = humanFeedback
      ? `${SYSTEM_PROMPT}\n\n## Human Reviewer Feedback (MUST address)\n${humanFeedback}`
      : SYSTEM_PROMPT;
    const effectiveLlm = getLLM({ temperature: 0.2 });
    void effectiveSystemPrompt; // kept for revision feedback compatibility

    // Step 3: Run one generation pass per feature group (sequential)
    const allRawTestCases: Array<Record<string, unknown>> = [];
    const allMutationInsights: string[] = [];

    const cappedFeatures = featureGroups.slice(0, 10);
    if (featureGroups.length > cappedFeatures.length) {
      log.warn(`Capping feature generation to ${cappedFeatures.length} groups to avoid model timeouts.`);
    }

    for (const feature of cappedFeatures) {
      log.info(`Generating paired test cases for feature: "${feature}"`);
      const result = await generateForFeature(
        feature, userStory, technicalPRD, gapAnalysis,
        relevantProceduralRules, projectConfig, effectiveLlm,
      );
      allRawTestCases.push(...result.testCases);
      allMutationInsights.push(...result.mutationInsights);
    }

    // Step 4: Map to typed TestCase objects
    const now = new Date().toISOString();
    const testCases: TestCase[] = allRawTestCases.map(
      (tc) => ({
        id: uuidv4(),
        userStoryRef: userStory,
        projectId: projectConfig.projectId,
        status: "pending_review" as const,
        createdAt: now,
        updatedAt: now,
        category: tc.category as "positive" | "negative" | "edge" ?? "edge",
        title: tc.title as string ?? "Untitled",
        preconditions: tc.preconditions as string[] ?? [],
        steps: tc.steps as TestCase["steps"] ?? [],
        backendVerification: tc.backendVerification as TestCase["backendVerification"] ?? [],
        mutationNote: tc.mutationNote as string ?? null,
      })
    );

    // Drain any remaining queued requests before returning
    await drainQueue();

    log.info(
      `Generated ${testCases.length} test cases from ${cappedFeatures.length} feature group(s): ` +
      `${testCases.filter((t) => t.category === "positive").length} positive, ` +
      `${testCases.filter((t) => t.category === "negative").length} negative, ` +
      `${testCases.filter((t) => t.category === "edge").length} edge`
    );

    return {
      testCases,
      mutationInsights: [...new Set(allMutationInsights)],
      iterationCount: iterationCount + 1,
      currentAgent: "qa-architect",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`QA Architect failed: ${message}`);
    return {
      errors: [...state.errors, `QAArchitect: ${message}`],
      currentAgent: "qa-architect",
    };
  }
}
