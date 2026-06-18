# Anchor Audit Tracker

Last reviewed: 2026-06-18
Source of truth: `origin/master` at commit `c21ecb50e25e89c511ff748b90298e888f38e560`
Commit title: `Auto-trigger intelligence: breakdown, classification, stale recs (#67)`

## 0. Build Health

### Verified
- Live `master` is not fully green.
- TypeScript fails immediately because [`server/vite.ts`](./server/vite.ts) imports `nanoid`, but `package.json` does not declare it.
- A targeted pure-test pass succeeded for planner/LLM/strategy logic:
  - `server/brain.test.ts`
  - `server/llm.test.ts`
  - `server/strategyLogic.test.ts`
- Harness-style tests that boot SQLite are not reliably runnable in this checkout because the local `better-sqlite3` native binding is missing in the worktree node_modules layout.

### Open
- `BH1` Restore green typecheck by adding/fixing the missing `nanoid` dependency or removing the import.
- `BH2` Reconfirm full test health in an environment where the SQLite native binding resolves correctly.

## 1. Code Quality

### Verified
- `CQ1` `@ts-nocheck` is no longer present in `client/` or `server/`.
- `CQ2` LLM model names and retries are centralized in [`server/llm.ts`](./server/llm.ts).
- `CQ3` `GET /api/recommendations` is now read-only; sync moved to `POST /api/recommendations/sync`.
- `CQ4` Career-track CRUD routes exist and are validated through Zod in [`server/routes.ts`](./server/routes.ts).
- `CQ5` Recommendation milestone reads in [`server/planItemEnrichment.ts`](./server/planItemEnrichment.ts) are batched rather than per-item.

### Open
- `CQ6` Recommendation sync still fires unconditionally on mount in [`client/src/hooks/useRecommendations.ts`](./client/src/hooks/useRecommendations.ts), even when nothing is stale.
- `CQ7` There are still multiple strategic logic layers with overlapping explanation systems:
  - planner in [`server/brain.ts`](./server/brain.ts)
  - track diagnostics in [`server/strategy.ts`](./server/strategy.ts)
  - client framing in [`client/src/lib/goalSpine.ts`](./client/src/lib/goalSpine.ts)
- `CQ8` Some text encoding is visibly garbled in checked-in files, which suggests inconsistent file encoding in parts of the repo.

## 2. Product Logic

### Verified
- `PL1` Guided discovery is built:
  - `POST /api/discovery/start`
  - `POST /api/discovery/:id/commit`
- `PL2` Broad parallel pursuit and strongest-next-move planner logic are materially present and covered by pure tests in [`server/brain.test.ts`](./server/brain.test.ts).
- `PL3` Recommendation milestones are durable and can advance Today/plan state through [`server/recommendationMilestoneProgress.ts`](./server/recommendationMilestoneProgress.ts).
- `PL4` Learn completion now creates a win and activity log entry.
- `PL5` Contact-task completion updates `nextFollowUpDate` in [`server/sprint1.ts`](./server/sprint1.ts).

### Open
- `PL6` Networking gap generation still reasons from the full contact book, not the contacts actually relevant to the track. [`server/networkStrategyRoutes.ts`](./server/networkStrategyRoutes.ts) passes all contacts into [`generateNetworkGaps`](./server/networkStrategy.ts), while the prompt describes them as “existing contacts in this track”.
- `PL7` Profile/CV updates still only save text. [`server/profileRoutes.ts`](./server/profileRoutes.ts) does not trigger recommendation sync, stale marking, or network-intelligence refresh.
- `PL8` Job save is still not truly lightweight when a JD is present. [`server/routes.ts`](./server/routes.ts) calls `generateJobPrepArc(job)` on create/update if `jdText` is long enough, which conflicts with the “jobs are consumers of prep, not the main prep container” direction.
- `PL9` Strategy, Today, and Jobs still explain priority from partly different models, so the app can be truthful but not fully consistent about the strongest bottleneck.
- `PL10` Learn and Strategy still stop at passive framing in places:
  - “suggested resources” chips are inventory, not action
  - some recommendations explain what to add, not what to start now

