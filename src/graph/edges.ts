// ─────────────────────────────────────────────────────────────
// graph/edges.ts — Conditional edge routing logic
// ─────────────────────────────────────────────────────────────
import { QAFactoryState } from "./state.js";

const MAX_ITERATIONS = 3;

/**
 * After the HITL review gate resolves.
 * - approved → generate Playwright specs → persist memory and finish
 * - revision_requested → loop back to QA Architect (max 3 times)
 * - rejected → end
 * - errors hit → end with error
 */
export function routeAfterReview(
  state: typeof QAFactoryState.State
): "playwright_coder" | "memory_persist" | "qa_architect" | "__end__" {
  if (state.errors.length > 0) return "__end__";

  switch (state.reviewDecision) {
    case "approved":
      return "playwright_coder";
    case "revision_requested":
      if (state.iterationCount >= MAX_ITERATIONS) {
        // Safety valve: after 3 revision loops, stop
        return "__end__";
      }
      return "qa_architect";
    case "rejected":
    default:
      return "__end__";
  }
}

/**
 * After any agent node — if errors occurred, skip to end.
 */
export function routeAfterAgent(
  state: typeof QAFactoryState.State,
  nextNode: string
): string | "__end__" {
  if (state.errors.length > 0) return "__end__";
  return nextNode;
}
