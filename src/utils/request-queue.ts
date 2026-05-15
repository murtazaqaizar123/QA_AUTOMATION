// ─────────────────────────────────────────────────────────────
// src/utils/request-queue.ts — LLM Request Queue Manager
// ─────────────────────────────────────────────────────────────
// Manages concurrent LLM requests to Ollama with queue strategy
// Prevents server overload by throttling and serializing requests

import { agentLogger } from "./logger.js";

const log = agentLogger("RequestQueue");

interface QueuedRequest<T> {
  id: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority: number;
  createdAt: number;
}

export class RequestQueue {
  private queue: QueuedRequest<any>[] = [];
  private activeRequests = 0;
  private maxConcurrency: number;
  private totalProcessed = 0;
  private totalFailed = 0;

  constructor(maxConcurrency = 1) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Enqueue an async function to be executed with concurrency limits
   * @param fn Async function to execute
   * @param priority Higher priority items executed first (default 0)
   * @returns Promise that resolves when the request completes
   */
  async enqueue<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: `req_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        fn,
        resolve,
        reject,
        priority,
        createdAt: Date.now(),
      };

      // Insert at appropriate position based on priority
      let inserted = false;
      for (let i = 0; i < this.queue.length; i++) {
        if (priority > this.queue[i].priority) {
          this.queue.splice(i, 0, request);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        this.queue.push(request);
      }

      log.debug(`Enqueued request (priority: ${priority}, queue size: ${this.queue.length + this.activeRequests})`);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.activeRequests >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    this.activeRequests++;
    const request = this.queue.shift()!;

    try {
      log.debug(`Processing request (active: ${this.activeRequests}/${this.maxConcurrency}, queued: ${this.queue.length})`);
      const result = await request.fn();
      request.resolve(result);
      this.totalProcessed++;
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
      this.totalFailed++;
    } finally {
      this.activeRequests--;
      log.debug(`Request completed. Active: ${this.activeRequests}, Queued: ${this.queue.length}`);
      
      // Process next item in queue
      if (this.queue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  /**
   * Get current queue statistics
   */
  getStats() {
    return {
      active: this.activeRequests,
      queued: this.queue.length,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * Wait for all pending requests to complete
   */
  async drain(): Promise<void> {
    while (this.activeRequests > 0 || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Set max concurrency (useful for dynamic adjustment)
   */
  setConcurrency(max: number): void {
    this.maxConcurrency = Math.max(1, max);
    log.info(`Queue concurrency updated to: ${this.maxConcurrency}`);
    // Trigger immediate processing if we can handle more
    this.processQueue();
  }
}

// ── Global singleton queue instance ────────────────────────────
// Default: 1 concurrent request at a time to Ollama
// Can be adjusted via setConcurrency() or environment variable
const defaultMaxConcurrency = Math.max(1, parseInt(process.env.OLLAMA_MAX_CONCURRENT || "1", 10));
const globalQueue = new RequestQueue(defaultMaxConcurrency);

export function getRequestQueue(): RequestQueue {
  return globalQueue;
}

/**
 * Utility: execute a function through the global queue
 * @param fn Async function to execute
 * @param priority Optional priority (higher = sooner)
 */
export async function queueRequest<T>(fn: () => Promise<T>, priority?: number): Promise<T> {
  return globalQueue.enqueue(fn, priority);
}