## 3. Data Model

### Verified
- `DM1` Wins now have `sourceEntityType` and `sourceEntityId` in [`shared/schema.ts`](./shared/schema.ts).
- `DM2` Wins surface source labels in [`client/src/pages/views/WinsView.tsx`](./client/src/pages/views/WinsView.tsx).
- `DM3` Learn items carry `prerequisites` and `unlocks`.
- `DM4` Career-track delete cascades/nullification are broader than before, including recommendations, gaps, classifications, and wins.
- `DM5` Recommendation subdivisions and milestones give the app a durable middle layer between suggestions and tasks.

### Open
- `DM6` The graph model exists in `entity_links`, but live master barely uses it. Current usage is essentially cleanup plus `proof_for`, which means most cross-entity reasoning is still inferred rather than stored.
- `DM7` Job/contact support relationships are still mostly implicit:
  - company overlap
  - shared track
  - target role text
  rather than durable `contact_for` or similar link rows.
- `DM8` `warmthScore` on contacts still looks structurally redundant with `relationshipStrength`, `nextFollowUpDate`, and job-side `warmPathScore`.
- `DM9` There is still no generalized persistence model for freshness state across all AI-derived outputs.

## 4. LLM Usage

### Verified
- `LU1` The codebase uses the centralized Responses API wrapper in [`server/llm.ts`](./server/llm.ts).
- `LU2` Many prompts now use `buildUserContext()` and `formatContextForPrompt()`.
- `LU3` User context includes actual CV text, active learning, proof assets, and recent wins.

### Open
- `LU4` The app still carries a hardcoded persona constant in [`server/userPromptProfile.ts`](./server/userPromptProfile.ts).
- `LU5` Older hardcoded background assumptions still leak elsewhere, including [`server/candidates.ts`](./server/candidates.ts).
- `LU6` Task intake is still heuristic-first in [`server/taskIntakeInference.ts`](./server/taskIntakeInference.ts); the LLM is an enrichment pass after a keyword-based default.
- `LU7` There is still no real retrieval layer for learning resources. “Suggested resources” are generated text, not live-fetched or re-ranked sources.

## 5. Prompt Quality and Intelligence

### Verified
- `PQ1` Prompt infrastructure is materially better than a raw output-schema-only approach.
- `PQ2` Contact classification and outreach drafting use richer context than before.
- `PQ3` Discovery and strategy-building flows are more context-aware than a generic career assistant baseline.

### Open
- `PQ4` Hardcoded persona text weakens the truthfulness of “derived from your data” claims.
- `PQ5` Network-gap prompts are fed the wrong contact set for the track, so prompt quality is undermined by bad upstream inputs.
- `PQ6` Some prompts still optimize for nice-sounding suggestions rather than inspectable bottleneck reasoning.

## 6. AI Depth

### Verified
- `AD1` Discovery mode exists and can translate vague concern into a working route and initial tasks.
- `AD2` Network view auto-generates classifications and gap maps on first load.
- `AD3` The planner can already balance live pursuit, networking, and capability-building in parallel in non-trivial cases.

### Open
- `AD4` The app is stronger at generating suggestions than at maintaining one explicit “best next move” thread across views.
- `AD5` Jobs-to-contacts linkage is partly surfaced, but not yet turned into a clear first-class “this person could help this role now” relationship.
- `AD6` Learn suggestions still lack a strong direct-start path from “known gap” to “start this exact first move now” in every case.
- `AD7` The app still does more “helpful advising” than “continuous stateful orchestration” in some surfaces.

## 7. AI Freshness

### Verified
- `AF1` Recommendations already store `contextHash`.
- `AF2` Strategy front door computes a stale accepted-recommendation count by comparing stored `contextHash` with the current context fingerprint.
- `AF3` Recommendation sync can stale accepted system recommendations when sync actually runs and context has drifted.

### Open
- `AF4` CV/profile edits do not automatically trigger recomputation or stale marking.
- `AF5` Recommendation sync on mount is blind; it does not first ask “what is stale?”
- `AF6` Network classifications and gap maps have no equivalent freshness contract.
- `AF7` There is no general TTL/recompute framework shared across recommendations, network intelligence, strategy surfaces, and job-prep derivatives.

