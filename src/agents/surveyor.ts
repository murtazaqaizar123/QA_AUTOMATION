// ─────────────────────────────────────────────────────────────
// agents/surveyor.ts — Codebase scanner agent
// ─────────────────────────────────────────────────────────────
import { QAFactoryState } from "../graph/state.js";
import { runParsers } from "../parsers/index.js";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("Surveyor");

export async function surveyorNode(
  state: typeof QAFactoryState.State
): Promise<Partial<typeof QAFactoryState.State>> {
  const { projectConfig, userStory } = state;
  log.info(`Scanning codebase at: ${projectConfig.codebasePath}`);

  try {
    const scan = await runParsers(projectConfig, userStory);

    log.info(
      `Scan complete — models: ${scan.prismaSchema.models.length}, ` +
      `endpoints: ${scan.apiEndpoints.length}, ` +
      `components: ${scan.uiComponents.length}`
    );

    return {
      prismaModels: scan.prismaSchema.models,
      apiEndpoints: scan.apiEndpoints,
      uiComponents: scan.uiComponents,
      scanStatus: "complete",
      currentAgent: "surveyor",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Surveyor failed: ${message}`);
    return {
      scanStatus: "error",
      errors: [...state.errors, `Surveyor: ${message}`],
      currentAgent: "surveyor",
    };
  }
}
