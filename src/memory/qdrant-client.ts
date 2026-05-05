// ─────────────────────────────────────────────────────────────
// memory/qdrant-client.ts — Qdrant connection + collection bootstrap
// ─────────────────────────────────────────────────────────────
import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export const qdrant = new QdrantClient({
  url: config.qdrant.url,
  port: config.qdrant.url.startsWith("https") ? 443 : 6333,
  apiKey: config.qdrant.apiKey || undefined,
  checkCompatibility: false,
});

const VECTOR_SIZE = 1024; // mxbai-embed-large dimension

/**
 * Ensure both Qdrant collections exist.
 * Safe to call multiple times (idempotent).
 */
export async function ensureCollections(): Promise<void> {
  const collections = [
    config.qdrant.semanticCollection,
    config.qdrant.proceduralCollection,
  ];

  for (const name of collections) {
    const exists = await qdrant
      .getCollection(name)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      await qdrant.createCollection(name, {
        vectors: {
          size: VECTOR_SIZE,
          distance: "Cosine",
        },
      });
      logger.info(`Qdrant: created collection "${name}"`);
    } else {
      logger.debug(`Qdrant: collection "${name}" already exists`);
    }
  }
}
