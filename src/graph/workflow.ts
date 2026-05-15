// ─────────────────────────────────────────────────────────────
// graph/workflow.ts — LangGraph graph builder + compile
// ─────────────────────────────────────────────────────────────
import { StateGraph, START, END, interrupt, MemorySaver } from "@langchain/langgraph";
// NOTE: Using MemorySaver for zero-native-dependency dev setup.
// For production persistence, replace with SqliteSaver or PostgresSaver
// after installing @langchain/langgraph-checkpoint-sqlite (requires build tools).
import { QAFactoryState } from "./state.js";
import { routeAfterReview } from "./edges.js";
import { memoryRecallNode, memoryPersistNode } from "../agents/memory-manager.js";
import { surveyorNode } from "../agents/surveyor.js";
import { documenterNode } from "../agents/documenter.js";
import { qaArchitectNode } from "../agents/qa-architect.js";
import { playwrightCoderNode } from "../agents/playwright-coder.js";
import { logger } from "../utils/logger.js";

// ── HITL Review Gate ──────────────────────────────────────────

/**
 * The HITL node interrupts execution and surfaces the test cases
 * to the human reviewer. The graph resumes when the human provides
 * their decision via Command(resume=...).
 */
async function hitlReviewNode(
  state: typeof QAFactoryState.State
): Promise<Partial<typeof QAFactoryState.State>> {
  logger.info("⏸  HITL: Graph paused — awaiting human review of test cases");

  // interrupt() pauses the graph and returns the payload to the caller.
  // When resumed, the node re-runs and receives the resume value.
  const decision = interrupt({
    testCases: state.testCases,
    gapAnalysis: state.gapAnalysis,
    mutationInsights: state.mutationInsights,
    message:
      "Review the generated test cases. Respond with: " +
      '{ "decision": "approved|rejected|revision_requested", "feedback": "your notes" }',
  });

  const { decision: reviewDecision = "rejected", feedback = "" } =
    (decision as { decision?: string; feedback?: string }) ?? {};

  return {
    reviewDecision: reviewDecision as "approved" | "rejected" | "revision_requested",
    humanFeedback: feedback,
    currentAgent: "hitl-review",
  };
}

// ── Error Handler ─────────────────────────────────────────────



// ── Build & Compile ───────────────────────────────────────────

export function buildWorkflow() {
  const graph = new StateGraph(QAFactoryState)
    .addNode("memory_recall", memoryRecallNode)
    .addNode("surveyor", surveyorNode)
    .addNode("documenter", documenterNode)
    .addNode("qa_architect", qaArchitectNode)
    .addNode("hitl_review", hitlReviewNode)
    .addNode("playwright_coder", playwrightCoderNode)
    .addNode("memory_persist", memoryPersistNode)

    // ── Edges ──
    .addEdge(START, "memory_recall")
    .addEdge("memory_recall", "surveyor")
    .addEdge("surveyor", "documenter")
    .addEdge("documenter", "qa_architect")
    .addEdge("qa_architect", "hitl_review")

    // HITL conditional routing
    .addConditionalEdges("hitl_review", routeAfterReview, {
      playwright_coder: "playwright_coder",
      memory_persist: "memory_persist",
      qa_architect: "qa_architect",
      __end__: END,
    })

    .addEdge("playwright_coder", "memory_persist")
    .addEdge("memory_persist", END);

  // MemorySaver for dev (no native build required).
  // Upgrade to SqliteSaver/PostgresSaver for persistence across restarts.
  const checkpointer = new MemorySaver();

  return graph.compile({ checkpointer });
}

export type CompiledWorkflow = ReturnType<typeof buildWorkflow>;
