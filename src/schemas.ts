import { z } from "zod";

export const statusSchema = z.enum(["active", "archived", "deleted"]);

export const dimensionSchema = z
  .object({
    project: z.string().optional(),
    module: z.string().optional(),
    feature: z.string().optional(),
    role: z.string().optional(),
    scenario: z.string().optional(),
    constraint: z.string().optional(),
    decision: z.string().optional(),
    priority: z.string().optional(),
    owner: z.string().optional(),
  })
  .catchall(z.string());

export const evidenceSchema = z.object({
  sourceType: z.enum(["conversation", "document", "manual"]),
  sourceRef: z.string().optional(),
  capturedAt: z.string(),
  summary: z.string(),
  quote: z.string().max(500).optional(),
});

export const requirementMemorySchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  type: z.enum(["requirement", "decision", "constraint", "business-rule", "preference", "note"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  dimensions: dimensionSchema.default({}),
  customDimensions: z.record(z.string(), z.string()).default({}),
  tags: z.array(z.string()).default([]),
  status: statusSchema.default("active"),
  version: z.number().int().positive().default(1),
  evidence: z.array(evidenceSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const businessSpaceSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  status: statusSchema.default("active"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sessionProfileSchema = z.object({
  workspacePath: z.string().min(1),
  profileName: z.string().min(1).default("default"),
  primarySpaceId: z.string().min(1),
  referenceSpaceIds: z.array(z.string()).default([]),
  lastUsedAt: z.string(),
});

export const candidateSchema = z.object({
  id: z.string().optional(),
  spaceId: z.string().optional(),
  type: requirementMemorySchema.shape.type.default("requirement"),
  title: z.string().min(1),
  summary: z.string().min(1),
  dimensions: dimensionSchema.default({}),
  customDimensions: z.record(z.string(), z.string()).default({}),
  tags: z.array(z.string()).default([]),
  evidence: z.array(evidenceSchema).default([]),
});

export const eventSchema = z.object({
  eventId: z.string(),
  memoryId: z.string(),
  spaceId: z.string(),
  kind: z.enum(["created", "updated", "archived", "deleted"]),
  at: z.string(),
  reason: z.string().optional(),
  version: z.number().int().positive(),
  snapshot: requirementMemorySchema.optional(),
});

export const currentStoreSchema = z.object({
  schemaVersion: z.literal(1),
  space: businessSpaceSchema,
  memories: z.array(requirementMemorySchema),
});

export const bindingsStoreSchema = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(sessionProfileSchema),
});

export const vectorIndexEntrySchema = z.object({
  memoryId: z.string(),
  contentHash: z.string(),
  vector: z.array(z.number()),
  updatedAt: z.string(),
});

export const searchIndexSchema = z.object({
  schemaVersion: z.literal(1),
  spaceId: z.string(),
  rebuiltAt: z.string(),
  vectors: z.array(vectorIndexEntrySchema).default([]),
});

export type RequirementMemory = z.infer<typeof requirementMemorySchema>;
export type BusinessSpace = z.infer<typeof businessSpaceSchema>;
export type SessionProfile = z.infer<typeof sessionProfileSchema>;
export type MemoryCandidate = z.infer<typeof candidateSchema>;
export type MemoryEvent = z.infer<typeof eventSchema>;
export type CurrentStore = z.infer<typeof currentStoreSchema>;
export type BindingsStore = z.infer<typeof bindingsStoreSchema>;
export type SearchIndex = z.infer<typeof searchIndexSchema>;
export type Status = z.infer<typeof statusSchema>;

