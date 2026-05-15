// ─────────────────────────────────────────────────────────────
// graph/state.ts — Central LangGraph StateAnnotation
// ─────────────────────────────────────────────────────────────
import { Annotation } from "@langchain/langgraph";
import { ProjectConfig } from "../types/project.js";
import { PrismaModel, APIEndpoint, UIComponent } from "../types/codebase.js";
import { TechnicalPRD, GapAnalysisItem } from "../types/documents.js";
import { TestCase } from "../types/test-case.js";

export const QAFactoryState = Annotation.Root({
  // ── Project context (multi-project) ─────────────────────
  projectConfig: Annotation<ProjectConfig>({
    reducer: (_, next) => next,
  }),

  // ── Mission trigger ──────────────────────────────────────
  userStory: Annotation<string>({
    reducer: (_, next) => next,
  }),

  // ── Surveyor output ──────────────────────────────────────
  prismaModels: Annotation<PrismaModel[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  apiEndpoints: Annotation<APIEndpoint[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  uiComponents: Annotation<UIComponent[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  scanStatus: Annotation<"pending" | "complete" | "error">({
    reducer: (_, next) => next,
    default: () => "pending",
  }),

  // ── Documenter output ────────────────────────────────────
  technicalPRD: Annotation<TechnicalPRD | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  gapAnalysis: Annotation<GapAnalysisItem[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),

  // ── QA Architect output ──────────────────────────────────
  testCases: Annotation<TestCase[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  mutationInsights: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),

  // ── Memory ───────────────────────────────────────────────
  relevantSemanticFacts: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  relevantProceduralRules: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),

  // ── HITL ─────────────────────────────────────────────────
  reviewDecision: Annotation<"approved" | "rejected" | "revision_requested" | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  humanFeedback: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),

  // ── Playwright Coder output ───────────────────────────────
  generatedPlaywrightSpecs: Annotation<
    Array<{
      testCaseId: string;
      specFile: string;
      selectorMatches: Array<{
        testId: string;
        componentName: string;
        found: boolean;
        locator?: string;
        fallback?: string;
      }>;
      errors: string[];
    }>
  >({
    reducer: (_, next) => next,
    default: () => [],
  }),
  selectorMismatches: Annotation<
    Array<{
      testCaseId: string;
      testCaseTitle: string;
      mismatches: Array<{
        testId: string;
        componentName: string;
        found: boolean;
        locator?: string;
        fallback?: string;
      }>;
    }>
  >({
    reducer: (_, next) => next,
    default: () => [],
  }),

  // ── Control ──────────────────────────────────────────────
  currentAgent: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "init",
  }),
  errors: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  iterationCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
});
