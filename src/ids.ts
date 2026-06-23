import { createHash, randomUUID } from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "space";
}

export function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function normalizePathKey(input: string): string {
  return input.trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

