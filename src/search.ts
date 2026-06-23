import OpenAI from "openai";
import { z } from "zod";
import { contentHash, embeddingText, readCurrent, readSearchIndex, searchableText, writeSearchIndex } from "./fsStore.js";
import { nowIso } from "./ids.js";
import type { RequirementMemory, SearchIndex } from "./schemas.js";

const EMBEDDING_MODEL = process.env.REQUIREMENTS_MEMORY_EMBEDDING_MODEL || "text-embedding-3-small";

export const filtersSchema = z
  .object({
    type: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    dimensions: z.record(z.string(), z.string()).optional(),
  })
  .optional();

export type SearchFilters = z.infer<typeof filtersSchema>;

export interface SearchResult {
  memory: RequirementMemory;
  score: number;
  reasons: string[];
  spaceId: string;
}

function tokenize(input: string): string[] {
  const ascii = input.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
  const cjk = input.match(/[\u4e00-\u9fff]{1,4}/gu) ?? [];
  return [...new Set([...ascii, ...cjk].filter((token) => token.length > 0))];
}

function matchesFilters(memory: RequirementMemory, filters: SearchFilters): boolean {
  if (!filters) {
    return true;
  }
  if (filters.type?.length && !filters.type.includes(memory.type)) {
    return false;
  }
  if (filters.status?.length && !filters.status.includes(memory.status)) {
    return false;
  }
  if (filters.tags?.length && !filters.tags.every((tag) => memory.tags.includes(tag))) {
    return false;
  }
  if (filters.dimensions) {
    for (const [key, value] of Object.entries(filters.dimensions)) {
      const actual = memory.dimensions[key] ?? memory.customDimensions[key];
      if (!actual || !actual.toLowerCase().includes(value.toLowerCase())) {
        return false;
      }
    }
  }
  return true;
}

function keywordScore(query: string, memory: RequirementMemory): { score: number; reasons: string[] } {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return { score: 0, reasons: [] };
  }
  const text = searchableText(memory).toLowerCase();
  const hits = queryTokens.filter((token) => text.includes(token.toLowerCase()));
  const titleHits = queryTokens.filter((token) => memory.title.toLowerCase().includes(token.toLowerCase()));
  const score = Math.min(1, hits.length / queryTokens.length + titleHits.length * 0.2);
  const reasons = hits.length > 0 ? [`keyword:${hits.slice(0, 5).join(",")}`] : [];
  return { score, reasons };
}

function dimensionBoost(memory: RequirementMemory): number {
  const filled = Object.values(memory.dimensions).filter(Boolean).length + Object.values(memory.customDimensions).filter(Boolean).length;
  return Math.min(0.12, filled * 0.015);
}

