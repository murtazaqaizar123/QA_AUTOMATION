// ─────────────────────────────────────────────────────────────
// memory/semantic-store.ts — Project-scoped semantic facts CRUD
// ─────────────────────────────────────────────────────────────
import { v4 as uuidv4 } from "uuid";
import { qdrant } from "./qdrant-client.js";
import { getEmbeddings } from "../utils/llm.js";
import { config } from "../utils/config.js";

const COLLECTION = config.qdrant.semanticCollection;

export type FactType =
  | "prisma-model"
  | "api-endpoint"
  | "ui-component"
  | "auth-model"
  | "gap-analysis"
  | "general";

export interface SemanticFact {
  id?: string;
  projectId: string;
  entity: string;       // e.g. "Draw", "/api/draws"
  factType: FactType;
  content: string;      // The actual fact as a human-readable string
  sourceFile?: string;
  timestamp: string;
}

/**
 * Upsert a semantic fact into Qdrant.
 */
export async function upsertSemanticFact(fact: SemanticFact): Promise<void> {
  const embeddings = getEmbeddings();
  const [vector] = await embeddings.embedDocuments([fact.content]);

  await qdrant.upsert(COLLECTION, {
    wait: true,
    points: [
      {
        id: fact.id ?? uuidv4(),
        vector,
        payload: {
          projectId: fact.projectId,
          entity: fact.entity,
          factType: fact.factType,
          content: fact.content,
          sourceFile: fact.sourceFile ?? null,
          timestamp: fact.timestamp,
        },
      },
    ],
  });
}

/**
 * Query semantic facts scoped to a project.
 * Returns top-k most relevant facts as plain strings.
 */
export async function querySemanticFacts(
  projectId: string,
  query: string,
  topK = 10
): Promise<string[]> {
  const embeddings = getEmbeddings();
  const safeQuery = query.substring(0, 1500); // Prevent context length errors
  const [vector] = await embeddings.embedDocuments([safeQuery]);

  const results = await qdrant.search(COLLECTION, {
    vector,
    limit: topK,
    filter: {
      must: [{ key: "projectId", match: { value: projectId } }],
    },
    with_payload: true,
  });

  return results.map((r) => r.payload?.["content"] as string).filter(Boolean);
}

/**
 * Upsert multiple facts in bulk (used during Memory Persist phase).
 */
export async function upsertSemanticFacts(facts: SemanticFact[]): Promise<void> {
  for (const fact of facts) {
    await upsertSemanticFact(fact);
  }
}
