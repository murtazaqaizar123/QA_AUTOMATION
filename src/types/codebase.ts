// ─────────────────────────────────────────────────────────────
// types/codebase.ts — Output types from parsers
// ─────────────────────────────────────────────────────────────

export interface PrismaField {
  name: string;
  type: string;
  isOptional: boolean;
  isRelation: boolean;
  isList: boolean;
  attributes: string[]; // @id, @unique, @default(...), @relation(...)
  defaultValue?: string;
}

export interface PrismaModel {
  name: string;
  dbTable?: string;    // from @@map("...")
  fields: PrismaField[];
  uniqueConstraints: string[][]; // @@unique([field1, field2])
  indexes: string[][];           // @@index(...)
}

export interface PrismaEnum {
  name: string;
  values: string[];
}

export interface PrismaSchema {
  models: PrismaModel[];
  enums: PrismaEnum[];
  datasource?: { provider: string; url: string };
}

// ── API Layer ──────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface APIEndpoint {
  method: HttpMethod;
  /** Route path inferred from file system e.g. /api/projects/[id]/draws */
  path: string;
  /** Relative file path of the handler */
  handlerFile: string;
  /** Middleware/guard imports detected in the file */
  middleware: string[];
  /** Prisma client calls detected e.g. prisma.draw.create */
  prismaOperations: string[];
  /** Request body shape hints (parameter names from zod/type imports) */
  bodyShape?: string[];
}

// ── UI Layer ──────────────────────────────────────────────

export interface UIComponent {
  name: string;
  filePath: string;
  /** Detected props (from TypeScript interface or function params) */
  props: string[];
  /** useState, useQuery, useMutation, custom hooks */
  stateHooks: string[];
  /** fetch/axios/server action calls */
  apiCalls: string[];
  /** Role-based or loading-state conditional renders */
  conditionalRenders: string[];
  /** data-testid attributes found in JSX */
  testIds: string[];
}

// ── Aggregated scan result ────────────────────────────────

export interface CodebaseScan {
  projectId: string;
  scannedAt: string;
  prismaSchema: PrismaSchema;
  apiEndpoints: APIEndpoint[];
  uiComponents: UIComponent[];
  /** Entities determined in-scope for the current user story */
  scopedEntities: string[];
}
