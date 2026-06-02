import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// TASKS — the atomic unit of work. Carries FULL source context so the brain
// never has to reconstruct meaning from the title alone.
// ─────────────────────────────────────────────────────────────────────────
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  list: text("list").notNull().default("inbox"), // "inbox" | "today"
  block: text("block"), // "morning" | "afternoon" | "evening" | null
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  steps: text("steps").notNull().default("[]"), // JSON [{text,done}]
  sort: integer("sort").notNull().default(0),
  // --- Brain fields (minimum viable decision data) ---
  category: text("category").notNull().default("admin"), // job | substack | interview | health | learning | hustle | afterline | admin
  deadline: text("deadline").notNull().default(""), // YYYY-MM-DD or ""
  size: text("size").notNull().default("medium"), // quick (<15m) | medium (~45m) | deep (2h+)
  status: text("status").notNull().default("not_started"), // not_started | in_progress | stuck | done
  skipped: integer("skipped").notNull().default(0), // avoidance signal
  doneWhen: text("done_when").notNull().default(""), // done condition (P1: every task gets one)
  source: text("source").notNull().default(""), // "" | "coach" (origin marker)
  // --- P1: SOURCE CONTEXT (carry-through so accepted items keep their meaning) ---
  sourceType: text("source_type").notNull().default(""), // task|job|learn|hustle|contact|plan_item
  sourceId: integer("source_id"), // id of the originating job/learn/hustle/contact
  sourceUrl: text("source_url").notNull().default(""), // the real posting / course / profile URL
  sourceNote: text("source_note").notNull().default(""), // context snippet from the source
  sourceStatus: text("source_status").notNull().default(""), // mirror of source object status
  // --- P1: DEPENDENCY / READINESS ---
  relatedTrackId: integer("related_track_id"), // career_tracks.id
  relatedOpportunityId: integer("related_opportunity_id"), // job/learn id this serves
  parentTaskId: integer("parent_task_id"), // for split/child steps
  dependsOn: text("depends_on").notNull().default("[]"), // JSON [taskId,...] must finish first
  blocks: text("blocks").notNull().default("[]"), // JSON [taskId,...] this gates
  blockedBy: text("blocked_by").notNull().default(""), // free text or taskId ref
  blockerReason: text("blocker_reason").notNull().default(""), // why it's stuck
  readiness: text("readiness").notNull().default("ready"), // ready | needs_info | blocked | waiting
  // --- P1: OUTCOMES & ESTIMATES ---
  minimumOutcome: text("minimum_outcome").notNull().default(""), // the MVD-level result
  stretchOutcome: text("stretch_outcome").notNull().default(""),
  estimateMinutes: integer("estimate_minutes"), // null = unknown
  estimateConfidence: text("estimate_confidence").notNull().default(""), // low|med|high
  estimateReason: text("estimate_reason").notNull().default(""),
  actualMinutes: integer("actual_minutes"),
  createdAt: integer("created_at").notNull(),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  start: text("start").notNull().default(""),
  end: text("end").notNull().default(""),
  day: text("day").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────
