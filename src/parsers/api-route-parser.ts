// ─────────────────────────────────────────────────────────────
// parsers/api-route-parser.ts — Next.js API routes → endpoint map
// ─────────────────────────────────────────────────────────────
import path from "path";
import { APIEndpoint, HttpMethod } from "../types/codebase.js";
import { scanFiles, readFileSafe } from "../utils/file-scanner.js";

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Convert a file path to a Next.js route string.
 * e.g. src/app/api/projects/[id]/draws/route.ts → /api/projects/[id]/draws
 */
function filePathToRoute(filePath: string, apiRootDir: string): string {
  const relative = path.relative(apiRootDir, filePath);
  // Remove the filename (route.ts or route.js)
  const withoutFile = relative.replace(/[/\\](route|index)\.(ts|tsx|js|jsx)$/, "");
  // Normalize slashes
  return "/" + withoutFile.replace(/\\/g, "/");
}

/**
 * Detect which HTTP method handlers are exported from a route file.
 */
function detectMethods(content: string): HttpMethod[] {
  return HTTP_METHODS.filter((method) => {
    return (
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(content) ||
      new RegExp(`export\\s+const\\s+${method}\\s*=`).test(content)
    );
  });
}

/**
 * Detect Prisma client operations e.g. prisma.draw.create, prisma.project.findMany
 */
function detectPrismaOps(content: string): string[] {
  const matches = content.matchAll(/prisma\.(\w+)\.(\w+)\s*\(/g);
  const ops = new Set<string>();
  for (const m of matches) {
    ops.add(`prisma.${m[1]}.${m[2]}`);
  }
  return [...ops];
}

/**
 * Detect imported middleware / guards by looking at import statements.
 */
function detectMiddleware(content: string): string[] {
  const middleware: string[] = [];
  const importLines = content.match(/^import\s+.*from\s+['"][^'"]*['"]/gm) ?? [];

  for (const line of importLines) {
    if (/auth|guard|middleware|protect|session|jwt|token|role/i.test(line)) {
      // Extract what's imported
      const names = line.match(/\{([^}]+)\}/)?.[1] ?? "";
      names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((n) => middleware.push(n));
    }
  }

  // Also detect wrapper function calls at top of handlers e.g. withAuth(handler)
  const wrappers = content.matchAll(/\b(withAuth|withRole|authenticate|requireAuth|roleGuard)\b/g);
  for (const m of wrappers) {
    if (!middleware.includes(m[1])) middleware.push(m[1]);
  }

  return [...new Set(middleware)];
}

/**
 * Find all API route files under the project and parse them.
 */
export function parseAPIRoutes(codebasePath: string): APIEndpoint[] {
  const endpoints: APIEndpoint[] = [];

  // Support both App Router (app/api/) and Pages Router (pages/api/)
  const apiDirs = [
    path.join(codebasePath, "src", "app", "api"),
    path.join(codebasePath, "app", "api"),
    path.join(codebasePath, "src", "pages", "api"),
    path.join(codebasePath, "pages", "api"),
  ];

  for (const apiDir of apiDirs) {
    const files = scanFiles(apiDir, { extensions: [".ts", ".tsx", ".js", ".jsx"] });
    if (files.length === 0) continue;

    for (const filePath of files) {
      const content = readFileSafe(filePath);
      if (!content) continue;

      const methods = detectMethods(content);
      if (methods.length === 0) continue;

      const routePath = filePathToRoute(filePath, apiDir);
      const prismaOps = detectPrismaOps(content);
      const middleware = detectMiddleware(content);

      for (const method of methods) {
        endpoints.push({
          method,
          path: routePath,
          handlerFile: path.relative(codebasePath, filePath),
          middleware,
          prismaOperations: prismaOps,
        });
      }
    }
  }

  return endpoints;
}