function recencyBoost(memory: RequirementMemory): number {
  const ageMs = Date.now() - Date.parse(memory.updatedAt);
  if (!Number.isFinite(ageMs)) {
    return 0;
  }
  const days = ageMs / 86400000;
  if (days < 7) {
    return 0.1;
  }
  if (days < 30) {
    return 0.06;
  }
  if (days < 90) {
    return 0.03;
  }
  return 0;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index];
    aMag += a[index] * a[index];
    bMag += b[index] * b[index];
  }
  if (aMag === 0 || bMag === 0) {
    return 0;
  }
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function openAiClient(): OpenAI | undefined {
  if (!process.env.OPENAI_API_KEY) {
    return undefined;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function embed(text: string): Promise<number[] | undefined> {
  const client = openAiClient();
  if (!client) {
    return undefined;
  }
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0]?.embedding;
}

export async function rebuildIndex(input: {
  spaceId: string;
  embeddingMode?: "auto" | "off" | "required";
}): Promise<{ index: SearchIndex; embeddingEnabled: boolean; skippedReason?: string }> {
  const mode = input.embeddingMode ?? "auto";
  const current = await readCurrent(input.spaceId);
  const existing = await readSearchIndex(input.spaceId);
  const vectors = [];
  let embeddingEnabled = false;
  let skippedReason: string | undefined;
  for (const memory of current.memories.filter((item) => item.status === "active")) {
    const hash = contentHash(memory);
    const prior = existing.vectors.find((entry) => entry.memoryId === memory.id && entry.contentHash === hash);
    if (prior) {
      vectors.push(prior);
      continue;
    }
    if (mode === "off") {
      skippedReason = "embeddingMode=off";
      continue;
    }
    try {
      const vector = await embed(embeddingText(memory));
      if (!vector) {
        skippedReason = "OPENAI_API_KEY is not configured";
        if (mode === "required") {
          throw new Error(skippedReason);
        }
        continue;
      }
      embeddingEnabled = true;
      vectors.push({ memoryId: memory.id, contentHash: hash, vector, updatedAt: nowIso() });
    } catch (error) {
      if (mode === "required") {
        throw error;
      }
      skippedReason = (error as Error).message;
    }
  }
  const index: SearchIndex = { schemaVersion: 1, spaceId: input.spaceId, rebuiltAt: nowIso(), vectors };
  await writeSearchIndex(index);
  return { index, embeddingEnabled, skippedReason };
}

export async function searchMemories(input: {
  query: string;
  spaceIds: string[];
  filters?: SearchFilters;
  topK?: number;
  useEmbeddings?: boolean;
}): Promise<{ results: SearchResult[]; embeddingUsed: boolean; embeddingSkippedReason?: string }> {
  const topK = input.topK ?? 8;
  let queryVector: number[] | undefined;
  let embeddingSkippedReason: string | undefined;
  if (input.useEmbeddings !== false) {
    try {
      queryVector = await embed(input.query);
      if (!queryVector) {
        embeddingSkippedReason = "OPENAI_API_KEY is not configured";
      }
    } catch (error) {
      embeddingSkippedReason = (error as Error).message;
    }
  }

  const results: SearchResult[] = [];
  for (const spaceId of [...new Set(input.spaceIds)]) {
    const current = await readCurrent(spaceId);
    const index = await readSearchIndex(spaceId);
    for (const memory of current.memories) {
      if (!matchesFilters(memory, input.filters) || memory.status === "deleted") {
        continue;
      }
      const keyword = keywordScore(input.query, memory);
      const vectorEntry = index.vectors.find((entry) => entry.memoryId === memory.id);
      const vectorScore = queryVector && vectorEntry ? Math.max(0, cosineSimilarity(queryVector, vectorEntry.vector)) : 0;
      const statusBoost = memory.status === "active" ? 0.08 : 0;
      const score = keyword.score * 0.55 + vectorScore * 0.35 + recencyBoost(memory) + dimensionBoost(memory) + statusBoost;
      if (score <= 0 && input.query.trim()) {
        continue;
      }
      const reasons = [...keyword.reasons];
      if (vectorScore > 0) {
        reasons.push(`semantic:${vectorScore.toFixed(3)}`);
      }
      if (memory.status !== "active") {
        reasons.push(`status:${memory.status}`);
      }
      results.push({ memory, score, reasons, spaceId });
    }
  }

  return {
    results: results.sort((a, b) => b.score - a.score).slice(0, topK),
    embeddingUsed: Boolean(queryVector),
    embeddingSkippedReason,
  };
}

export function duplicateCandidates(candidate: { title: string; summary: string; tags?: string[] }, memories: RequirementMemory[]): Array<{ id: string; title: string; score: number }> {
  const titleTokens = new Set(tokenize(candidate.title));
  const summaryTokens = new Set(tokenize(candidate.summary));
  const candidateTokens = new Set([...titleTokens, ...summaryTokens, ...(candidate.tags ?? [])]);
  if (candidateTokens.size === 0) {
    return [];
  }
  return memories
    .map((memory) => {
      const memoryTokens = new Set(tokenize(searchableText(memory)));
      const overlap = [...candidateTokens].filter((token) => memoryTokens.has(token)).length;
      return { id: memory.id, title: memory.title, score: overlap / candidateTokens.size };
    })
    .filter((item) => item.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