// JOBS — opportunity pipeline. Bespoke per role (role type / format / eligibility).
// All roles start "wishlist". NEVER fabricate applied/interviewing.
// ─────────────────────────────────────────────────────────────────────────
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  company: text("company").notNull().default(""),
  location: text("location").notNull().default(""),
  url: text("url").notNull().default(""),
  note: text("note").notNull().default(""),
  nextStep: text("next_step").notNull().default(""),
  status: text("status").notNull().default("wishlist"), // wishlist|applied|interviewing|closed
  deadline: text("deadline").notNull().default(""), // YYYY-MM-DD or ""
  flag: text("flag").notNull().default(""), // short caveat chip, e.g. "US visa", "closes 5 Jun"
  // --- P1/P3: scoring + bespoke pipeline ---
  roleArchetype: text("role_archetype").notNull().default(""), // ops|research|advisory|chief_of_staff|policy
  fitScore: integer("fit_score"), // 0-100
  stretchScore: integer("stretch_score"),
  strategicValue: integer("strategic_value"),
  frictionScore: integer("friction_score"),
  eligibilityRisk: text("eligibility_risk").notNull().default(""), // ""|likely_ineligible|visa|citizenship|phd
  warmPathScore: integer("warm_path_score"),
  applicationReadiness: text("application_readiness").notNull().default("none"), // none|cv|cover|questions|sample|referral|submitted|follow_up
  narrativeAngle: text("narrative_angle").notNull().default(""), // why she's credible for it
  relatedTrackId: integer("related_track_id"),
  // --- source freshness ---
  sourceUrl: text("source_url").notNull().default(""),
  sourceType: text("source_type").notNull().default(""), // posting|board|referral
  sourceCheckedAt: integer("source_checked_at"),
  deadlineConfidence: text("deadline_confidence").notNull().default(""), // low|med|high
  applicationWindowStatus: text("application_window_status").notNull().default("open"), // open|rolling|closing|closed
  createdAt: integer("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────
// JOB PIPELINE STEPS (P4.1) — a TASK-GENERATIVE readiness rail over a job.
// NOT a second workflow engine: each step materializes into a task (via the
// existing createNextTask machinery), or is marked done/blocked. taskId is a
// thin back-reference for dedupe; canonical task state still lives on the task.
// ─────────────────────────────────────────────────────────────────────────
export const jobPipelineSteps = sqliteTable("job_pipeline_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  stepLabel: text("step_label").notNull(),
  status: text("status").notNull().default("todo"), // todo|done|skipped|blocked
  sequence: integer("sequence").notNull().default(0),
  note: text("note").notNull().default(""),
  taskId: integer("task_id"), // set when materialized into a task (back-ref/dedupe)
  createdAt: integer("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────
// PROOF ASSET STEPS (P4.3) — a TASK-GENERATIVE proof-production rail over a
// hustle (proof asset). Mirrors jobPipelineSteps EXACTLY (same fields + same
// 4-value status set todo|done|skipped|blocked) so the two step systems stay
// consistent. Each step materializes a task via createNextTask, or is marked
// done/blocked. taskId is a thin back-ref for dedupe; canonical task state
// still lives on the task. Asset KIND is derived (not stored here).
// ─────────────────────────────────────────────────────────────────────────
export const proofAssetSteps = sqliteTable("proof_asset_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hustleId: integer("hustle_id").notNull(),
  stepLabel: text("step_label").notNull(),
  status: text("status").notNull().default("todo"), // todo|done|skipped|blocked
  sequence: integer("sequence").notNull().default(0),
  note: text("note").notNull().default(""),
  taskId: integer("task_id"), // set when materialized into a task (back-ref/dedupe)
  createdAt: integer("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────
// LEARN — capability map. Every item REQUIRES an output.
// ─────────────────────────────────────────────────────────────────────────
export const learn = sqliteTable("learn", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category").notNull().default(""),
  cost: text("cost").notNull().default(""),
  url: text("url").notNull().default(""),
  note: text("note").notNull().default(""),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  // --- P3/P4: capability map ---
  type: text("type").notNull().default("resource"), // course|fellowship|book|podcast|resource|practice
  learnStatus: text("learn_status").notNull().default("open"), // open|watch|active|applied|enrolled|done|closed
  applicationDeadline: text("application_deadline").notNull().default(""),
  programStart: text("program_start").notNull().default(""),
  programEnd: text("program_end").notNull().default(""),
  timeRequired: text("time_required").notNull().default(""),
  capabilityBuilt: text("capability_built").notNull().default(""), // what skill it produces
  requiredOutput: text("required_output").notNull().default(""), // the output that proves it
  prerequisites: text("prerequisites").notNull().default("[]"), // JSON [learnId,...]
  unlocks: text("unlocks").notNull().default("[]"), // JSON [learnId,...]
  relatedTrackId: integer("related_track_id"),
  deadlineConfidence: text("deadline_confidence").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────
// HUSTLES — proof assets (Substack, Afterline, forecasting log, AI-gov memo).
// ─────────────────────────────────────────────────────────────────────────
export const hustles = sqliteTable("hustles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  nextStep: text("next_step").notNull().default(""),
  stage: text("stage").notNull().default("idea"), // idea|testing|earning
  // --- P4: proof asset fields ---
  audience: text("audience").notNull().default(""),
  coreClaim: text("core_claim").notNull().default(""),
  contentPillar: text("content_pillar").notNull().default(""),
  firstPostIdea: text("first_post_idea").notNull().default(""),
  publishingCadence: text("publishing_cadence").notNull().default(""),
  proofAssetForTrack: integer("proof_asset_for_track"), // career_tracks.id
  createdAt: integer("created_at").notNull(),
});

export const wins = sqliteTable("wins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  kind: text("kind").notNull().default("manual"), // manual|planned|spontaneous|coach|source|mvd
  winCategory: text("win_category").notNull().default("mindset"), // job_progress|learning|network|proof_asset|mindset|admin
  createdAt: integer("created_at").notNull(),
});

// CONTACTS — outreach CRM. Describe people BY TYPE; never invent names.
export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default(""), // person's name (user fills in) — never auto-invented
  who: text("who").notNull().default(""), // where they are / who they are
  sector: text("sector").notNull().default(""),
  why: text("why").notNull().default(""),
  status: text("status").notNull().default("to_contact"), // to_contact | messaged | replied
  note: text("note").notNull().default(""),
  // --- P4: CRM fields ---
  relationshipStrength: text("relationship_strength").notNull().default("cold"), // cold|warm|strong
  sourceNetwork: text("source_network").notNull().default(""), // SIPA|Columbia|LSR|ex-TBI|ex-Bain|...
  targetOrg: text("target_org").notNull().default(""),
  targetRole: text("target_role").notNull().default(""),
  askType: text("ask_type").notNull().default(""), // soft|referral|advice|reconnect|follow_up
  messageDraft: text("message_draft").notNull().default(""),
  lastMessage: text("last_message").notNull().default(""),
  nextFollowUpDate: text("next_follow_up_date").notNull().default(""),
  referralPotential: text("referral_potential").notNull().default(""),
  warmthScore: integer("warmth_score"),
  relatedTrackId: integer("related_track_id"),
  createdAt: integer("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────
// CAREER TRACKS — the strategic layer connecting jobs/learning/network/proof.
// ─────────────────────────────────────────────────────────────────────────
export const careerTracks = sqliteTable("career_tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().default(""), // ai-gov-ops | geo-advisory | ...
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  targetRoleArchetype: text("target_role_archetype").notNull().default(""),
  priority: integer("priority").notNull().default(0), // higher = more focus
  status: text("status").notNull().default("active"), // active|watch|paused
  whyItFits: text("why_it_fits").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────
// DAY PLANS — persisted plan (NOT React-only). One per date.
// ─────────────────────────────────────────────────────────────────────────
export const dayPlans = sqliteTable("day_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().default(""), // YYYY-MM-DD
  mode: text("mode").notNull().default("normal"), // normal|low_energy|deadline|admin|overwhelmed|recovery|deep_work|networking|minimum_viable
  energy: text("energy").notNull().default("normal"), // low|normal|high
  status: text("status").notNull().default("active"), // active|done_enough|complete
  minimumViableItemId: integer("minimum_viable_item_id"), // day_plan_items.id — the ONE must-do
  enoughForToday: integer("enough_for_today", { mode: "boolean" }).notNull().default(false),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// DAY PLAN ITEMS — the ordered, time-aware slots that make up a plan.
export const dayPlanItems = sqliteTable("day_plan_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  slot: text("slot").notNull().default("now"), // now|next|later|bonus
  sourceType: text("source_type").notNull().default("task"), // task|job|learn|hustle|contact
  sourceId: integer("source_id"), // id of source object
  taskId: integer("task_id"), // backing task if materialised
  title: text("title").notNull().default(""),
  whySelected: text("why_selected").notNull().default(""), // specific, not generic
  doneWhen: text("done_when").notNull().default(""),
  status: text("status").notNull().default("planned"), // planned|started|completed|skipped|moved|parked
  plannedFor: text("planned_for").notNull().default(""), // YYYY-MM-DD
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  skippedAt: integer("skipped_at"),
  movedAt: integer("moved_at"),
  parkedAt: integer("parked_at"),
  createdAt: integer("created_at").notNull(),
});

// ENTITY LINKS — the graph connecting any two objects.
export const entityLinks = sqliteTable("entity_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromType: text("from_type").notNull(),
  fromId: integer("from_id").notNull(),
  toType: text("to_type").notNull(),
  toId: integer("to_id").notNull(),
  relationType: text("relation_type").notNull(), // supports|unlocks|prerequisite_for|proof_for|contact_for|duplicate_of|child_step_of|blocks
  createdAt: integer("created_at").notNull(),
});

// ACTIVITY LOG — behavioural truth for wins/insights.
export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(), // planned|started|completed|skipped|parked|moved|shrunk|blocked|reopened|deadline_changed|source_refreshed
  sourceType: text("source_type").notNull().default(""),
  sourceId: integer("source_id"),
  taskId: integer("task_id"),
  planItemId: integer("plan_item_id"),
  metadata: text("metadata").notNull().default("{}"), // JSON
  timestamp: integer("timestamp").notNull(),
});

// ── Insert schemas ──────────────────────────────────────────────────────
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true, createdAt: true });
export const insertJobSchema = createInsertSchema(jobs).omit({ id: true, createdAt: true });
export const insertJobPipelineStepSchema = createInsertSchema(jobPipelineSteps).omit({ id: true, createdAt: true });
export const insertLearnSchema = createInsertSchema(learn).omit({ id: true, createdAt: true });
export const insertHustleSchema = createInsertSchema(hustles).omit({ id: true, createdAt: true });
export const insertProofAssetStepSchema = createInsertSchema(proofAssetSteps).omit({ id: true, createdAt: true });
export const insertWinSchema = createInsertSchema(wins).omit({ id: true, createdAt: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });
export const insertCareerTrackSchema = createInsertSchema(careerTracks).omit({ id: true, createdAt: true });
export const insertDayPlanSchema = createInsertSchema(dayPlans).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDayPlanItemSchema = createInsertSchema(dayPlanItems).omit({ id: true, createdAt: true });
export const insertEntityLinkSchema = createInsertSchema(entityLinks).omit({ id: true, createdAt: true });
export const insertActivityLogSchema = createInsertSchema(activityLog).omit({ id: true, timestamp: true });

// ── Types ───────────────────────────────────────────────────────────────
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertJobPipelineStep = z.infer<typeof insertJobPipelineStepSchema>;
export type JobPipelineStep = typeof jobPipelineSteps.$inferSelect;
export type InsertLearn = z.infer<typeof insertLearnSchema>;
export type Learn = typeof learn.$inferSelect;
export type InsertHustle = z.infer<typeof insertHustleSchema>;
export type Hustle = typeof hustles.$inferSelect;
export type InsertProofAssetStep = z.infer<typeof insertProofAssetStepSchema>;
export type ProofAssetStep = typeof proofAssetSteps.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertWin = z.infer<typeof insertWinSchema>;
export type Win = typeof wins.$inferSelect;
export type InsertCareerTrack = z.infer<typeof insertCareerTrackSchema>;
export type CareerTrack = typeof careerTracks.$inferSelect;
export type InsertDayPlan = z.infer<typeof insertDayPlanSchema>;
export type DayPlan = typeof dayPlans.$inferSelect;
export type InsertDayPlanItem = z.infer<typeof insertDayPlanItemSchema>;
export type DayPlanItem = typeof dayPlanItems.$inferSelect;
export type InsertEntityLink = z.infer<typeof insertEntityLinkSchema>;
export type EntityLink = typeof entityLinks.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLog.$inferSelect;
