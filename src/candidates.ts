import fs from "node:fs/promises";
import path from "node:path";
import { readCurrent } from "./fsStore.js";
import { makeId, nowIso } from "./ids.js";
import { duplicateCandidates } from "./search.js";
import type { MemoryCandidate } from "./schemas.js";

const supportedExtensions = new Set([".md", ".txt", ".json"]);

function trimQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function splitStatements(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#>\s]+/, "").trim())
    .filter((line) => line.length >= 12);
  const sentenceParts = text
    .split(/[。！？!?]\s*|\n{2,}/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 20);
  return [...new Set([...lines, ...sentenceParts])].slice(0, 20);
}

function inferType(statement: string): MemoryCandidate["type"] {
  if (/决定|决策|采用|不采用|选择|decision|decide/i.test(statement)) {
    return "decision";
  }
  if (/必须|不能|约束|限制|只允许|required|must|constraint/i.test(statement)) {
    return "constraint";
  }
  if (/规则|口径|计算|校验|rule/i.test(statement)) {
    return "business-rule";
  }
  return "requirement";
}

function inferTags(statement: string): string[] {
  const tags = [];
  for (const match of statement.matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
    tags.push(match[1]);
  }
  if (/验收|acceptance/i.test(statement)) {
    tags.push("acceptance");
  }
  if (/接口|api/i.test(statement)) {
    tags.push("api");
  }
  if (/权限|角色|role/i.test(statement)) {
    tags.push("role");
  }
  return [...new Set(tags)].slice(0, 8);
}

function titleFromStatement(statement: string): string {
  return statement.replace(/\s+/g, " ").trim().slice(0, 80);
}

function compactDimensions(hints?: Record<string, string>): Record<string, string> {
  const dimensions: Record<string, string> = {};
  for (const key of ["project", "module", "feature", "role", "scenario", "constraint", "decision", "priority", "owner"]) {
    const value = hints?.[key]?.trim();
    if (value) {
      dimensions[key] = value;
    }
  }
  return dimensions;
}

export async function prepareMemoryCandidates(input: {
  sourceText: string;
  sourceType: "conversation" | "document" | "manual";
  spaceId?: string;
  sourceRef?: string;
  hints?: Record<string, string>;
}): Promise<Array<{ candidate: MemoryCandidate; duplicates: Array<{ id: string; title: string; score: number }> }>> {
  const statements = splitStatements(input.sourceText);
  const memories = input.spaceId ? (await readCurrent(input.spaceId)).memories : [];
  return statements.slice(0, 10).map((statement) => {
    const candidate: MemoryCandidate = {
      id: makeId("cand"),
      spaceId: input.spaceId,
      type: inferType(statement),
      title: titleFromStatement(statement),
      summary: statement,
      dimensions: compactDimensions(input.hints),
      customDimensions: {},
      tags: inferTags(statement),
      evidence: [
        {
          sourceType: input.sourceType,
          sourceRef: input.sourceRef,
          capturedAt: nowIso(),
          summary: `Candidate extracted from ${input.sourceType}.`,
          quote: trimQuote(statement),
        },
      ],
    };
    return {
      candidate,
      duplicates: duplicateCandidates(candidate, memories),
    };
  });
}

export async function importDocument(input: {
  filePath: string;
  spaceId: string;
  mode?: "propose";
}): Promise<Array<{ candidate: MemoryCandidate; duplicates: Array<{ id: string; title: string; score: number }> }>> {
  const extension = path.extname(input.filePath).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error(`Unsupported document format '${extension}'. v1 supports .md, .txt, and .json.`);
  }
  const raw = await fs.readFile(input.filePath, "utf8");
  const sourceText = extension === ".json" ? JSON.stringify(JSON.parse(raw), null, 2) : raw;
  return prepareMemoryCandidates({
    sourceText,
    sourceType: "document",
    spaceId: input.spaceId,
    sourceRef: input.filePath,
  });
}
