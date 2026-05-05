// ─────────────────────────────────────────────────────────────
// utils/llm.ts — OpenRouter LLM + OpenAI Embeddings factory
// ─────────────────────────────────────────────────────────────
import { ChatOpenAI } from "@langchain/openai";
import { OllamaEmbeddings } from "@langchain/ollama";
import { config } from "./config.js";

/**
 * Returns a ChatOpenAI instance pointed at OpenRouter.
 * Model defaults to the one in .env (google/gemma-3-27b-it).
 */
export function getLLM(options?: { temperature?: number; modelOverride?: string }) {
  return new ChatOpenAI({
    model: options?.modelOverride ?? config.llm.model,
    temperature: options?.temperature ?? 0.2,
    apiKey: config.llm.openrouterApiKey,
    configuration: {
      baseURL: config.llm.baseUrl,
      defaultHeaders: {
        "HTTP-Referer": "https://qa-factory.local",
        "X-Title": "QA Factory",
      },
    },
  });
}

/**
 * Returns an Ollama Embeddings instance.
 */
export function getEmbeddings() {
  return new OllamaEmbeddings({
    model: config.embeddings.model,
    baseUrl: config.embeddings.baseUrl,
    ...(config.embeddings.apiKey && {
      headers: { Authorization: `Bearer ${config.embeddings.apiKey}` },
    }),
  });
}
