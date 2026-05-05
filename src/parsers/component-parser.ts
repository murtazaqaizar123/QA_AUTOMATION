// ─────────────────────────────────────────────────────────────
// parsers/component-parser.ts — React/Next components → UI map
// ─────────────────────────────────────────────────────────────
import path from "path";
import { UIComponent } from "../types/codebase.js";
import { scanFiles, readFileSafe } from "../utils/file-scanner.js";

function detectStateHooks(content: string): string[] {
  const hooks = new Set<string>();
  const hookMatches = content.matchAll(/\b(use[A-Z]\w*)\s*\(/g);
  for (const m of hookMatches) {
    hooks.add(m[1]);
  }
  return [...hooks];
}

function detectApiCalls(content: string): string[] {
  const calls: string[] = [];

  // fetch('/api/...')
  const fetchMatches = content.matchAll(/fetch\(['"`]([^'"`]+)['"`]/g);
  for (const m of fetchMatches) {
    if (m[1].startsWith("/api") || m[1].includes("api")) {
      calls.push(`fetch:${m[1]}`);
    }
  }

  // axios.get/post/put/delete('...')
  const axiosMatches = content.matchAll(/axios\.(get|post|put|patch|delete)\(['"`]([^'"`]+)['"`]/g);
  for (const m of axiosMatches) {
    calls.push(`axios.${m[1]}:${m[2]}`);
  }

  // Next.js server actions (use server)
  if (content.includes("use server") || content.includes('"use server"')) {
    calls.push("server-action");
  }

  return [...new Set(calls)];
}

function detectConditionalRenders(content: string): string[] {
  const conditions: string[] = [];

  // Role checks: role === 'BUILDER', user.role === ...
  const roleMatches = content.matchAll(/role\s*[=!]=+\s*['"`](\w+)['"`]/g);
  for (const m of roleMatches) {
    conditions.push(`role:${m[1]}`);
  }

  // Loading/error states
  if (/\bisLoading\b/.test(content)) conditions.push("isLoading");
  if (/\bisError\b/.test(content)) conditions.push("isError");
  if (/\bisPending\b/.test(content)) conditions.push("isPending");
  if (/\berror\b\s*&&/.test(content)) conditions.push("error-boundary");

  // Session/auth checks
  if (/session\s*&&/.test(content) || /!session/.test(content)) {
    conditions.push("session-guard");
  }

  return [...new Set(conditions)];
}

function detectTestIds(content: string): string[] {
  const ids: string[] = [];
  const matches = content.matchAll(/data-testid=["'{`]([^"'`}]+)["'`}]/g);
  for (const m of matches) {
    ids.push(m[1]);
  }
  return ids;
}

function extractComponentName(filePath: string, content: string): string {
  // Try named export: export default function MyComponent
  const defaultFuncMatch = content.match(/export\s+default\s+function\s+(\w+)/);
  if (defaultFuncMatch) return defaultFuncMatch[1];

  // Try const export: export default MyComponent / const MyComponent = ...
  const constMatch = content.match(/const\s+(\w+)\s*[:=][^;]*=>\s*\(/);
  if (constMatch) return constMatch[1];

  // Fall back to filename
  return path.basename(filePath, path.extname(filePath));
}

/**
 * Scan React/Next.js components and extract structural metadata.
 */
export function parseComponents(codebasePath: string): UIComponent[] {
  const components: UIComponent[] = [];

  // Only scan known component dirs
  const scanDirs = [
    path.join(codebasePath, "src", "app"),
    path.join(codebasePath, "app"),
    path.join(codebasePath, "src", "components"),
    path.join(codebasePath, "components"),
    path.join(codebasePath, "src", "pages"),
    path.join(codebasePath, "pages"),
  ];

  const seen = new Set<string>();

  for (const dir of scanDirs) {
    const files = scanFiles(dir, {
      extensions: [".tsx", ".jsx"],
      excludeDirs: ["api"], // skip api route files
    });

    for (const filePath of files) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);

      const content = readFileSafe(filePath);
      if (!content) continue;

      // Must contain JSX to be a component
      if (!/<\w/.test(content)) continue;

      components.push({
        name: extractComponentName(filePath, content),
        filePath: path.relative(codebasePath, filePath),
        props: [], // Props extraction via regex is unreliable; left for LLM enhancement
        stateHooks: detectStateHooks(content),
        apiCalls: detectApiCalls(content),
        conditionalRenders: detectConditionalRenders(content),
        testIds: detectTestIds(content),
      });
    }
  }

  return components;
}
