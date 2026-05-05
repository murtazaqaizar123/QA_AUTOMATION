// ─────────────────────────────────────────────────────────────
// projects/registry.ts — Multi-project registry manager
// ─────────────────────────────────────────────────────────────
import fs from "fs";
import path from "path";
import { ProjectConfig, ProjectRegistry } from "../types/project.js";
import { config } from "../utils/config.js";
import { resolveProjectPaths } from "./project-config.js";

const registryPath = config.projects.registryPath;
const baseDir = path.dirname(registryPath);

function loadRegistry(): ProjectRegistry {
  if (!fs.existsSync(registryPath)) {
    return { projects: [] };
  }
  const raw = fs.readFileSync(registryPath, "utf-8");
  return JSON.parse(raw) as ProjectRegistry;
}

function saveRegistry(registry: ProjectRegistry): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

/**
 * Get all registered projects (with resolved absolute paths).
 */
export function listProjects(): ProjectConfig[] {
  const registry = loadRegistry();
  return registry.projects.map((p) => resolveProjectPaths(p, baseDir));
}

/**
 * Find a project by ID (with resolved absolute paths).
 */
export function getProject(projectId: string): ProjectConfig | null {
  const registry = loadRegistry();
  const project = registry.projects.find((p) => p.projectId === projectId);
  if (!project) return null;
  return resolveProjectPaths(project, baseDir);
}

/**
 * Add or update a project in the registry.
 */
export function upsertProject(project: ProjectConfig): void {
  const registry = loadRegistry();
  const idx = registry.projects.findIndex((p) => p.projectId === project.projectId);
  if (idx >= 0) {
    registry.projects[idx] = project;
  } else {
    registry.projects.push(project);
  }
  saveRegistry(registry);
}

/**
 * Remove a project from the registry.
 */
export function removeProject(projectId: string): boolean {
  const registry = loadRegistry();
  const before = registry.projects.length;
  registry.projects = registry.projects.filter((p) => p.projectId !== projectId);
  if (registry.projects.length === before) return false;
  saveRegistry(registry);
  return true;
}
