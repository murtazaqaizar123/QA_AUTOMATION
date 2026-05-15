// ─────────────────────────────────────────────────────────────
// utils/llm.ts — LLM + embeddings factory
// ─────────────────────────────────────────────────────────────
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { OllamaEmbeddings } from "@langchain/ollama";
import { config } from "./config.js";

/**
 * Returns a chat model instance based on the configured provider.
 */
export function getLLM(options?: { temperature?: number; modelOverride?: string }) {
  if (config.llmProvider === "ollama") {
    return new ChatOllama({
      model: options?.modelOverride ?? process.env.OLLAMA_LLM_MODEL ?? "gemma3:latest",
      temperature: options?.temperature ?? 0.2,
      baseUrl: config.embeddings.baseUrl,
      ...(config.embeddings.apiKey && {
        headers: { Authorization: `Bearer ${config.embeddings.apiKey}` },
      }),
    });
  }

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
