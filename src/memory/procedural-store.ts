// ─────────────────────────────────────────────────────────────
// memory/procedural-store.ts — Cross-project procedural rules CRUD
// ─────────────────────────────────────────────────────────────
import { v4 as uuidv4 } from "uuid";
import { qdrant } from "./qdrant-client.js";
import { getEmbeddings } from "../utils/llm.js";
import { config } from "../utils/config.js";

const COLLECTION = config.qdrant.proceduralCollection;

export type RuleCategory =
  | "ui-testing"
  | "api-testing"
  | "auth-testing"
  | "data-validation"
  | "error-handling"
  | "general";

export interface ProceduralRule {
  id?: string;
  /** The rule itself as a concise imperative statement */
  rule: string;
  category: RuleCategory;
  /** "hitl" = came from human feedback, "system" = built-in */
  source: "hitl" | "system";
  createdBy?: string;
  /** How many times this rule has been applied */
  appliedCount?: number;
  timestamp: string;
}

/**
 * Upsert a procedural rule (shared across all projects).
 */
export async function upsertProceduralRule(rule: ProceduralRule): Promise<void> {
  const embeddings = getEmbeddings();
  const [vector] = await embeddings.embedDocuments([rule.rule]);

  await qdrant.upsert(COLLECTION, {
    wait: true,
    points: [
      {
        id: rule.id ?? uuidv4(),
        vector,
        payload: {
          rule: rule.rule,
          category: rule.category,
          source: rule.source,
          createdBy: rule.createdBy ?? null,
          appliedCount: rule.appliedCount ?? 0,
          timestamp: rule.timestamp,
        },
      },
    ],
  });
}

/**
 * Query procedural rules relevant to a given testing context.
 * These are global — no project filter applied.
 */
export async function queryProceduralRules(
  context: string,
  topK = 8
): Promise<string[]> {
  const embeddings = getEmbeddings();
  const safeContext = context.substring(0, 1500); // Prevent context length errors
  const [vector] = await embeddings.embedDocuments([safeContext]);

  const results = await qdrant.search(COLLECTION, {
    vector,
    limit: topK,
    with_payload: true,
  });

  return results.map((r) => r.payload?.["rule"] as string).filter(Boolean);
}

/**
 * Seed built-in procedural rules on first run.
 * Idempotent — won't duplicate if already seeded (uses stable IDs).
 */
export async function seedBuiltInRules(): Promise<void> {
  const builtInRules: ProceduralRule[] = [
    {
      id: "00000000-0000-0000-0000-000000000001",
      rule: "Always verify that the loading/spinner state is visible before data loads.",
      category: "ui-testing",
      source: "system",
      timestamp: new Date().toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      rule: "Always verify that unauthorized roles receive a 403 response, not just a UI redirect.",
      category: "auth-testing",
      source: "system",
      timestamp: new Date().toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000003",
      rule: "For every create/update operation, verify the database record directly using a Prisma query.",
      category: "data-validation",
      source: "system",
      timestamp: new Date().toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000004",
      rule: "Always test the empty/zero-state UI when no records exist for a list view.",
      category: "ui-testing",
      source: "system",
      timestamp: new Date().toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000005",
      rule: "Verify that soft-deleted records are excluded from list queries.",
      category: "data-validation",
      source: "system",
      timestamp: new Date().toISOString(),
    },
    {
      id: "00000000-0000-0000-0000-000000000006",
      rule: "For form submissions, test with boundary values: empty string, max-length+1, special characters.",
      category: "ui-testing",
      source: "system",
      timestamp: new Date().toISOString(),
    },
  ];

  for (const rule of builtInRules) {
    await upsertProceduralRule(rule);
  }
}
