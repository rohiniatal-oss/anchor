# Adaptive execution evidence loop

## Purpose

The adaptive evidence loop turns completed execution work into conservative career evidence and uses that evidence to refresh the selected target.

The operating sequence is:

```text
Live task completion
→ structured execution outcome
→ focused confirmation only where needed
→ canonical evidence corpus
→ coverage reassessment
→ milestone reassessment
→ development plan and blueprint refresh
→ next active slice
```

Task completion and requirement proof remain separate. Checking a task as complete is an execution signal; it is not automatically evidence that a market requirement has been met.

## Outcome states

Every completed blueprint task produces one versioned execution outcome.

- `accepted` means the result is usable as coverage evidence.
- `pending_confirmation` means one specific factual result cannot be inferred safely.
- `operational_only` means the task advanced planning or verification but did not prove user capability.
- `insufficient` means the task was completed but did not produce usable evidence.
- `reopened` withdraws previous evidence because the underlying task is no longer complete.

Repeated scans are idempotent by career track, blueprint task and live task.

## Evidence policy by task type

| Task type | Automatic treatment | Confirmation required when |
| --- | --- | --- |
| Learning | Supporting evidence only after all required applied steps are complete | The applied output cannot be established |
| Practice | Supporting evidence after a completed assessed attempt | The retained work sample or assessment signal is unclear |
| Artifact | Verified with an inspectable HTTP or HTTPS output | No inspectable output is linked |
| Validation | Verified with an inspectable reviewed output | The reviewed result cannot be inspected |
| Experience | Verified with an inspectable output, otherwise pending | Responsibility, contribution or observable result is unknown |
| Relationship | Pending | A substantive interaction or useful signal must be confirmed |
| Access | Pending | A real application, introduction, referral, interview or other market signal must be confirmed |
| Credential | Verified with formal evidence, otherwise pending | Completion or accepted alternative cannot be established |
| Research | Operational only | It never proves user capability by itself |
| Verification | Operational only | It updates the assessment basis rather than manufacturing capability |

A confirmation can classify an outcome as direct, supporting, no evidence, or mistaken completion. A source link is accepted only when it uses HTTP or HTTPS.

## Focused confirmation contract

Anchor asks no generic completion questionnaire.

It first uses:

- the task and its blueprint contract
- completed blueprint subtasks
- saved task notes
- linked output URLs
- expected evidence
- existing coverage evidence

A question appears only when one missing fact prevents a defensible evidence decision. Relationship and access tasks use a small set of factual signal options. Artifact, experience and credential tasks accept one concise result and, where relevant, an optional evidence link.

## Coverage integration

Accepted outcomes enter the existing canonical evidence corpus as `execution_outcome` entities. Pending, insufficient, operational-only and reopened outcomes remain outside coverage.

The outcome evidence preserves:

- career track
- live task
- blueprint task
- workstream and module
- linked requirements and milestones
- evidence strength
- source URL
- user confirmation
- completion timestamp

Coverage remains conservative. Supporting execution evidence may improve the assessment without proving the full success bar. Direct or verified evidence can prove a requirement only when it satisfies the existing category-specific coverage policy.

## Replanning boundary

Only a change to the outcome's coverage contribution triggers the expensive downstream refresh.

```text
Coverage-bearing evidence added, strengthened or withdrawn
→ force coverage refresh for the affected track
→ rebuild the development plan from current coverage
→ rebuild the execution blueprint from the current plan
→ recalculate the active slice from current live work
```

Creating a pending confirmation does not trigger full replanning. Confirming that no useful evidence resulted also avoids unnecessary coverage work because the canonical corpus is unchanged.

The current implementation refreshes the affected career track rather than every track. Requirement deltas are