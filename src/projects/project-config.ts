// ─────────────────────────────────────────────────────────────
// projects/project-config.ts — Per-project config loader
// ─────────────────────────────────────────────────────────────
import fs from "fs";
import path from "path";
import { ProjectConfig } from "../types/project.js";

/**
 * Resolve codebase/prd paths relative to a base directory.
 */
export function resolveProjectPaths(
  project: ProjectConfig,
  baseDir: string
): ProjectConfig {
  return {
    ...project,
    codebasePath: path.resolve(baseDir, project.codebasePath),
    prdPath: path.resolve(baseDir, project.prdPath),
    prismaSchemaPath: project.prismaSchemaPath
      ? path.resolve(baseDir, project.prismaSchemaPath)
      : undefined,
  };
}

/**
 * Validate that a project config points to real paths.
 */
export function validateProjectConfig(project: ProjectConfig, mode: "full" | "prd-only" = "full"): string[] {
  const errors: string[] = [];

  if (mode !== "prd-only" && !fs.existsSync(project.codebasePath)) {
    errors.push(`Codebase path not found: ${project.codebasePath}`);
  }
  if (!fs.existsSync(project.prdPath)) {
    errors.push(`PRD file not found: ${project.prdPath}`);
  }
  if (mode !== "prd-only" && project.prismaSchemaPath && !fs.existsSync(project.prismaSchemaPath)) {
    errors.push(`Prisma schema not found: ${project.prismaSchemaPath}`);
  }

  return errors;
}
