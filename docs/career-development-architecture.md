# Anchor career development architecture

## Product promise

The user has already chosen a target. Anchor helps them answer three questions:

1. What does this target require?
2. What do I already have credible evidence for?
3. How will I build or demonstrate the rest?

Only after those questions have defensible answers may Anchor create an execution blueprint, tasks, subtasks, or daily priorities.

## Canonical flow

```text
Chosen target
  -> market and role-family research
  -> requirement model
  -> coverage model
  -> development plan model
  -> execution blueprint
  -> tasks and subtasks
  -> execution prioritization
  -> new personal evidence
  -> coverage and plan refresh
```

The flow is directional for the user but evidence-driven underneath. New market evidence can update requirements. New personal evidence can update coverage. A changed requirement or coverage model invalidates the downstream plan through fingerprints.

## Stage contracts

### Research determines what the target requires

**Input**

- chosen target
- current market and role-family evidence
- employer pages and job descriptions
- institutional and practitioner sources
- target context such as geography, seniority, and employer type

**Output**

- market segments and role families
- source-backed requirement claims
- requirement importance, success bars, scope, context, and confidence

**Must not do**

- decide whether the user should want the target
- assess the user's fit or preferences
- prescribe courses or tasks
- infer personal capability from market evidence

### Coverage determines what the user already demonstrates

**Input**

- requirement model
- current CV and profile
- inspectable outputs
- completed learning with outputs
- wins and explicit feedback
- established relationships and access signals

**Output**

- `proven`
- `partially_proven`
- `unproven`
- `unknown`
- `below_bar`
- linked personal evidence and missing-evidence explanations

**Must not do**

- treat absence of evidence as absence of ability
- treat open tasks or intentions as evidence
- treat a saved cold contact as a relationship
- treat course completion alone as job-ready skill
- mark `below_bar` without explicit negative evidence

### Development planning determines how to improve coverage

**Input**

- requirement model
- coverage model
- market-research quality
- existing development and proof objects

**Output**

- build, strengthen, demonstrate, verify, or maintain decision per requirement
- coherent shared and role-specific workstreams
- living syllabus modules where learning is justified
- applied practice, projects, proof, access, positioning, credentials, or verification
- output-led milestones and assessment standards
- source-backed resources

**Must not do**

- create one plan per requirement
- prescribe substantial investment from low-confidence requirements
- turn unknown coverage into assumed weakness
- create tasks, daily actions, schedules, or execution priority
- recommend passive reading without application, synthesis, practice, or output

### Execution blueprint determines the work required

This is a later stage.

**Input**

- approved, valid development plan
- workstreams, milestones, dependencies, outputs, and resource constraints

**Output**

- task blueprints
- subtasks
- completion standards
- effort and dependency estimates
- evidence each task is expected to create

**Must not do**

- prioritize by day or energy before the complete work hierarchy exists
- materialize the entire plan into the task list

### Execution prioritization determines order and active focus

This is a later stage.

**Input**

- complete execution blueprint
- dependencies, deadlines, effort, leverage, available time, and current evidence

**Output**

- first, next, later, and parallel execution order
- a small materialized slice for the active planning system

## Core object relationships

```text
Career track
  has many role families
  has many target requirements

Target requirement
  supported by many market evidence claims
  assessed by one current coverage judgement
  supported by many personal evidence claims
  linked to one primary development workstream
  may benefit from several milestone outputs

Development workstream
  improves several related requirements
  contains modules and milestones
  may reuse resources and evidence across targets

Milestone
  generates evidence
  later decomposes into tasks

Completed task or output
  generates personal evidence
  may update several requirement coverage judgements
```

## LLM and deterministic responsibilities

### LLM responsibilities

Use the LLM where semantic judgement improves quality:

- interpret market evidence into requirement candidates
- map personal evidence to relevant requirements
- explain why evidence does or does not meet a success bar
- cluster related requirements into coherent workstreams
- design applied syllabus modules and output-led milestones
- research authoritative resources using web search

### Deterministic responsibilities

Use code where consistency, safety, and traceability matter:

