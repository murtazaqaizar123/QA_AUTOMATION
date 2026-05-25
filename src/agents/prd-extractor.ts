// ─────────────────────────────────────────────────────────────
// agents/prd-extractor.ts — PRD requirements extractor agent
// ─────────────────────────────────────────────────────────────
import { QAFactoryState } from "../graph/state.js";
import { drainQueue } from "../utils/queued-llm.js";
import { getLLM } from "../utils/llm.js";
import { queueRequest } from "../utils/request-queue.js";
import { config } from "../utils/config.js";
import { readFileSafe } from "../utils/file-scanner.js";
import { agentLogger } from "../utils/logger.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import path from "path";

const log = agentLogger("PRDExtractor");

const SYSTEM_PROMPT = `You are a Technical Spec Synthesizer and PRD Section Extractor.
Your goal is to analyze the business requirements from a Project PRD and the current active User Story, and then INFER/DESIGN the structured technical schema, API contracts, and UI components that must exist or be created to implement this feature.

Since this is a Test-Driven Development (TDD) workflow where no code exists yet, you must design these entities cleanly and realistically.

Respond ONLY with valid JSON matching this exact structure:
{
  "prismaModels": [
    {
      "name": "string (Capitalized, e.g. User, DrawRequest)",
      "fields": [
        {
          "name": "string (camelCase)",
          "type": "string (e.g. String, Int, DateTime, Boolean, or model name)",
          "isOptional": boolean,
          "isRelation": boolean,
          "isList": boolean,
          "attributes": ["string (e.g. @id, @default(uuid()), @unique)"]
        }
      ],
      "uniqueConstraints": [["string"]],
      "indexes": [["string"]]
    }
  ],
  "apiEndpoints": [
    {
      "method": "GET|POST|PUT|PATCH|DELETE",
      "path": "string (e.g. /api/draws, /api/users/[id])",
      "handlerFile": "string (relative file path path, e.g. src/app/api/draws/route.ts)",
      "middleware": ["string (guards, e.g. auth, checkRole)"],
      "prismaOperations": ["string (e.g. prisma.drawRequest.create, prisma.drawRequest.findUnique)"],
      "bodyShape": ["string (expected request body param names)"]
    }
  ],
  "uiComponents": [
    {
      "name": "string (PascalCase, e.g. DrawRequestForm, DrawStagesList)",
      "filePath": "string (relative file path, e.g. src/components/DrawRequestForm.tsx)",
      "props": ["string (prop names, e.g. onSubmit, initialData)"],
      "stateHooks": ["string (state hooks, e.g. useState, useMutation)"],
      "apiCalls": ["string (endpoints/actions triggered, e.g. POST /api/draws)"],
      "conditionalRenders": ["string (e.g. showEditButton if admin, showLoader if loading)"],
      "testIds": ["string (data-testid values to use in tests, e.g. submit-btn, draw-amount-input)"]
    }
  ]
}`;

const prdExtractorSchema = z.object({
  prismaModels: z.array(
    z.object({
      name: z.string(),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          isOptional: z.boolean(),
          isRelation: z.boolean(),
          isList: z.boolean(),
          attributes: z.array(z.string()),
          defaultValue: z.string().optional(),
        })
      ),
      uniqueConstraints: z.array(z.array(z.string())),
      indexes: z.array(z.array(z.string())),
    })
  ),
  apiEndpoints: z.array(
    z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string(),
      handlerFile: z.string(),
      middleware: z.array(z.string()),
      prismaOperations: z.array(z.string()),
      bodyShape: z.array(z.string()).optional(),
    })
  ),
  uiComponents: z.array(
    z.object({
      name: z.string(),
      filePath: z.string(),
      props: z.array(z.string()),
      stateHooks: z.array(z.string()),
      apiCalls: z.array(z.string()),
      conditionalRenders: z.array(z.string()),
      testIds: z.array(z.string()),
    })
  ),
});

export async function prdExtractorNode(
  state: typeof QAFactoryState.State
): Promise<Partial<typeof QAFactoryState.State>> {
  const { projectConfig, userStory, relevantSemanticFacts } = state;
  log.info(`Extracting technical specifications from PRD for TDD: ${projectConfig.prdPath}`);

  const prdContent = readFileSafe(path.resolve(projectConfig.prdPath)) ?? "No PRD file found.";

  const userPrompt = `
## Project PRD (Business Requirements)
${prdContent.slice(0, 6000)}

## Previous Known Facts
${relevantSemanticFacts.join("\n")}

## Active User Story (Scope)
${userStory}

Analyze the requirements and extract the inferred Prisma Models, API Endpoints, and UI Components required for this user story. Ensure you output ONLY valid JSON matching the schema.`;

  let response: any;
  try {
    response = await queueRequest(async () => {
      const baseLlm = getLLM({ temperature: 0.1 });
      const llm = config.llmProvider === "ollama"
        ? baseLlm.bind({ format: "json" })
        : baseLlm.bind({ response_format: { type: "json_object" } });
      return await llm.invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(userPrompt)]);
    }, 2); // High priority

    const text = typeof response.content === "string" ? response.content : JSON.stringify(response);

    // Prefer JSON inside ```json code fences, else use first {...} block
    const fence = text.match(/```(?:json\s*)?([\s\S]*?)```/i);
    const jsonText = fence ? fence[1] : (text.match(/\{[\s\S]*\}/) ?? [])[0];
    if (!jsonText) throw new Error("No JSON found in LLM response");

    const parsedRaw = JSON.parse(jsonText);
    const validated = prdExtractorSchema.parse(parsedRaw);

    // Drain remaining queued requests
    await drainQueue();

    log.info(
      `PRD Extraction complete — inferred models: ${validated.prismaModels.length}, ` +
      `endpoints: ${validated.apiEndpoints.length}, ` +
      `components: ${validated.uiComponents.length}`
    );

    return {
      prismaModels: validated.prismaModels,
      apiEndpoints: validated.apiEndpoints,
      uiComponents: validated.uiComponents,
      scanStatus: "complete",
      currentAgent: "prd_extractor",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`PRD Extractor failed: ${message}`);
    if (response) {
      const text = typeof response.content === "string" ? response.content : JSON.stringify(response);
      log.error(`Raw LLM Response content was:\n${text.slice(0, 2000)}`);
    }
    return {
      scanStatus: "error",
      errors: [...state.errors, `PRD Extractor: ${message}`],
      currentAgent: "prd_extractor",
    };
  }
}
