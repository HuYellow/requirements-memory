# Requirements Memory

Requirements Memory is a local Codex plugin for recording, retrieving, and maintaining structured business requirements memory across multiple code workspaces.

It is designed for teams or individuals who discuss requirements with Codex, then later want Codex to remember concrete requirement facts, product decisions, constraints, business rules, acceptance criteria, and cross-repository context without relying on vague conversation history.

## Why This Plugin Exists

Codex can use conversation context and built-in memories, but requirement work often needs a stricter shape:

- Requirements should be explicit, reviewable, and traceable.
- A business requirement may span multiple code repositories or workspace folders.
- Requirement changes should be versioned instead of silently overwritten.
- Codex should retrieve relevant requirement facts before producing implementation plans or code.
- New memory should not be written silently; the user should confirm what becomes durable memory.

Requirements Memory provides a structured local store and an MCP tool layer for that workflow.

## What It Does

- Creates business-level memory spaces independent of a single repository.
- Binds a workspace session profile to a primary business space.
- Supports optional reference spaces for cross-domain lookup.
- Extracts candidate memory entries from conversations or local documents.
- Requires explicit confirmation before writing memory.
- Version-updates existing memory entries instead of overwriting them silently.
- Searches memory by keywords, dimensions, tags, type, status, and optional semantic embeddings.
- Archives memory by default and supports explicit hard deletion.
- Writes local JSON event/state files and a human-readable Markdown mirror.

## Core Concepts

### Business Space

A `businessSpace` is the business-level container for requirements memory. It is not the same as a Git repository.

For example, an "Order Center" business space may be relevant to:

- `order-api`
- `order-admin`
- `settlement-service`
- `mobile-order-page`

The plugin stores requirement facts under the business space so they remain coherent even when implementation spans several workspaces.

### Session Profile

A `sessionProfile` is a plugin-managed name under a workspace. The default profile is `default`.

The binding shape is:

```text
workspacePath + sessionProfile -> primary businessSpace + optional reference spaces
```

This avoids relying on Codex internal thread IDs. The same workspace can have multiple profiles, such as:

- `default`
- `pricing-v2`
- `settlement-migration`
- `risk-control`

Writes always go to the primary business space. Reference spaces are read-only lookup context.

### Requirement Memory

A memory entry is a structured requirement fact. It includes:

- type: `requirement`, `decision`, `constraint`, `business-rule`, `preference`, or `note`
- title and summary
- fixed dimensions such as project, module, feature, role, scenario, constraint, decision, priority, owner
- custom dimensions
- tags
- status
- version
- evidence summaries and short quotes

The schema is intentionally more rigid than plain notes so Codex can retrieve and apply entries consistently.

## How It Works

Requirements Memory is implemented as a Codex plugin with two parts:

1. A skill in `skills/requirements-memory/SKILL.md`.
2. A local MCP server in `src/server.ts`.

The skill tells Codex when and how to use the plugin:

- retrieve memory before requirement-sensitive tasks
- propose candidates after requirement discussions
- ask before writing durable memory
- cite memory IDs when memory affects an answer or implementation

The MCP server exposes tools for storage, search, import, update, and deletion. It runs over stdio and stores data locally.

## Local Data Layout

By default, data is stored under:

```text
~/.codex/requirements-memory
```

On Windows this resolves to:

```text
%USERPROFILE%\.codex\requirements-memory
```

The directory contains:

```text
requirements-memory/
  bindings.json
  spaces/
    <spaceId>/
      current.json
      events.jsonl
      memory.md
  indexes/
    <spaceId>.json
```

File roles:

- `bindings.json`: workspace/profile to business-space bindings.
- `current.json`: current state of a business space.
- `events.jsonl`: append-only version events.
- `memory.md`: human-readable mirror of active memory.
- `indexes/*.json`: optional vector index metadata.

You can override the data root with:

```bash
REQUIREMENTS_MEMORY_HOME=/path/to/data
```

## Search Model

Search combines:

- keyword matching
- dimension filtering
- tag/type/status filters
- recency and active-status boosts
- optional semantic vector ranking