- validate IDs and source provenance
- reject invented source IDs and invalid URLs
- enforce requirement and coverage taxonomies
- apply category-specific proof standards
- preserve all essential and important requirements
- keep unknowns in verification
- prevent mixed shared and role-specific primary workstreams
- detect duplicates, orphan requirements, invalid dependencies, and cycles
- fingerprint stages and invalidate stale downstream models
- block task materialization before the execution blueprint exists

The LLM may recommend. Deterministic policy decides whether its recommendation is admissible.

## Requirement taxonomy

### Perform the work

- knowledge
- skill and judgement

### Demonstrate credibility

- relevant experience
- inspectable evidence and outputs
- credentials
- narrative

### Access the opportunity

- relationships
- hiring routes and access
- eligibility and logistics

Requirements are also classified as:

- essential
- important
- differentiator
- contextual

and scoped as:

- shared across the target
- specific to a role family

## Coverage policy

| Requirement category | Evidence normally required for `proven` |
| --- | --- |
| Experience | Direct CV/profile or explicit experience evidence |
| Knowledge | Applied output, assessment/feedback, or multiple credible supporting sources |
| Skill | Inspectable output or explicit performance feedback |
| Evidence | Inspectable completed output |
| Network | Established relationship or substantive interaction |
| Access | Established relationship, referral, introduction, or demonstrated hiring-route progress |
| Credential | Direct credential evidence |
| Eligibility | Direct status or documentary evidence |
| Narrative | Explicit feedback or repeated successful market signals |

A job title alone does not prove every capability associated with that job. A draft does not prove a completed output. A lead does not prove a relationship.

## Development decisions

| Coverage | Default development decision |
| --- | --- |
| Proven | Maintain and reuse evidence |
| Partially proven | Strengthen the underlying asset or demonstrate it more clearly |
| Unproven | Build or demonstrate, depending on requirement category |
| Unknown | Verify before prescribing substantial work |
| Below bar | Build or strengthen, supported by explicit negative evidence |

Low-confidence requirements, unresolved eligibility gates, and costly credentials are verified before investment.

## Development methods

- learn
- practise
- gain experience through real or simulated projects
- produce inspectable proof
- build relationships and access
- position existing evidence coherently
- satisfy a genuinely required credential
- research to resolve uncertainty

Learning is one method, not the default. A syllabus must lead to application, synthesis, practice, or an output.

## User experience invariants

The main experience answers only:

1. **What you need**
2. **What you already have evidence for**
3. **How Anchor will build the rest**

The user should not manage:

- market maps
- graph links
- source IDs
- internal statuses
- requirement-selection boards
- task inventories before the plan exists

Use progressive disclosure:

- show a concise conclusion first
- keep source evidence and reasoning expandable
- surface only material caveats
- ask for input only when one correction would materially change the plan
- never require the user to review every inference

## Update and revision rules

- Market-evidence changes invalidate the Requirement Model.
- Requirement changes invalidate Coverage and Development Plan models.
- Personal-evidence changes invalidate Coverage and Development Plan models.
- Minor textual regeneration must not break stable requirement, workstream, module, or milestone identities.
- Once an execution blueprint exists, plan refreshes must reconcile rather than silently replace linked work.
- Completed tasks create evidence; they do not automatically prove a requirement.
- Coverage changes only when the new evidence meets the category-specific proof policy.

## Edge-case rules

- Broad targets retain multiple role families and separate shared from role-specific requirements.
- Narrow targets avoid unnecessary market breadth.
- A supplied job description overlays job-specific requirements on the broader target model.
- Conflicting sources remain contextual rather than being flattened into one universal claim.
- One-employer requirements remain contextual unless repeated elsewhere.
- Formal gates are separated from developable capabilities.
- Expensive credentials require strong evidence of materiality.
- One output may support several requirements.
- Shared capabilities and evidence are reused across targets.
- Weak research produces provisional requirements and verification, not expensive plans.
- A long plan is grouped and progressively disclosed rather than deleted to satisfy an arbitrary visual cap.

## Definition of quality

A high-quality model is:

- **complete** enough to account for every essential and important requirement
- **MECE** in its primary requirement and workstream structure
- **traceable** from requirement to evidence, coverage, plan, milestone, and later task
- **conservative** where evidence is missing or ambiguous
- **current** where the market changes
- **reusable** across targets where capabilities and evidence overlap
- **low-overload** in the user experience
- **actionable later** without prematurely turning strategy into a task dump
