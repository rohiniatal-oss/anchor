# Claude Parallel Handoff

Last updated: 2026-06-18  
Source of truth reviewed by Codex: `origin/master` at `c21ecb50e25e89c511ff748b90298e888f38e560`

## Goal

Take one high-value workstream in parallel without colliding with the in-flight Codex slice.

Codex is currently owning the **shared strongest-next-action consistency refactor** across:

- `client/src/lib/trackNextAction.ts`
- `client/src/components/home/StrategicNextSteps.tsx`
- `client/src/pages/views/StrategyView.tsx`

Claude should **not touch those files** in this pass.

## Claude-Owned Workstream

### Theme
Make cross-entity support explicit in the Jobs flow instead of inferred and hidden.

### Why this is the right parallel slice

- It is product-important.
- It is mostly separate from the Strategy/Today consistency refactor.
- It tackles a real gap already identified in the audit:
  - jobs and contacts are partly linked in data, but not promoted as a clear support path in the UI
  - `entity_links` exists but is underused

## Scope

### 1. Persist durable job-contact support links

Use `entity_links` to store explicit support relationships rather than relying only on:

- company overlap
- shared track
- target role text

Preferred link shape:

- relation like `contact_for` or `supports_job`
- one job can have multiple supporting contacts
- one contact can support multiple jobs

Suggested files:

- `shared/schema.ts`
- `server/storage.ts`
- any server route/helper that already creates or updates contact/job relationships

### 2. Surface related contacts inline in JobsView

When viewing a job, show the most relevant contact support directly in the job card or step area.

Examples:

- `You already know someone who could help here`
- `Referral path exists`
- `Talk to X before applying`

This should not be buried as vague warm-path copy. It should be a clear, useful next move.

Suggested files:

- `client/src/pages/views/JobsView.tsx`
- supporting server logic if JobsView needs richer response data

### 3. Make referral-stage logic use actual contacts where possible

If a job is at a stage like referral / networking / outreach, prefer specific linked contacts over generic networking suggestions.

Suggested files:

- `server/strategy.ts`
- `server/routes.ts`
- `server/sprint1.ts`
- `client/src/pages/views/JobsView.tsx`

## Out of Scope

Do not touch these in this pass:

- `client/src/lib/trackNextAction.ts`
- `client/src/components/home/StrategicNextSteps.tsx`
- `client/src/pages/views/StrategyView.tsx`
- recommendation freshness sync behavior
- profile/CV-triggered stale recompute
- task intake inference

Those are either already in-flight with Codex or belong to a separate workstream.

## Acceptance Criteria

Claude's slice is done when all of these are true:

1. Jobs can show explicit related-contact support, not just generic warm-path language.
2. The underlying relationship is durable in data, not only inferred ad hoc in the UI.
3. The chosen relationship model is cleaned up correctly on delete/update paths.
4. The strongest support contact is promoted inline where the user actually works the role.
5. TypeScript passes for the slice.
6. Any touched tests are updated or added.

## Preferred Implementation Shape

Keep it simple and truthful:

- do not over-model the graph
- one small durable relationship shape is better than many speculative ones
- prefer one clear “who could help this role now?” surface over several weak hints
- prefer existing contacts over generic AI-generated networking suggestions when a real match exists

## Verification

At minimum run:

```powershell
& 'C:\Users\rohin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\typescript\bin\tsc
```

If tests are touched, also run the smallest relevant targeted set.

## Suggested Branch

Something like:

- `claude/jobs-contact-support`

## What Claude Should Report Back

Claude should return:

1. Files changed
2. Data model decision taken
3. User-visible behavior change
4. Verification run
5. Any follow-on risks or unresolved edge cases

## Paste-Ready Claude Prompt

```text
Work on one non-overlapping parallel slice in Anchor.

Source of truth: origin/master at c21ecb50e25e89c511ff748b90298e888f38e560.

Do not touch:
- client/src/lib/trackNextAction.ts
- client/src/components/home/StrategicNextSteps.tsx
- client/src/pages/views/StrategyView.tsx

Your slice:
Make cross-entity job-contact support explicit and durable.

Required outcomes:
1. Persist a durable job-contact support relationship using entity_links or an equally simple existing mechanism.
2. Surface related contacts inline in JobsView so a job clearly shows who could help.
3. Make referral / networking stages prefer real linked contacts over generic support copy.
4. Keep the implementation truthful and simple.
5. Run TypeScript and any targeted tests for touched areas.

Please report back with:
- files changed
- data model decision
- user-visible behavior
- verification
- remaining risks
```
