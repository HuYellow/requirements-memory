import os from "node:os";
import path from "node:path";

export function dataRoot(): string {
  return process.env.REQUIREMENTS_MEMORY_HOME || path.join(os.homedir(), ".codex", "requirements-memory");
}

export function spacesDir(): string {
  return path.join(dataRoot(), "spaces");
}

export function indexesDir(): string {
  return path.join(dataRoot(), "indexes");
}

export function currentPath(spaceId: string): string {
  return path.join(spacesDir(), spaceId, "current.json");
}

export function eventsPath(spaceId: string): string {
  return path.join(spacesDir(), spaceId, "events.jsonl");
}

export function markdownPath(spaceId: string): string {
  return path.join(spacesDir(), spaceId, "memory.md");
}

export function indexPath(spaceId: string): string {
  return path.join(indexesDir(), `${spaceId}.json`);
}

export function bindingsPath(): string {
  return path.join(dataRoot(), "bindings.json");
}

