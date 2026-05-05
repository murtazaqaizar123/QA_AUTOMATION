// ─────────────────────────────────────────────────────────────
// agents/memory-manager.ts — Recall & Persist phases
// ─────────────────────────────────────────────────────────────
import { QAFactoryState } from "../graph/state.js";
import { querySemanticFacts, upsertSemanticFacts } from "../memory/semantic-store.js";
import { queryProceduralRules, upsertProceduralRule } from "../memory/procedural-store.js";
import { getLLM } from "../utils/llm.js";
import { agentLogger } from "../utils/logger.js";
import { HumanMessage } from "@langchain/core/messages";

const log = agentLogger("MemoryManager");

// ── Recall Phase ──────────────────────────────────────────────

export async function memoryRecallNode(
  state: typeof QAFactoryState.State
): Promise<Partial<typeof QAFactoryState.State>> {
  const { projectConfig, userStory } = state;
  log.info(`Recalling memory for project: ${projectConfig.projectId}`);

  const [semanticFacts, proceduralRules] = await Promise.all([
    querySemanticFacts(projectConfig.projectId, userStory, 12),
    queryProceduralRules(userStory, 8),
  ]);

  log.info(
    `Recalled ${semanticFacts.length} semantic facts, ${proceduralRules.length} procedural rules`
  );

  return {
    relevantSemanticFacts: semanticFacts,
    relevantProceduralRules: proceduralRules,
    currentAgent: "memory-recall",
  };
}

// ── Persist Phase ─────────────────────────────────────────────

/**
 * Use the LLM to determine if a piece of human feedback is a
 * generalizable testing rule (procedural) or a project-specific fact (semantic).
 */
async function classifyFeedback(
  feedback: string
): Promise<{ isRule: boolean; ruleText?: string }> {
  const llm = getLLM({ temperature: 0 });
  const prompt = `You are classifying human QA feedback. 
Determine if the following feedback contains a GENERALIZABLE TESTING RULE 
(a principle that applies to any project, e.g. "always check loading states") 
or if it is PROJECT-SPECIFIC (only relevant to this codebase).

Feedback: "${feedback}"

Respond with JSON only:
{ "isRule": true/false, "ruleText": "concise imperative rule if isRule is true, else null" }`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  try {
    const text = typeof response.content === "string" ? response.content : "";
    const json = text.match(/\{[^}]+\}/)?.[0] ?? "{}";
    return JSON.parse(json);
  } catch {
    return { isRule: false };
  }
}

export async function memoryPersistNode(
  state: typeof QAFactoryState.State
): Promise<Partial<typeof QAFactoryState.State>> {
  const { projectConfig, technicalPRD, gapAnalysis, humanFeedback } = state;
  log.info(`Persisting memory for project: ${projectConfig.projectId}`);

  // 1. Persist semantic facts from this run
  const factsToStore = [];

  if (technicalPRD) {
    factsToStore.push({
      projectId: projectConfig.projectId,
      entity: "auth-model",
      factType: "auth-model" as const,
      content: `Auth strategy: ${technicalPRD.authModel.strategy}. Roles: ${technicalPRD.authModel.roles.join(", ")}. Middleware: ${technicalPRD.authModel.middleware.join(", ")}.`,
      timestamp: new Date().toISOString(),
    });

    if (technicalPRD.dataLayerSummary) {
      factsToStore.push({
        projectId: projectConfig.projectId,
        entity: "data-layer",
        factType: "general" as const,
        content: technicalPRD.dataLayerSummary,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Persist gap analysis findings
  for (const gap of gapAnalysis) {
    factsToStore.push({
      projectId: projectConfig.projectId,
      entity: gap.area,
      factType: "gap-analysis" as const,
      content: `GAP [${gap.severity}]: ${gap.businessRequirement} → ${gap.technicalReality}. Recommendation: ${gap.recommendation}`,
      timestamp: new Date().toISOString(),
    });
  }

  if (factsToStore.length > 0) {
    await upsertSemanticFacts(factsToStore);
    log.info(`Persisted ${factsToStore.length} semantic facts`);
  }

  // 2. Classify and persist procedural rule from human feedback
  if (humanFeedback) {
    const classification = await classifyFeedback(humanFeedback);
    if (classification.isRule && classification.ruleText) {
      await upsertProceduralRule({
        rule: classification.ruleText,
        category: "general",
        source: "hitl",
        createdBy: "human-reviewer",
        appliedCount: 0,
        timestamp: new Date().toISOString(),
      });
      log.info(`Persisted new procedural rule from HITL: "${classification.ruleText}"`);
    }
  }

  return { currentAgent: "memory-persist" };
}
