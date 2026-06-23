---
name: requirements-memory
description: Use when the user discusses requirements, PRDs, product design, business rules, acceptance criteria, implementation plans, cross-workspace requirement context, or asks to record, retrieve, bind, update, archive, delete, or import requirements memory.
---

# Requirements Memory

Use this skill to manage structured local memory for business requirements. The memory system is explicit and traceable: retrieve relevant facts before requirement-sensitive work, propose new memory candidates after requirement discussions, and write only after user confirmation.

## Concepts

- A `businessSpace` is the business-level requirements memory container. It can span multiple code workspaces.
- A `sessionProfile` is a plugin-managed name under a workspace, such as `default`, `pricing-v2`, or `order-center`. It binds the current work context to one primary `businessSpace`.
- A profile has one primary business space for writes and optional reference spaces for read-only lookup.
- Project facts, decisions, constraints, and business rules belong in Requirements Memory. Long-term style preferences can stay in Codex Memories.

## Retrieval Workflow

When a task mentions requirements, product design, technical solution design, business rules, acceptance criteria, implementation against a requirement, or a PRD:

1. Call `get_session_context` with the current workspace path and `profileName: "default"` unless the user named another profile.
2. If a profile is bound, call `search_memories` with the user's task as `query`, `workspacePath`, profile name, and `includeReferences: true`.
3. Use retrieved memories as traceable context. Cite memory IDs when a memory materially affects the answer or implementation.
4. If no profile is bound, tell the user that this workspace/profile is not bound to a business space and offer to create or bind one.

## Capture Workflow

When the conversation creates, changes, or clarifies requirements:

1. Call `prepare_memory_candidates` with `sourceType: "conversation"` and the primary space ID if known.
2. Show the proposed candidates with title, type, summary, dimensions, tags, evidence summary, and possible duplicates.
3. Ask for confirmation before writing.
4. Only call `upsert_memory` with `confirmedByUser: true` after confirmation.

Never silently persist memory. Do not call `upsert_memory` merely because a requirement was mentioned.

## Document Import

For local `.md`, `.txt`, or `.json` requirement documents:

1. Ensure the target business space is known.
2. Call `import_document`.
3. Review candidates with the user.
4. Write confirmed candidates with `upsert_memory`.

Unsupported formats should be reported as unsupported in v1 rather than parsed ad hoc.

## Search And Privacy

- `search_memories` uses keyword and dimension matching by default.
- If `OPENAI_API_KEY` is configured, embeddings may be used for semantic ranking.
- Embedding text must contain only title, summary, dimensions, custom dimensions, and tags. Do not send evidence quotes or original source text for embeddings.

## Mutation Rules

- Use `archive_memory` for normal deletion.
- Use `delete_memory` only when the user explicitly requests permanent deletion; pass `confirmHardDelete: true`.
- Updates are versioned. Prefer updating an existing duplicate candidate over creating a near-duplicate record.

