# Anchor adaptive evidence feedback loop

## Purpose

The planning stack is useful only when completed work changes the system's understanding of the user.

The adaptive evidence loop closes that gap:

```text
Live task completed
→ structured execution outcome
→ evidence acceptance or one focused clarification
→ coverage reassessment
→ milestone validation
→ selective downstream regeneration
→ next active slice
```

## Core distinction

```text
Task completed ≠ requirement proven
```

A completed task establishes that an activity ended. It does not, by itself, establish the quality, relevance or external credibility of the result.

Anchor therefore creates an execution outcome first and then submits accepted outcomes to the existing evidence and coverage policy. The coverage model remains authoritative for whether a requirement is proven, partly proven, below the target bar, unproven or unknown.

## Outcome model

Each execution outcome retains:

- stable outcome identity
- career track
- blueprint and live task identity
- workstream, module, milestone and requirement links
- task kind and outcome type
- expected evidence
- completion basis
- accepted evidence detail and URL
- evidence strength
- confirmation state
- timestamps

Outcome states are:

- `needs_confirmation`
- `accepted`
- `rejected`
- `superseded`

Reopening a task supersedes the previous accepted outcome and triggers a fresh coverage assessment.

## Low-input evidence capture

Anchor first uses what already exists:

- completed blueprint task identity
- task and subtask completion
- expected evidence
- saved evidence URL
- existing requirement and coverage context

The system accepts low-risk supporting evidence automatically for research and verification work, and accepts inspectable evidence when a safe HTTP or HTTPS URL exists.

For outcomes that cannot be inferred responsibly—such as experience, relationship, access, credentials and finished artifacts—Anchor asks one focused question. It does not present a generic completion form.

Examples:

- What concrete responsibility or outcome did this work produce?
- What substantive interaction or useful signal resulted?
- What finished output or link should Anchor inspect?
- What formal status or credential evidence was obtained?

The user may also decline to use a completion as evidence.

## Evidence strength

Accepted outcomes map conservatively into the canonical evidence corpus:

| Outcome | Corpus signal |
| --- | --- |
| Applied learning without a published output | Completed learning |
| Published learning output | Learning output |
| Practice, artifact, validation, credential or research output | Proof asset |
| Applied responsibility and result | Win |
| Relationship or hiring-access signal | Interaction |

Evidence strength is:

- `supporting` for an accepted but non-inspectable completion signal
- `direct` for a confirmed real-world responsibility, interaction or access outcome
- `verified` when Anchor has a safe inspectable evidence URL

The existing topical-relevance and category-specific coverage policies still apply. An accepted outcome cannot directly set coverage to proven.

## Coverage refresh

When accepted evidence changes, Anchor:

1. persists the outcome before reassessment
2. rebuilds the adaptive evidence corpus
3. refreshes coverage
4. records the before-and-after status of affected requirements
5. refreshes the development plan
6. refreshes the execution blueprint
7. refreshes the execution priority model

The user sees the coverage delta rather than raw model churn.

## Milestone semantics

A milestone is achieved only when every linked requirement is proven against its success bar.

- `not_started` means no accepted evidence or partial coverage exists
- `in_progress` means accepted evidence or partial coverage exists
- `needs_evidence` means a completed task still requires confirmation
- `achieved` means all linked requirements are proven

Task completion never marks a milestone achieved directly.

## Lifecycle integration

A single storage-level task lifecycle hook emits completed and reopened transitions regardless of whether the mutation originated in Today, Inbox, capture or another task route.

Evidence processing runs asynchronously so the task update response remains fast. The explicit reconcile endpoint provides a safe recovery path if a listener fails or a completion predates the feature.

## API

```text
GET  /api/career-tracks/:id/execution-progress
POST /api/career-tracks/:id/execution-progress/reconcile
POST /api/career-tracks/:id/execution-outcomes/:outcomeId/confirm
```

The confirmation endpoint accepts one factual answer, an evidence URL, or an explicit rejection.

## User experience

The target workspace shows only:

- the latest coverage movement
- milestone progress
- one pending evidence question at a time
- recent accepted outcomes behind disclosure

Requirements, complete plans and blueprints remain available, but the progress layer foregrounds what changed because the user acted.

## Safety rules

- No unsafe URL scheme enters the evidence corpus.
- No user answer is required when Anchor can infer a conservative supporting signal.
- No task completion directly proves a requirement.
- No rejected or superseded outcome contributes to coverage.
- No external action is taken automatically.
- Downstream regeneration preserves completed and active work through stable provenance.
- Concurrent completion processing is deduplicated by track.