If `OPENAI_API_KEY` is configured, the plugin can use OpenAI embeddings for semantic ranking. If no key is configured, it automatically falls back to keyword and dimension search.

For privacy, embeddings only use:

- title
- summary
- dimensions
- custom dimensions
- tags

Evidence quotes and original source text are not sent for embeddings.

## MCP Tools

The plugin exposes these MCP tools:

| Tool | Purpose |
| --- | --- |
| `create_business_space` | Create a business requirements memory space. |
| `list_business_spaces` | List local business spaces. |
| `bind_session_profile` | Bind a workspace profile to a primary space and optional reference spaces. |
| `get_session_context` | Read the binding for a workspace/profile. |
| `list_session_profiles` | List profile bindings. |
| `prepare_memory_candidates` | Extract candidate memory entries from text without writing. |
| `upsert_memory` | Create or version-update a confirmed memory entry. |
| `search_memories` | Search memory by query, dimensions, tags, type, status, and optional embeddings. |
| `import_document` | Extract candidates from `.md`, `.txt`, or `.json` documents. |
| `archive_memory` | Soft-delete a memory while preserving version history. |
| `delete_memory` | Hard-delete a memory after explicit confirmation. |
| `rebuild_index` | Rebuild optional semantic vector indexes. |
| `read_space` | Read the current structured document for a space. |

## Installation For Local Development

Clone the repository:

```bash
git clone https://github.com/HuYellow/requirements-memory.git
cd requirements-memory
```

Install dependencies and build:

```bash
npm install
npm run build
```

Run tests:

```bash
npm test
node tests/mcp-smoke.mjs
```

The plugin manifest lives at:

```text
.codex-plugin/plugin.json
```

The MCP config lives at:

```text
.mcp.json
```

The MCP config starts:

```bash
node scripts/start-server.mjs
```

The start script expects `dist/src/server.js`, so `npm run build` must be run before use.

## Installing In Codex

For local plugin development, place or clone this repository under your local plugin directory, then add it to a Codex plugin marketplace entry.

Example marketplace entry:

```json
{
  "name": "requirements-memory",
  "source": {
    "source": "local",
    "path": "./plugins/requirements-memory"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

Then install from the marketplace:

```bash
codex plugin add requirements-memory@personal
```

Open a new Codex thread after installation so the skill and MCP tools are loaded.

## Example Workflow

Create a business space:

```text
Create a business requirements space named "Order Center".
```

Bind the current workspace:

```text
Bind this workspace default sessionProfile to the Order Center business space.
```

Record memory from a discussion:

```text
From this requirement discussion, propose memory entries. Do not write them until I confirm.
```

Search memory before implementation:

```text
Before implementing this order cancellation change, search relevant requirements memory.
```

Import a local document:

```text
Import requirements from docs/order-cancel.md into the Order Center business space as candidates.
```

## Versioning And Deletion

Updates are versioned. When an existing memory is updated, the plugin:

- increments the memory version
- updates the current state
- appends an event to `events.jsonl`

Deletion has two modes:

- `archive_memory`: default soft deletion, keeps history.
- `delete_memory`: hard deletion, requires explicit confirmation and removes vector index content.

## Privacy Notes

- Data is local by default.
- The plugin does not write memory without explicit user confirmation.
- Document import only supports `.md`, `.txt`, and `.json` in v1.
- Semantic search is optional and requires `OPENAI_API_KEY`.
- Embeddings do not include evidence quotes or full original source text.

## Development

Useful commands:

```bash
npm run build
npm test
node tests/mcp-smoke.mjs
```

Project structure:

```text
.codex-plugin/
  plugin.json
.mcp.json
skills/
  requirements-memory/
    SKILL.md
scripts/
  start-server.mjs
src/
  server.ts
  fsStore.ts
  search.ts
  candidates.ts
  schemas.ts
tests/
  store.test.ts
  mcp-smoke.mjs
```

## Current Limitations

- No hosted sync service.
- No multi-user permission model.
- No UI panel.
- No Word/PDF import in v1.
- Semantic search requires an OpenAI API key and is optional.

## License

MIT

