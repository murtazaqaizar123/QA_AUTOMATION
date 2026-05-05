// ─────────────────────────────────────────────────────────────
// types/project.ts — Multi-project configuration types
// ─────────────────────────────────────────────────────────────

export type FrameworkType = "nextjs-app" | "nextjs-pages" | "express" | "generic";

export interface ProjectConfig {
  /** Unique slug used as Qdrant partition key e.g. "build-nest" */
  projectId: string;
  /** Human-readable display name */
  projectName: string;
  /** Absolute or workspace-relative path to the target repository root */
  codebasePath: string;
  /** Path to the Project PRD markdown file */
  prdPath: string;
  /** Framework convention to guide parser strategy */
  framework: FrameworkType;
  /** Override if schema.prisma is not at the default location */
  prismaSchemaPath?: string;
  /** Directories to exclude from scanning (in addition to node_modules, .git) */
  excludeDirs?: string[];
}

export interface ProjectRegistry {
  projects: ProjectConfig[];
}
