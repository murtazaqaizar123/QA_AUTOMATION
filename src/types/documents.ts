// ─────────────────────────────────────────────────────────────
// types/documents.ts — PRD, Technical PRD, Gap Analysis types
// ─────────────────────────────────────────────────────────────

export type GapSeverity = "critical" | "major" | "minor";
export type GapArea = "data" | "api" | "ui" | "auth" | "integration";

export interface GapAnalysisItem {
  id: string;
  area: GapArea;
  /** What the Project PRD says should exist */
  businessRequirement: string;
  /** What the code actually does (or doesn't do) */
  technicalReality: string;
  severity: GapSeverity;
  recommendation: string;
}

export interface AuthModel {
  strategy: string;           // e.g. "JWT", "session", "NextAuth"
  roles: string[];            // e.g. ["BUILDER", "LENDER", "ADMIN"]
  middleware: string[];       // detected middleware names
  guardPattern?: string;      // e.g. "roleGuard(role)", "withAuth()"
}

export interface TechnicalPRD {
  projectId: string;
  generatedAt: string;
  userStoryScope: string;   // The user story that triggered this cycle
  authModel: AuthModel;
  /** Summary of what the data layer actually implements */
  dataLayerSummary: string;
  /** Summary of what the API layer actually implements */
  apiLayerSummary: string;
  /** Summary of what the UI layer actually implements */
  uiLayerSummary: string;
  gaps: GapAnalysisItem[];
}