## 8. ADHD UX and Information Hierarchy

### Verified
- `UX1` Today is still the strongest execution surface in the app.
- `UX2` Wins and momentum are more visible than in older versions.
- `UX3` Some internal jargon has been cleaned up compared with earlier branches.

### Open
- `UX4` Strategy is still a dense management surface, not yet a decisively prioritised one.
- `UX5` The app still knows more than it acts on. In several places it describes the next move without turning it into the main CTA.
- `UX6` Learn still has passive “suggested resources” presentation where the product promise wants “start here”.
- `UX7` Jobs still hides some useful support context inside secondary warm-path/support panels rather than promoting the most useful contact or support move inline.

## 9. Recommended Build Order

1. `P0` Restore build health: fix the missing `nanoid` dependency/import so live `master` typechecks.
2. `P0` Fix the network-gap truth bug so gap generation only reasons from track-relevant contacts.
3. `P0` Add CV/profile-triggered freshness behavior:
   - mark stale
   - trigger recommendation sync
   - refresh network intelligence where needed
4. `P1` Stop auto-creating job-prep arcs as a default reaction to JD text, or gate that behavior more intelligently.
5. `P1` Unify “strongest bottleneck first” explanation across Strategy, Today, and Jobs.
6. `P1` Make Learn/Strategy recommendations more direct-start and less passive.
7. `P2` Strengthen the data graph so cross-entity relationships are stored, not mostly inferred.
8. `P2` Replace heuristic-first task intake with a more truthful classifier/orchestrator flow.

## 10. Working Summary

The live app is meaningfully better than the early broken state, but it is not at the “all the audit fixes are on master” state yet.

The biggest live-master truths after this review are:
- build health is still red because typecheck is broken
- some genuinely good architecture work is already on master
- several claimed freshness/intelligence fixes are still missing from the actual source of truth
- the most important remaining logic bug is that networking gap reasoning still starts from the wrong contact set

## 11. Current Local Progress

These items are fixed in the active clean worktree on top of `c21ecb5`, committed on branch `codex/p0-build-network-freshness` as `0da1f3e`, but not yet merged back to `master`:

- `BH1` fixed locally: [`server/vite.ts`](./server/vite.ts) no longer depends on undeclared `nanoid`; local typecheck is green.
- `PL6` fixed locally: network gap generation now filters to track-relevant contacts before prompting the LLM.
- `AF4` partially fixed locally: saving the CV now triggers recommendation refresh immediately and network-intelligence refresh in the background.
- `AF5` / `CQ6` fixed locally: recommendation sync on mount now checks a read-only freshness snapshot first instead of always posting.
- `PL8` fixed locally: job-specific prep arcs are no longer triggered by JD text alone; they now only auto-create once the role is in `interviewing`, which matches the existing job-truth model and keeps saved roles lightweight longer.
- `UX5` partially fixed locally: the main explanation surfaces now use plainer, more consistent bottleneck-first wording. Across Strategy, Jobs, Learn, compass surfaces, and broad-pursuit planner copy, the app now prefers `targeted learning item` / `add learning item` over internal-sounding phrases like `learning focus` or `start learning about`.

Local verification for this slice:
- TypeScript: passed
- Targeted pure tests: `54/54` passed
- TypeScript after the wording-alignment slice: passed
- Planner/front-door pure tests after the wording-alignment slice: passed
- Shared next-action consistency slice: passed
  - `client/src/lib/trackNextAction.ts`
  - `client/src/components/home/StrategicNextSteps.tsx`
  - `client/src/pages/views/StrategyView.tsx`
  - `client/src/pages/views/TodayView.tsx`
- Targeted pure tests after the next-action consistency slice: `39/39` passed
- Route-level recommendation tests: still blocked by the known local `better-sqlite3` native-binding issue in harness-backed SQLite tests
- Goal-state harness tests for this slice are also still blocked by the same local `better-sqlite3` native-binding issue
