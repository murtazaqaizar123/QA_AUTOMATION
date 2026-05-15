// ─────────────────────────────────────────────────────────────
// src/utils/queued-llm.ts — Queued LLM Invocations
// ─────────────────────────────────────────────────────────────
// Wraps LLM.invoke() calls through the request queue
// Ensures Ollama doesn't get overwhelmed with concurrent requests

import { BaseMessage } from "@langchain/core/messages";
import { getLLM } from "./llm.js";
import { getRequestQueue, queueRequest } from "./request-queue.js";
import { agentLogger } from "./logger.js";

const log = agentLogger("QueuedLLM");

/**
 * Queue an LLM invoke call through the request queue
 * Automatically throttles to prevent Ollama overload
 * 
 * @param messages Messages to send to LLM
 * @param options LLM options (temperature, model)
 * @param priority Queue priority (higher = sooner)
 * @returns Promise resolving to LLM response
 */
export async function queuedLLMInvoke(
  messages: BaseMessage[],
  options?: { temperature?: number; modelOverride?: string },
  priority = 0
) {
  const requestName = `LLM[${messages[messages.length - 1]?.content?.toString().slice(0, 50) || "invoke"}...]`;
  
  return queueRequest(async () => {
    log.debug(`Executing queued LLM call: ${requestName}`);
    const llm = getLLM(options);
    const result = await llm.invoke(messages);
    log.debug(`Queued LLM call completed: ${requestName}`);
    return result;
  }, priority);
}

/**
 * Get a stringified queue status for logging
 */
export function getQueueStatus(): string {
  const queue = getRequestQueue();
  const stats = queue.getStats();
  return `[Queue: ${stats.queued} queued, ${stats.active}/${stats.maxConcurrency} active, ${stats.totalProcessed} processed, ${stats.totalFailed} failed]`;
}

/**
 * Wait for all queued requests to complete
 * Useful at end of agents/workflow steps
 */
export async function drainQueue(): Promise<void> {
  const queue = getRequestQueue();
  const stats = queue.getStats();
  if (stats.queued > 0 || stats.active > 0) {
    log.info(`Draining queue... ${stats.queued} queued, ${stats.active} active`);
    await queue.drain();
    log.info("Queue drained.");
  }
}
