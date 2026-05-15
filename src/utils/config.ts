// ─────────────────────────────────────────────────────────────
// utils/config.ts — Runtime configuration loader
// ─────────────────────────────────────────────────────────────
import "dotenv/config";
import path from "path";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  llmProvider: optional("LLM_PROVIDER", "openrouter"),
  llm: {
    openrouterApiKey: optional("OPENROUTER_API_KEY", ""),
    model: optional("OPENROUTER_MODEL", "google/gemma-3-27b-it"),
    baseUrl: "https://openrouter.ai/api/v1",
  },
  embeddings: {
    baseUrl: optional("OLLAMA_BASE_URL", "http://localhost:11434"),
    apiKey: optional("OLLAMA_BASE_API", ""),
    model: optional("OLLAMA_EMBEDDING_MODEL", "mxbai-embed-large:latest"),
  },
  qdrant: {
    url: optional("QDRANT_URL", "http://localhost:6333"),
    apiKey: optional("QDRANT_API_KEY", ""),
    semanticCollection: optional("QDRANT_SEMANTIC_COLLECTION", "qa_semantic_facts"),
    proceduralCollection: optional("QDRANT_PROCEDURAL_COLLECTION", "qa_procedural_rules"),
  },
  checkpointer: {
    sqlitePath: optional("SQLITE_DB_PATH", "./qa-factory.sqlite"),
  },
  projects: {
    registryPath: path.resolve(
      optional("PROJECTS_REGISTRY_PATH", "../projects.json")
    ),
  },
  logging: {
    level: optional("LOG_LEVEL", "info"),
  },
} as const;

export type Config = typeof config;
