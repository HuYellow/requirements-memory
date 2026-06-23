import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  archiveMemory,
  bindSessionProfile,
  createBusinessSpace,
  deleteMemory,
  getSessionContext,
  initializeStore,
  listBusinessSpaces,
  listSessionProfiles,
  readCurrent,
  upsertMemory,
} from "./fsStore.js";
import { importDocument, prepareMemoryCandidates } from "./candidates.js";
import { rebuildIndex, searchMemories, filtersSchema } from "./search.js";

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: (error as Error).message || String(error),
      },
    ],
  };
}

function tool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: T,
  handler: (input: z.infer<z.ZodObject<T>>) => Promise<unknown>,
) {
  const parser = z.object(inputSchema);
  const registerToolAny = server.registerTool.bind(server) as (
    toolName: string,
    config: Record<string, unknown>,
    cb: (input: Record<string, unknown>) => Promise<ReturnType<typeof jsonResult> | ReturnType<typeof errorResult>>,
  ) => unknown;
  registerToolAny(
    name,
    {
      title: name,
      description,
      inputSchema,
    },
    async (input: Record<string, unknown>) => {
      try {
        return jsonResult(await handler(parser.parse(input)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

const server = new McpServer({
  name: "requirements-memory",
  version: "0.1.0",
});

tool(
  server,
  "create_business_space",
  "Create a business requirements memory space.",
  {
    name: z.string().min(1),
    description: z.string().optional(),
    aliases: z.array(z.string()).optional(),
  },
  async (input) => createBusinessSpace(input),
);

tool(
  server,
  "list_business_spaces",
  "List all local business requirements memory spaces.",
  {},
  async () => listBusinessSpaces(),
);

tool(
  server,
  "bind_session_profile",
  "Bind a workspace session profile to a primary business space and optional reference spaces.",
  {
    workspacePath: z.string().min(1),
    profileName: z.string().default("default"),
    primarySpaceId: z.string().min(1),
    referenceSpaceIds: z.array(z.string()).default([]),
  },
  async (input) => bindSessionProfile(input),
);

tool(
  server,
  "get_session_context",
  "Return the business space binding for a workspace session profile.",
  {
    workspacePath: z.string().min(1),
    profileName: z.string().default("default"),
  },
  async (input) => getSessionContext(input),
);

tool(
  server,
  "list_session_profiles",
  "List workspace session profile bindings.",
  {
    workspacePath: z.string().optional(),
  },
  async (input) => listSessionProfiles(input.workspacePath),
);

tool(
  server,
  "prepare_memory_candidates",
  "Extract proposed requirement memory candidates from conversation or text. This never writes memory.",
  {
    sourceText: z.string().min(1),
    sourceType: z.enum(["conversation", "document", "manual"]),
    spaceId: z.string().optional(),
    sourceRef: z.string().optional(),
    hints: z.record(z.string(), z.string()).optional(),
  },
  async (input) => prepareMemoryCandidates(input),
);

tool(
  server,
  "upsert_memory",
  "Create or version-update a confirmed requirement memory. Requires confirmedByUser=true.",
  {
    candidate: z.unknown(),
    spaceId: z.string().optional(),
    confirmedByUser: z.boolean(),
    reason: z.string().optional(),
  },
  async (input) => upsertMemory(input),
);

tool(
  server,
  "search_memories",
  "Search requirements memory by query, dimensions, tags, status, and optional semantic vectors.",
  {
    query: z.string().default(""),
    workspacePath: z.string().optional(),
    profileName: z.string().default("default"),
    spaceId: z.string().optional(),
    includeReferences: z.boolean().default(true),
    filters: filtersSchema,
    topK: z.number().int().positive().max(50).default(8),
    useEmbeddings: z.boolean().default(true),
  },
  async (input) => {
    let spaceIds: string[] = [];
    if (input.spaceId) {
      spaceIds = [input.spaceId];
    } else if (input.workspacePath) {
      const context = await getSessionContext({ workspacePath: input.workspacePath, profileName: input.profileName });
      if (!context.profile) {
        return {
          results: [],
          embeddingUsed: false,
          message: "No session profile binding found for this workspace/profile.",
        };
      }
      spaceIds = [context.profile.primarySpaceId];
      if (input.includeReferences) {
        spaceIds.push(...context.profile.referenceSpaceIds);
      }
    } else {
      throw new Error("Provide either spaceId or workspacePath.");
    }
    return searchMemories({
      query: input.query,
      spaceIds,
      filters: input.filters,
      topK: input.topK,
      useEmbeddings: input.useEmbeddings,
    });
  },
);

tool(
  server,
  "import_document",
  "Extract proposed memory candidates from a local .md, .txt, or .json document. This never writes memory.",
  {
    filePath: z.string().min(1),
    spaceId: z.string().min(1),
    mode: z.literal("propose").default("propose"),
  },
  async (input) => importDocument(input),
);

tool(
  server,
  "archive_memory",
  "Soft-delete a memory by archiving it while preserving version history.",
  {
    id: z.string().min(1),
    reason: z.string().optional(),
  },
  async (input) => archiveMemory(input),
);

tool(
  server,
  "delete_memory",
  "Hard-delete a memory and remove vector index content. Requires confirmHardDelete=true.",
  {
    id: z.string().min(1),
    confirmHardDelete: z.boolean(),
    reason: z.string().optional(),
  },
  async (input) => deleteMemory(input),
);

tool(
  server,
  "rebuild_index",
  "Rebuild keyword metadata and optional OpenAI embedding vectors for one business space.",
  {
    spaceId: z.string().min(1),
    embeddingMode: z.enum(["auto", "off", "required"]).default("auto"),
  },
  async (input) => rebuildIndex(input),
);

tool(
  server,
  "read_space",
  "Read the current structured memory document for a business space.",
  {
    spaceId: z.string().min(1),
  },
  async (input) => readCurrent(input.spaceId),
);

await initializeStore();
await server.connect(new StdioServerTransport());
