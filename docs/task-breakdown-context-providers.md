# Task Breakdown Context Providers

## Purpose

Anchor's task breakdown context-provider system exists to supply bounded, task-relevant context into the task breakdown prompt without changing who does the planning. Anchor remains the planner and task-breakdown generator. Providers only contribute supporting context.

## Contract

The shared provider contract lives in `server/contextProviders/types.ts`.

The main provider entrypoint lives in `server/contextProviders/index.ts`:

- `collectTaskBreakdownContext(...)` gathers provider output
- `formatContextBlocksForPrompt(...)` formats provider context for prompt injection

Future work should extend this seam rather than creating a parallel abstraction elsewhere.

## Current Providers

### 1. User-authored / Notion direct-page context

Implemented in `server/contextProviders/notion.ts`.

This provider turns direct user-authored task context into `ContextBlock[]` and gives it higher prompt priority than external public evidence.

### 2. Mocked external research provider skeleton

Implemented in `server/contextProviders/externalResearch.ts`.

This is a read-only Phase 2A skeleton for bounded public-evidence retrieval. It is mocked only. It does not call live Perplexity or any live external research API yet.

## Prompt Ordering

Task breakdown prompts should preserve this order:

1. Anchor/internal context
2. User-authored Notion context
3. External public evidence
4. Final task instructions

The intent is:

- internal Anchor context frames the task
- user-authored context sharpens it with first-party notes
- external evidence only supports current public facts
- final instructions still tell the model how to break the task down

## Core Principles

- Anchor remains the planner.
- Providers supply bounded context only.
- Providers must degrade safely when skipped, empty, unavailable, rate-limited, or errored.
- Deterministic fallback must remain intact.
- Providers must not expose internal provider mechanics in user-facing task steps.

## Explicitly Out Of Scope

Unless separately approved, this system does not include:

- live Perplexity integration before Phase 2B
- workspace-wide Notion search
- vector search or RAG
- provider-written final task breakdowns
- schema changes
- storage changes
- UI changes

## Safe Extension Guidance

Future agents should extend this system by:

1. Reusing `server/contextProviders/types.ts`
2. Adding new provider implementations under `server/contextProviders/*`
3. Keeping provider output bounded to `ContextBlock[]`
4. Preserving prompt ordering and fallback behavior
5. Treating provider output as evidence/context, not planning authority
6. Avoiding private-data leakage to external providers unless explicitly approved and safely minimised

Do not reintroduce a second provider seam such as a separate task-breakdown-specific abstraction outside `server/contextProviders/*` unless the architecture is intentionally redesigned.
