# Anchor execution prioritization and materialization

## Purpose

The Execution Blueprint contains all work that may be required. Installment 5 decides what should become active now and materializes only that limited slice.

It answers:

> Of all valid blueprint work, what should enter the live execution system now?

It does not collapse the full blueprint, manufacture urgency, or turn every requirement into a visible backlog.

## Canonical flow

```text
Chosen target
→ Requirement Model
→ Coverage Model
→ Development Plan
→ Execution Blueprint
→ Execution Priority Model
→ Limited task materialization
→ This Week and Inbox
→ Today planning
→ New evidence
→ Coverage refresh
```

## Product contract

Anchor should progress all material requirements over time, but it should not expose or activate all work simultaneously.

The complete blueprint remains the strategic inventory. The active slice is a rolling execution window containing the smallest set of tasks that can create meaningful progress without overwhelming the user.

The active slice and Today solve different problems:

- the active slice determines what is strategically in motion
- Today determines what is realistic under the current day's time, energy, calendar and commitments

Materialization therefore places ready work in This Week and waiting work in Inbox. The day planner remains the only authority that moves work into Today.

## Prioritization dimensions

The policy evaluates mutually distinct dimensions:

### Strategic value

- importance of the linked requirements
- build, strengthen, demonstrate or verify action
- breadth across several requirements

### Evidence value

- quality of the artifact, experience, relationship, validation or market signal produced
- milestone completion
- reuse across several requirements

### Executability

- prerequisite state
- logical readiness
- manageable minimum outcome
- effort band

### Timing

- real job, learning or follow-up deadlines linked to the track
- continuation of work already active

### Leverage

- useful downstream work unlocked
- automation that reduces user effort without replacing required learning or external action

### Load

- open work across the system
- open work on the same track
- number of deep or project tasks already active
- user-owned cognitive load

Blocking is deliberately capped below strategic and evidence value. A task does not become important merely because it blocks something else.

## Active slice policy

The default slice contains four tasks and never creates more than five.

The selection also limits:

- new tasks when the same track already has open work
- deep or project tasks
- user-owned tasks
- concentration in one workstream
- newly activated work to no more than two workstreams

Existing active blueprint tasks are preserved even when they exceed the preferred task or workstream limit. Anchor does not silently park work the user has already started.

Role-specific or contextual tasks remain outside the shared slice unless they are already active through an explicit prior decision.

## Slots

- **Now** is the strongest strategically ready task or the most relevant task already in progress.
- **Active** is existing live work preserved in the slice.
- **Next** depends on a selected or active prerequisite.
- **Parallel** can progress without waiting on another selected task.
- **Later** is useful but outside the safe active capacity.
- **Blocked** has an unmet logical prerequisite.
- **Conditional** belongs to a role-specific route that is not active.
- **Completed** remains historical evidence and is never recreated.

## LLM boundary

The deterministic policy owns:

- scores
- selection
- rank
- slots
- capacity
- workstream limits
- dependencies
- ownership
- materialization eligibility

The LLM may improve only:

- the concise explanation of the selected slice
- why a selected task matters now
- why an unselected task is later, blocked or conditional

The LLM cannot change IDs, selection, score, slot, dependencies, readiness, effort, ownership or materialization state.

## Materialization contract

Each selected blueprint task maps to at most one preferred live task through:

```text
sourceType = career_track
sourceId = track id
sourceStepType = execution_blueprint_task:<stable blueprint task id>
```

The mapping is always scoped by both the stable blueprint task ID and the current career track. A coincidentally identical blueprint ID on another track cannot suppress, complete or reuse this track's work.

Materialization is idempotent:

- an open mapped task is reused
- a completed mapped task is not recreated
- a stale selection is rejected
- the exact slice displayed in the interface must match the slice activated by the server
- missing prerequisites prevent unsafe task creation
- conditional tasks cannot enter the shared slice
- no more new tasks are created than the current capacity allows

Ready selected tasks enter This Week. Dependent tasks enter Inbox and remain waiting until their live prerequisites complete. Materialization never promotes a task into Today.

Subtasks retain their executor, condition, output specification and completion standard inside the existing task `steps` payload.

## Persistent target workspace

The most recently selected researched target is retained across reloads. When several researched targets exist, the user can switch the active target workspace without rerunning research.

The workspace restores:

- requirement review
- development plan
- active execution slice
- complete blueprint

## Automatic activation

Researching an intended target triggers downstream planning and attempts to activate the safe slice automatically. The activation state is visible: the interface shows pending, successful or failed materialization rather than swallowing a background error.

The priority view also provides a recoverable activation action if background materialization fails or if a later context change creates a new slice.

The user does not need to select gaps, rank blueprint tasks, or manage the internal scoring model.

## Safety gates

Materialization is blocked when:

- the Execution Blueprint is provisional
- the priority model is provisional
- the career track is paused or on watch
- the priority context or blueprint changed after selection
- the slice displayed by the client no longer matches the current server slice
- a selected task is conditional
- a prerequisite is absent or invalid

Older open tasks from a superseded blueprint are never deleted or silently altered. They are surfaced as a caveat for deliberate user handling.

## Quality standards

A complete priority model has:

- a unique selected set
- no selected conditional task
- no selected task with an unmet prerequisite
- no newly selected work beyond two workstreams
- complete candidate coverage for the current blueprint
- selection within capacity, except preserved existing active work
- deterministic explanations available even if the LLM is unavailable

A safe materialization run has:

- stable track-scoped provenance
- no duplicate live task for the same blueprint task and career track
- valid dependency mappings
- bounded task creation
- zero direct Today promotions
- activity-log traceability
- a retained materialization history in track intelligence

## Feedback loop

As tasks become complete, blocked, skipped or stale, the execution context fingerprint changes. The priority model then recalculates from the current blueprint and live state.

The next active slice should be selected from remaining work rather than expanding the original slice indefinitely.
