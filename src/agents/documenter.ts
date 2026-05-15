// ─────────────────────────────────────────────────────────────
// agents/documenter.ts — Technical PRD generator agent
// ─────────────────────────────────────────────────────────────
import { QAFactoryState } from "../graph/state.js";
import { getLLM } from "../utils/llm.js";
import { queuedLLMInvoke, drainQueue } from "../utils/queued-llm.js";
import { readFileSafe } from "../utils/file-scanner.js";
import { TechnicalPRD, GapAnalysisItem } from "../types/documents.js";
import { agentLogger } from "../utils/logger.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
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

const documenterSchema = z.object({
  authModel: z.object({
    strategy: z.string(),
    roles: z.array(z.string()),
    middleware: z.array(z.string()),
    guardPattern: z.string().nullable().optional(),
  }),
  dataLayerSummary: z.string(),
  apiLayerSummary: z.string(),
  uiLayerSummary: z.string(),
  gaps: z.array(
    z.object({
      area: z.enum(["data", "api", "ui", "auth", "integration"]),
      businessRequirement: z.string(),
      technicalReality: z.string(),
      severity: z.enum(["critical", "major", "minor"]),
      recommendation: z.string(),
    })
  ),
});

export async function documenterNode(
  state: typeof QAFactoryState.State
): Promise<Partial<typeof QAFactoryState.State>> {
  const {
    projectConfig,
    userStory,
    prismaModels,
    apiEndpoints,
    uiComponents,
    relevantSemanticFacts,
  } = state;

  log.info("Generating Technical PRD...");

  const prdContent = readFileSafe(path.resolve(projectConfig.prdPath)) ?? "No PRD file found.";

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

  // Primary attempt: structured output bound to our Zod schema
  try {
    const llm = getLLM({ temperature: 0.1 });
    const structuredLlm = (llm as any).withStructuredOutput(documenterSchema, { name: "TechnicalPRD" });
    const parsed: any = await queuedLLMInvoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(userPrompt)], { temperature: 0.1 }, 2); // Higher priority

    const gapAnalysis: GapAnalysisItem[] = (parsed.gaps ?? []).map((g: any) => ({
      id: uuidv4(),
      area: g.area,
      businessRequirement: g.businessRequirement,
      technicalReality: g.technicalReality,
      severity: g.severity,
      recommendation: g.recommendation,
    }));

    const normalizedAuth = (parsed.authModel ?? { strategy: "unknown", roles: [], middleware: [] }) as any;
    if (normalizedAuth.guardPattern === null) delete normalizedAuth.guardPattern;
    const technicalPRD: TechnicalPRD = {
      projectId: projectConfig.projectId,
      generatedAt: new Date().toISOString(),
      userStoryScope: userStory,
      authModel: normalizedAuth,
      dataLayerSummary: parsed.dataLayerSummary ?? "",
      apiLayerSummary: parsed.apiLayerSummary ?? "",
      uiLayerSummary: parsed.uiLayerSummary ?? "",
      gaps: gapAnalysis,
    };

    log.info(`Technical PRD generated. Found ${gapAnalysis.length} gaps.`);

    return { technicalPRD, gapAnalysis, currentAgent: "documenter" };
  } catch (structuredErr) {
    const msg = structuredErr instanceof Error ? structuredErr.message : String(structuredErr);
    log.warn(`Structured output failed: ${msg}. Falling back to flexible parser.`);

    // Fallback: accept looser JSON shapes and map to our schema
    try {
      const llmRaw = getLLM({ temperature: 0.1 });
      const response: any = await queuedLLMInvoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(userPrompt)], { temperature: 0.1 }, 2); // Higher priority
      const text = typeof response.content === "string" ? response.content : JSON.stringify(response);

      // Prefer JSON inside ```json code fences, else use first {...} block
      const fence = text.match(/```(?:json\s*)?([\s\S]*?)```/i);
      const jsonText = fence ? fence[1] : (text.match(/\{[\s\S]*\}/) ?? [])[0];
      if (!jsonText) throw new Error("No JSON found in LLM response");

      const parsedRaw = JSON.parse(jsonText);

      const mapped = {
        authModel: parsedRaw.authModel ?? { strategy: "unknown", roles: [], middleware: [], guardPattern: null },
        dataLayerSummary:
          parsedRaw.dataLayerSummary ?? (parsedRaw.technical_specifications ? JSON.stringify(parsedRaw.technical_specifications.data_model, null, 2) : String(parsedRaw.project_name ?? "")),
        apiLayerSummary:
          parsedRaw.apiLayerSummary ?? (parsedRaw.technical_specifications ? JSON.stringify(parsedRaw.technical_specifications.api_endpoints, null, 2) : ""),
        uiLayerSummary:
          parsedRaw.uiLayerSummary ?? (parsedRaw.technical_specifications ? JSON.stringify(parsedRaw.technical_specifications.ui_components, null, 2) : ""),
        gaps: parsedRaw.gaps ?? [],
      };

      const validated = documenterSchema.parse(mapped);

      const gapAnalysis: GapAnalysisItem[] = (validated.gaps ?? []).map((g: any) => ({
        id: uuidv4(),
        area: g.area,
        businessRequirement: g.businessRequirement,
        technicalReality: g.technicalReality,
        severity: g.severity,
        recommendation: g.recommendation,
      }));

      const normalizedAuth = (validated.authModel ?? { strategy: "unknown", roles: [], middleware: [] }) as any;
      if (normalizedAuth.guardPattern === null) delete normalizedAuth.guardPattern;
      const technicalPRD: TechnicalPRD = {
        projectId: projectConfig.projectId,
        generatedAt: new Date().toISOString(),
        userStoryScope: userStory,
        authModel: normalizedAuth,
        dataLayerSummary: validated.dataLayerSummary ?? "",
        apiLayerSummary: validated.apiLayerSummary ?? "",
        uiLayerSummary: validated.uiLayerSummary ?? "",
        gaps: gapAnalysis,
      };

      // Drain remaining queued requests
      await drainQueue();

      log.info(`Technical PRD generated (fallback). Found ${gapAnalysis.length} gaps.`);
      return { technicalPRD, gapAnalysis, currentAgent: "documenter" };
    } catch (fallbackErr) {
      const fm = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      log.error(`Documenter failed (fallback): ${fm}`);
      return { errors: [...state.errors, `Documenter: ${fm}`], currentAgent: "documenter" };
    }
  }
}
