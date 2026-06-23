import fs from "node:fs/promises";
import path from "node:path";
import {
  bindingsStoreSchema,
  businessSpaceSchema,
  candidateSchema,
  currentStoreSchema,
  eventSchema,
  searchIndexSchema,
  type BindingsStore,
  type BusinessSpace,
  type CurrentStore,
  type MemoryCandidate,
  type MemoryEvent,
  type RequirementMemory,
  type SearchIndex,
  type SessionProfile,
} from "./schemas.js";
import { bindingsPath, currentPath, dataRoot, eventsPath, indexPath, indexesDir, markdownPath, spacesDir } from "./paths.js";
import { makeId, normalizePathKey, nowIso, slugify, stableHash } from "./ids.js";

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(file: string, fallback: T, parser: { parse(value: unknown): T }): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return parser.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

async function appendJsonl(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

export async function initializeStore(): Promise<void> {
  await ensureDir(dataRoot());
  await ensureDir(spacesDir());
  await ensureDir(indexesDir());
  await readBindings();
}

export async function readBindings(): Promise<BindingsStore> {
  return readJson(bindingsPath(), { schemaVersion: 1, profiles: [] }, bindingsStoreSchema);
}

export async function writeBindings(store: BindingsStore): Promise<void> {
  await writeJsonAtomic(bindingsPath(), bindingsStoreSchema.parse(store));
}

export async function listBusinessSpaces(): Promise<BusinessSpace[]> {
  await ensureDir(spacesDir());
  const entries = await fs.readdir(spacesDir(), { withFileTypes: true });
  const spaces: BusinessSpace[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const store = await readCurrent(entry.name);
      spaces.push(store.space);
    } catch {
      // Ignore broken space folders during listing; validation tools expose details later.
    }
  }
  return spaces.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createBusinessSpace(input: {
  name: string;
  description?: string;
  aliases?: string[];
}): Promise<BusinessSpace> {
  const now = nowIso();
  const base = slugify(input.name);
  let id = `space_${base}`;
  const existing = new Set((await listBusinessSpaces()).map((space) => space.id));
  if (existing.has(id)) {
    id = `${id}_${makeId("id").slice(3, 9)}`;
  }
  const space = businessSpaceSchema.parse({
    id,
    name: input.name,
    description: input.description,
    aliases: input.aliases ?? [],
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const current: CurrentStore = { schemaVersion: 1, space, memories: [] };
  await writeCurrent(current);
  await writeSearchIndex({ schemaVersion: 1, spaceId: id, rebuiltAt: now, vectors: [] });
  await writeMarkdown(current);
  return space;
}

export async function readCurrent(spaceId: string): Promise<CurrentStore> {
  return readJson(currentPath(spaceId), undefined as unknown as CurrentStore, currentStoreSchema);
}

export async function writeCurrent(store: CurrentStore): Promise<void> {
  await writeJsonAtomic(currentPath(store.space.id), currentStoreSchema.parse(store));
  await writeMarkdown(store);
}

export async function readSearchIndex(spaceId: string): Promise<SearchIndex> {
  return readJson(indexPath(spaceId), { schemaVersion: 1, spaceId, rebuiltAt: nowIso(), vectors: [] }, searchIndexSchema);
}

export async function writeSearchIndex(index: SearchIndex): Promise<void> {
  await writeJsonAtomic(indexPath(index.spaceId), searchIndexSchema.parse(index));
}

export async function appendEvent(event: MemoryEvent): Promise<void> {
  await appendJsonl(eventsPath(event.spaceId), eventSchema.parse(event));
}

export async function bindSessionProfile(input: {
  workspacePath: string;
  profileName?: string;
  primarySpaceId: string;
  referenceSpaceIds?: string[];
}): Promise<SessionProfile> {
  await readCurrent(input.primarySpaceId);
  for (const refId of input.referenceSpaceIds ?? []) {
    await readCurrent(refId);
  }
  const bindings = await readBindings();
  const profileName = input.profileName || "default";
  const workspacePath = normalizePathKey(input.workspacePath);
  const profile: SessionProfile = {
    workspacePath,
    profileName,
    primarySpaceId: input.primarySpaceId,
    referenceSpaceIds: [...new Set(input.referenceSpaceIds ?? [])].filter((id) => id !== input.primarySpaceId),
    lastUsedAt: nowIso(),
  };
  const index = bindings.profiles.findIndex(
    (candidate) => candidate.workspacePath === workspacePath && candidate.profileName === profileName,
  );
  if (index >= 0) {
    bindings.profiles[index] = profile;
  } else {
    bindings.profiles.push(profile);
  }
  await writeBindings(bindings);
  return profile;
}

export async function getSessionContext(input: {
  workspacePath: string;
  profileName?: string;
}): Promise<{ profile?: SessionProfile; primarySpace?: BusinessSpace; referenceSpaces: BusinessSpace[] }> {
  const workspacePath = normalizePathKey(input.workspacePath);
  const profileName = input.profileName || "default";
  const bindings = await readBindings();
  const profile = bindings.profiles.find(
    (candidate) => candidate.workspacePath === workspacePath && candidate.profileName === profileName,
  );
  if (!profile) {
    return { referenceSpaces: [] };
  }
  profile.lastUsedAt = nowIso();
  await writeBindings(bindings);
  const primary = await readCurrent(profile.primarySpaceId);
  const referenceSpaces = [];
  for (const refId of profile.referenceSpaceIds) {
    referenceSpaces.push((await readCurrent(refId)).space);
  }
  return { profile, primarySpace: primary.space, referenceSpaces };
}

export async function listSessionProfiles(workspacePath?: string): Promise<SessionProfile[]> {
  const bindings = await readBindings();
  if (!workspacePath) {
    return bindings.profiles;
  }
  const key = normalizePathKey(workspacePath);
  return bindings.profiles.filter((profile) => profile.workspacePath === key);
}

export function candidateToMemory(candidateInput: unknown, spaceId: string, existing?: RequirementMemory): RequirementMemory {
  const candidate = candidateSchema.parse(candidateInput);
  const now = nowIso();
  const base: RequirementMemory = existing ?? {
    id: candidate.id || makeId("mem"),
    spaceId,
    type: candidate.type,
    title: candidate.title,
    summary: candidate.summary,
    dimensions: candidate.dimensions,
    customDimensions: candidate.customDimensions,
    tags: candidate.tags,
    status: "active",
    version: 0,
    evidence: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...base,
    spaceId,
    type: candidate.type,
    title: candidate.title,
    summary: candidate.summary,
    dimensions: candidate.dimensions,
    customDimensions: candidate.customDimensions,
    tags: [...new Set(candidate.tags.map((tag) => tag.trim()).filter(Boolean))],
    status: "active",
    version: base.version + 1,
    evidence: candidate.evidence.length > 0 ? candidate.evidence : base.evidence,
    updatedAt: now,
  };
}

export async function upsertMemory(input: {
  candidate: unknown;
  spaceId?: string;
  confirmedByUser: boolean;
  reason?: string;
}): Promise<RequirementMemory> {
  if (!input.confirmedByUser) {
    throw new Error("upsert_memory requires confirmedByUser=true.");
  }
  const parsed = candidateSchema.parse(input.candidate);
  const spaceId = input.spaceId || parsed.spaceId;
  if (!spaceId) {
    throw new Error("spaceId is required when the candidate does not include one.");
  }
  const current = await readCurrent(spaceId);
  const existingIndex = parsed.id ? current.memories.findIndex((memory) => memory.id === parsed.id) : -1;
  const existing = existingIndex >= 0 ? current.memories[existingIndex] : undefined;
  const memory = candidateToMemory(parsed, spaceId, existing);
  if (existingIndex >= 0) {
    current.memories[existingIndex] = memory;
  } else {
    current.memories.push(memory);
  }
  current.space.updatedAt = memory.updatedAt;
  await writeCurrent(current);
  await appendEvent({
    eventId: makeId("evt"),
    memoryId: memory.id,
    spaceId,
    kind: existing ? "updated" : "created",
    at: memory.updatedAt,
    reason: input.reason,
    version: memory.version,
    snapshot: memory,
  });
  return memory;
}

export async function archiveMemory(input: { id: string; reason?: string }): Promise<RequirementMemory> {
  const { current, index } = await findMemoryById(input.id);
  const memory = current.memories[index];
  const updated: RequirementMemory = {
    ...memory,
    status: "archived",
    version: memory.version + 1,
    updatedAt: nowIso(),
  };
  current.memories[index] = updated;
  await writeCurrent(current);
  await appendEvent({
    eventId: makeId("evt"),
    memoryId: updated.id,
    spaceId: updated.spaceId,
    kind: "archived",
    at: updated.updatedAt,
    reason: input.reason,
    version: updated.version,
    snapshot: updated,
  });
  return updated;
}

export async function deleteMemory(input: { id: string; confirmHardDelete: boolean; reason?: string }): Promise<{ id: string; spaceId: string }> {
  if (!input.confirmHardDelete) {
    throw new Error("delete_memory requires confirmHardDelete=true.");
  }
  const { current, index } = await findMemoryById(input.id);
  const [removed] = current.memories.splice(index, 1);
  await writeCurrent(current);
  await removeVectorEntry(removed.spaceId, removed.id);
  await appendEvent({
    eventId: makeId("evt"),
    memoryId: removed.id,
    spaceId: removed.spaceId,
    kind: "deleted",
    at: nowIso(),
    reason: input.reason,
    version: removed.version + 1,
  });
  return { id: removed.id, spaceId: removed.spaceId };
}

export async function findMemoryById(id: string): Promise<{ current: CurrentStore; index: number }> {
  const spaces = await listBusinessSpaces();
  for (const space of spaces) {
    const current = await readCurrent(space.id);
    const index = current.memories.findIndex((memory) => memory.id === id);
    if (index >= 0) {
      return { current, index };
    }
  }
  throw new Error(`Memory not found: ${id}`);
}

export async function removeVectorEntry(spaceId: string, memoryId: string): Promise<void> {
  const index = await readSearchIndex(spaceId);
  index.vectors = index.vectors.filter((entry) => entry.memoryId !== memoryId);
  index.rebuiltAt = nowIso();
  await writeSearchIndex(index);
}

export function searchableText(memory: Pick<RequirementMemory, "title" | "summary" | "dimensions" | "customDimensions" | "tags">): string {
  return [
    memory.title,
    memory.summary,
    ...Object.values(memory.dimensions),
    ...Object.values(memory.customDimensions),
    ...memory.tags,
  ]
    .filter(Boolean)
    .join("\n");
}

export function embeddingText(memory: Pick<RequirementMemory, "title" | "summary" | "dimensions" | "customDimensions" | "tags">): string {
  return searchableText(memory);
}

export function contentHash(memory: Pick<RequirementMemory, "title" | "summary" | "dimensions" | "customDimensions" | "tags">): string {
  return stableHash(embeddingText(memory));
}

export async function writeMarkdown(store: CurrentStore): Promise<void> {
  const lines = [
    `# ${store.space.name}`,
    "",
    store.space.description ? store.space.description : "",
    "",
    `- Space ID: ${store.space.id}`,
    `- Updated: ${store.space.updatedAt}`,
    "",
    "## Active Memories",
    "",
  ];
  for (const memory of store.memories.filter((item) => item.status === "active")) {
    lines.push(`### ${memory.title}`);
    lines.push("");
    lines.push(`- ID: ${memory.id}`);
    lines.push(`- Type: ${memory.type}`);
    lines.push(`- Version: ${memory.version}`);
    lines.push(`- Tags: ${memory.tags.join(", ") || "none"}`);
    lines.push("");
    lines.push(memory.summary);
    lines.push("");
  }
  await fs.writeFile(markdownPath(store.space.id), `${lines.join("\n").trim()}\n`, "utf8");
}

