// ─────────────────────────────────────────────────────────────
// parsers/prisma-parser.ts — Prisma schema → structured model map
// ─────────────────────────────────────────────────────────────
import { PrismaField, PrismaModel, PrismaEnum, PrismaSchema } from "../types/codebase.js";
import { readFileSafe, findFile } from "../utils/file-scanner.js";
import path from "path";

// ── Helpers ───────────────────────────────────────────────────

function extractBlock(content: string, keyword: string, name: string): string | null {
  const regex = new RegExp(`${keyword}\\s+${name}\\s*\\{([^}]*)\\}`, "s");
  const match = content.match(regex);
  return match ? match[1] : null;
}

function parseField(line: string): PrismaField | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) return null;

  // e.g. "id        String   @id @default(cuid())"
  // e.g. "draws     Draw[]   @relation(\"ProjectDraws\")"
  const parts = trimmed.match(/^(\w+)\s+([\w[\]?]+)(.*)?$/);
  if (!parts) return null;

  const [, name, rawType, rest = ""] = parts;
  const isOptional = rawType.endsWith("?");
  const isList = rawType.endsWith("[]");
  const type = rawType.replace(/[?\[\]]/g, "");
  const isRelation = /@relation/.test(rest);

  const attributes: string[] = [];
  const attrMatches = rest.matchAll(/@(\w+)(?:\([^)]*\))?/g);
  for (const m of attrMatches) {
    attributes.push(m[0].trim());
  }

  const defaultMatch = rest.match(/@default\(([^)]+)\)/);

  return {
    name,
    type,
    isOptional,
    isRelation,
    isList,
    attributes,
    defaultValue: defaultMatch?.[1],
  };
}

// ── Main Parser ───────────────────────────────────────────────

export function parsePrismaSchema(schemaContent: string): PrismaSchema {
  const models: PrismaModel[] = [];
  const enums: PrismaEnum[] = [];

  // --- Parse datasource ---
  const datasourceBlock = schemaContent.match(/datasource\s+\w+\s*\{([^}]*)\}/s);
  let datasource: PrismaSchema["datasource"];
  if (datasourceBlock) {
    const providerMatch = datasourceBlock[1].match(/provider\s*=\s*"([^"]+)"/);
    const urlMatch = datasourceBlock[1].match(/url\s*=\s*env\("([^"]+)"\)/);
    if (providerMatch) {
      datasource = {
        provider: providerMatch[1],
        url: urlMatch ? `env("${urlMatch[1]}")` : "unknown",
      };
    }
  }

  // --- Parse all model names ---
  const modelNames = [...schemaContent.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);

  for (const modelName of modelNames) {
    const block = extractBlock(schemaContent, "model", modelName);
    if (!block) continue;

    const fields: PrismaField[] = [];
    const uniqueConstraints: string[][] = [];
    const indexes: string[][] = [];

    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      // @@map
      const mapMatch = trimmed.match(/@@map\("([^"]+)"\)/);
      if (mapMatch) { /* store later */ }

      // @@unique([...])
      const uniqueMatch = trimmed.match(/@@unique\(\[([^\]]+)\]\)/);
      if (uniqueMatch) {
        uniqueConstraints.push(uniqueMatch[1].split(",").map((s) => s.trim()));
        continue;
      }

      // @@index([...])
      const indexMatch = trimmed.match(/@@index\(\[([^\]]+)\]\)/);
      if (indexMatch) {
        indexes.push(indexMatch[1].split(",").map((s) => s.trim()));
        continue;
      }

      const field = parseField(trimmed);
      if (field) fields.push(field);
    }

    // dbTable from @@map
    const mapMatch = block.match(/@@map\("([^"]+)"\)/);

    models.push({
      name: modelName,
      dbTable: mapMatch?.[1],
      fields,
      uniqueConstraints,
      indexes,
    });
  }

  // --- Parse all enums ---
  const enumNames = [...schemaContent.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]);

  for (const enumName of enumNames) {
    const block = extractBlock(schemaContent, "enum", enumName);
    if (!block) continue;

    const values = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//"));

    enums.push({ name: enumName, values });
  }

  return { models, enums, datasource };
}

/**
 * Locate and parse the schema.prisma for a project.
 * Checks explicit path first, then searches the codebase.
 */
export function parsePrismaSchemaFromProject(
  codebasePath: string,
  explicitPath?: string
): PrismaSchema | null {
  let schemaPath: string | null = null;

  if (explicitPath) {
    schemaPath = path.resolve(explicitPath);
  } else {
    schemaPath = findFile(codebasePath, "schema.prisma");
  }

  if (!schemaPath) return null;

  const content = readFileSafe(schemaPath);
  if (!content) return null;

  return parsePrismaSchema(content);
}
