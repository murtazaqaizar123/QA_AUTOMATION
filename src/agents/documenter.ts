// ─────────────────────────────────────────────────────────────
// agents/documenter.ts — Technical PRD generator agent
// ─────────────────────────────────────────────────────────────
import { QAFactoryState } from "../graph/state.js";
import { getLLM } from "../utils/llm.js";
import { readFileSafe } from "../utils/file-scanner.js";
import { TechnicalPRD, GapAnalysisItem } from "../types/documents.js";
import { agentLogger } from "../utils/logger.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import path from "path";

const log = agentLogger("Documenter");

const SYSTEM_PROMPT = `You are a Technical PRD Generator. 
You receive:
1. A Project PRD (business requirements)
2. A codebase scan result (what the code actually does)
3. A User Story that defines the current scope

Your job is to:
- Summarize the data/API/UI layers in terms of what they ACTUALLY implement
- Identify the authentication model
- Perform gap analysis: what does the PRD promise that the code doesn't deliver?

Respond ONLY with valid JSON matching this structure:
{
  "authModel": {
    "strategy": "string",
    "roles": ["string"],
    "middleware": ["string"],
    "guardPattern": "string or null"
  },
  "dataLayerSummary": "string",
  "apiLayerSummary": "string", 
  "uiLayerSummary": "string",
  "gaps": [
    {
      "area": "data|api|ui|auth|integration",
      "businessRequirement": "string",
      "technicalReality": "string",
      "severity": "critical|major|minor",
      "recommendation": "string"
    }
  ]
}`;

export async function documenterNode(
  state: typeof QAFactoryState.State
): Promise<Partial<typeof QAFactoryState.State>> {
  const {
    projectConfig, userStory,
    prismaModels, apiEndpoints, uiComponents,
    relevantSemanticFacts,
  } = state;

  log.info("Generating Technical PRD...");

  // Read the project PRD
  const prdContent = readFileSafe(
    path.resolve(projectConfig.prdPath)
  ) ?? "No PRD file found.";

  // Build the scan context (scoped to user story relevance)
  const scanSummary = {
    models: prismaModels.map((m) => ({
      name: m.name,
      fields: m.fields.map((f) => `${f.name}:${f.type}${f.isOptional ? "?" : ""}`),
      dbTable: m.dbTable,
    })),
    endpoints: apiEndpoints.map((e) => ({
      method: e.method,
      path: e.path,
      middleware: e.middleware,
      prismaOps: e.prismaOperations,
    })),
    components: uiComponents.slice(0, 30).map((c) => ({
      name: c.name,
      hooks: c.stateHooks,
      apiCalls: c.apiCalls,
      conditionals: c.conditionalRenders,
    })),
  };

  const userPrompt = `
## Project PRD (Business Requirements)
${prdContent.slice(0, 6000)}

## Codebase Scan
${JSON.stringify(scanSummary, null, 2).slice(0, 6000)}

## Previous Known Facts
${relevantSemanticFacts.join("\n")}

## Active User Story (Scope)
${userStory}

Generate the Technical PRD JSON now.`;

  try {
    const llm = getLLM({ temperature: 0.1 });
    const response = await llm.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(userPrompt),
    ]);

    const text = typeof response.content === "string" ? response.content : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("LLM returned no valid JSON");

    const parsed = JSON.parse(jsonMatch[0]);

    const gapAnalysis: GapAnalysisItem[] = (parsed.gaps ?? []).map(
      (g: Omit<GapAnalysisItem, "id">) => ({
        id: uuidv4(),
        area: g.area,
        businessRequirement: g.businessRequirement,
        technicalReality: g.technicalReality,
        severity: g.severity,
        recommendation: g.recommendation,
      })
    );

    const technicalPRD: TechnicalPRD = {
      projectId: projectConfig.projectId,
      generatedAt: new Date().toISOString(),
      userStoryScope: userStory,
      authModel: parsed.authModel ?? { strategy: "unknown", roles: [], middleware: [] },
      dataLayerSummary: parsed.dataLayerSummary ?? "",
      apiLayerSummary: parsed.apiLayerSummary ?? "",
      uiLayerSummary: parsed.uiLayerSummary ?? "",
      gaps: gapAnalysis,
    };

    log.info(`Technical PRD generated. Found ${gapAnalysis.length} gaps.`);

    return {
      technicalPRD,
      gapAnalysis,
      currentAgent: "documenter",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Documenter failed: ${message}`);
    return {
      errors: [...state.errors, `Documenter: ${message}`],
      currentAgent: "documenter",
    };
  }
}
