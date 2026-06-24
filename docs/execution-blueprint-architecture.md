# Anchor execution blueprint architecture

## Purpose

The Execution Blueprint converts an approved Development Plan into the complete work hierarchy required to deliver it.

It answers:

> What work actually exists beneath the plan?

It does not answer:

> What should I do today?

That second question belongs to the later prioritization and materialization stage.

## Canonical flow

```text
Chosen target
→ Requirement Model
→ Coverage Model
→ Development Plan
→ Execution Blueprint
→ Execution prioritization
→ Limited task materialization
→ New evidence
→ Coverage refresh
```

## Inputs

- current Development Plan Model
- validated workstreams
- development modules
- milestones
- requirement links
- module outputs and assessment standards
- resource and dependency context already present in the plan

The blueprint must regenerate whenever the Development Plan's decision, module, output, milestone, requirement, or source-context contract changes.

## Outputs

### Workstream execution map

Each development workstream retains:

- one stable workstream identity
- the modules it contains
- the milestones it must complete
- the task blueprints that implement it
- the final completion task

### Task blueprints

Each task blueprint contains:

- stable identity
- one primary module and workstream
- linked requirements and milestones
- finite outcome-led title
- reason for existing
- full completion standard
- minimum useful outcome
- expected evidence
- owner
- effort band
- readiness and logical prerequisites
- task fields compatible with later materialization

### Subtask blueprints

Each subtask contains:

- stable identity
- specific action
- executor
- always or if-needed condition
- output specification
- completion standard
- subtask dependency

## Executor contract

### System

Use when the value is in an artifact or analysis that Anchor can create without destroying the value:

- source and evidence inventories
- maps and comparisons
- rubrics
- outlines
- draft artifacts
- structured feedback
- saved records

### User learning

Use when doing the work for the user would destroy its value:

- reading to understand
- practising a capability
- applying judgement
- reflecting on feedback
- revising substantive reasoning
- completing qualification learning

### User action

Use when a real-world or personal action cannot be taken by Anchor:

- send or submit
- enroll or pay
- attend or hold a conversation
- make a personal decision
- provide private factual information
- publish under the user's identity
- gather personal or legal documents

### Shared task

A task is shared when Anchor can prepare the structure or artifact but the user must provide judgement, learning, confirmation, or an external action.

## Development-module patterns

| Module | Typical blueprint sequence |
| --- | --- |
| Verification | inspect existing evidence → ask one focused question only if required → record coverage decision |
| Syllabus | build focused learning pack → apply concepts → produce and assess synthesis |
| Practice | define rubric and cases → complete practice rounds → retain strongest assessed sample |
| Experience | choose applied context → carry out target-like responsibility → document evidence |
| Proof | define proof brief → produce artifact → assess and publish or store |
| Narrative | assemble evidence → build positioning assets → test and refine |
| Relationships | map archetypes → prepare relationship moves → conduct and capture interactions |
| Access | map entry routes → test a route and record the market signal |
| Credential | verify materiality → select a proportionate route → complete and store evidence |
| Eligibility | verify the condition → resolve it or record the remaining constraint |

## Dependency rules

Dependencies express logical prerequisites only. They do not represent priority or scheduling.

- tasks within one module follow the module's production sequence
- proof may depend on relevant learning, practice, or experience
- positioning may depend on proof or experience
- access may depend on relationships where both serve the same requirement
- role-specific work remains conditional until its route is active
- dependency references must point to existing task blueprints
- cycles are invalid

## LLM responsibilities

The LLM may improve:

- specificity of task titles
- explanation of why a task exists
- minimum and full completion standards
- expected evidence wording
- subtask wording and output specifications

The LLM may not change:

- task or subtask IDs
- task count
- module, milestone, requirement, or workstream links
- executor or ownership decisions
- effort bands
- dependencies
- readiness
- materialization state
- priority or schedule

Deterministic code remains authoritative for hierarchy, ownership, dependencies, completeness, and scope.

## Quality standards

A complete blueprint has:

- 100 percent module coverage
- 100 percent milestone coverage
- 100 percent active-requirement coverage
- no duplicate stable task keys
- no invalid dependency references
- no dependency cycles
- no task with more than five subtasks
- an observable done condition and expected evidence for every task

## User experience

The user sees:

1. a concise summary of the complete work hierarchy
2. how much work Anchor can handle automatically
3. the division between Anchor-led, shared, user-led, and role-specific work
4. collapsed workstreams
5. task outcomes before subtasks
6. subtasks only through progressive disclosure

The user does not see or manage:

- internal IDs
- graph edges
- raw fingerprints
- every dependency at once
- a giant live task list
- a priority board before prioritization exists

## Materialization boundary

The blueprint is persisted in `trackIntelligence` as `executionBlueprintModel`.

No task rows are created in this installment.

A materialization request returns a conflict response until the next stage has:

- assessed leverage and dependencies
- considered deadlines and constraints
- selected the active execution slice
- decided how many tasks the user should see now

Only that selected slice should become live tasks or Today items.
