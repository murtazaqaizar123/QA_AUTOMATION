// ─────────────────────────────────────────────────────────────
// utils/file-scanner.ts — Recursive file discovery
// ─────────────────────────────────────────────────────────────
import fs from "fs";
import path from "path";

const DEFAULT_EXCLUDE = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  ".turbo", "coverage", ".cache", "out",
]);

export interface ScanOptions {
  /** File extensions to include e.g. [".ts", ".tsx"] */
  extensions?: string[];
  /** Additional directory names to exclude */
  excludeDirs?: string[];
  /** Maximum directory depth (default: 20) */
  maxDepth?: number;
}

/**
 * Recursively walk a directory and return matching file paths.
 */
export function scanFiles(rootDir: string, options: ScanOptions = {}): string[] {
  const {
    extensions,
    excludeDirs = [],
    maxDepth = 20,
  } = options;

  const excluded = new Set([...DEFAULT_EXCLUDE, ...excludeDirs]);
  const results: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable dirs
    }

    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(rootDir, 0);
  return results;
}

/**
 * Find a file by name within a directory tree. Returns the first match.
 */
export function findFile(rootDir: string, fileName: string): string | null {
  const files = scanFiles(rootDir, { extensions: [path.extname(fileName)] });
  return files.find((f) => path.basename(f) === fileName) ?? null;
}

/**
 * Read file content safely, returning null if the file doesn't exist.
 */
export function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
