// ─────────────────────────────────────────────────────────────
// parsers/index.ts — Unified parser orchestrator
// ─────────────────────────────────────────────────────────────
import { ProjectConfig } from "../types/project.js";
import { CodebaseScan } from "../types/codebase.js";
import { parsePrismaSchemaFromProject } from "./prisma-parser.js";
import { parseAPIRoutes } from "./api-route-parser.js";
import { parseComponents } from "./component-parser.js";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("Parser");

/**
 * Extract entity keywords from a user story for scope filtering.
 * "As a Builder, I want to create a Draw Request" → ["draw", "request", "builder"]
 */
function extractScopeEntities(userStory: string): string[] {
  const stopWords = new Set([
    "as", "a", "an", "i", "want", "to", "so", "that", "the",
    "can", "my", "and", "or", "with", "for", "is", "be",
  ]);
  return userStory
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Run all parsers for a project and return a unified CodebaseScan.
 */
export async function runParsers(
  project: ProjectConfig,
  userStory: string
): Promise<CodebaseScan> {
  log.info(`Starting codebase scan for project: ${project.projectName}`);

  // 1. Parse Prisma schema
  const prismaSchema = parsePrismaSchemaFromProject(
    project.codebasePath,
    project.prismaSchemaPath
  ) ?? { models: [], enums: [] };

  log.info(
    `Prisma: found ${prismaSchema.models.length} models, ${prismaSchema.enums.length} enums`
  );

  // 2. Parse API routes
  const apiEndpoints = parseAPIRoutes(project.codebasePath);
  log.info(`API: found ${apiEndpoints.length} endpoints`);

  // 3. Parse UI components
  const uiComponents = parseComponents(project.codebasePath);
  log.info(`UI: found ${uiComponents.length} components`);

  // 4. Determine scope entities from user story
  const scopedEntities = extractScopeEntities(userStory);
  log.info(`Scope filter tokens: [${scopedEntities.join(", ")}]`);

  return {
    projectId: project.projectId,
    scannedAt: new Date().toISOString(),
    prismaSchema,
    apiEndpoints,
    uiComponents,
    scopedEntities,
  };
}
