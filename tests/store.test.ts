import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveMemory,
  bindSessionProfile,
  createBusinessSpace,
  deleteMemory,
  getSessionContext,
  initializeStore,
  listBusinessSpaces,
  upsertMemory,
} from "../src/fsStore.js";
import { prepareMemoryCandidates } from "../src/candidates.js";
import { searchMemories } from "../src/search.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "requirements-memory-test-"));
  process.env.REQUIREMENTS_MEMORY_HOME = tempRoot;
  delete process.env.OPENAI_API_KEY;
  await initializeStore();
});

describe("requirements memory store", () => {
  it("creates business spaces and binds workspace session profiles", async () => {
    const space = await createBusinessSpace({
      name: "Order Center",
      description: "Order domain requirements",
      aliases: ["orders"],
    });

    const profile = await bindSessionProfile({
      workspacePath: "C:\\work\\order-api",
      profileName: "default",
      primarySpaceId: space.id,
    });

    const context = await getSessionContext({
      workspacePath: "c:/work/order-api/",
      profileName: "default",
    });

    expect((await listBusinessSpaces()).map((item) => item.id)).toContain(space.id);
    expect(profile.primarySpaceId).toBe(space.id);
    expect(context.primarySpace?.name).toBe("Order Center");
  });

  it("prepares candidates without writing and then writes only confirmed candidates", async () => {
    const space = await createBusinessSpace({ name: "Pricing" });
    const candidates = await prepareMemoryCandidates({
      sourceText: "价格方案必须支持按城市配置折扣，验收时需要覆盖默认城市和特殊城市。",
      sourceType: "conversation",
      spaceId: space.id,
      hints: { module: "pricing", priority: "P1" },
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].candidate.dimensions.module).toBe("pricing");

    await expect(
      upsertMemory({
        candidate: candidates[0].candidate,
        confirmedByUser: false,
      }),
    ).rejects.toThrow(/confirmedByUser=true/);

    const memory = await upsertMemory({
      candidate: candidates[0].candidate,
      confirmedByUser: true,
    });

    expect(memory.version).toBe(1);
    expect(memory.spaceId).toBe(space.id);
  });

  it("searches without embeddings and supports archive and hard delete", async () => {
    const space = await createBusinessSpace({ name: "Settlement" });
    const memory = await upsertMemory({
      confirmedByUser: true,
      candidate: {
        spaceId: space.id,
        type: "business-rule",
        title: "Settlement window",
        summary: "结算窗口必须按自然日切分，并支持节假日顺延。",
        dimensions: { module: "settlement" },
        tags: ["settlement", "holiday"],
        evidence: [],
      },
    });

    const found = await searchMemories({
      query: "节假日 结算",
      spaceIds: [space.id],
      topK: 5,
      useEmbeddings: false,
    });

    expect(found.embeddingUsed).toBe(false);
    expect(found.results[0].memory.id).toBe(memory.id);

    const archived = await archiveMemory({ id: memory.id, reason: "superseded" });
    expect(archived.status).toBe("archived");
    expect(archived.version).toBe(2);

    const deleted = await deleteMemory({
      id: memory.id,
      confirmHardDelete: true,
      reason: "sensitive",
    });
    expect(deleted.id).toBe(memory.id);
  });
});

