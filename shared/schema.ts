import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  doneWhen: text("done_when").notNull().default(""), // optional done condition
  source: text("source").notNull().default(""), // "" | "coach" (origin marker)
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
  createdAt: integer("created_at").notNull(),
});

export const learn = sqliteTable("learn", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category").notNull().default(""),
  cost: text("cost").notNull().default(""),
  url: text("url").notNull().default(""),
  note: text("note").notNull().default(""),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const hustles = sqliteTable("hustles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  nextStep: text("next_step").notNull().default(""),
  stage: text("stage").notNull().default("idea"), // idea|testing|earning
  createdAt: integer("created_at").notNull(),
});

export const wins = sqliteTable("wins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

// CONTACTS - the networking / outreach pipeline. Tied to target roles & sectors.
export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default(""), // person's name (user fills in)
  who: text("who").notNull().default(""), // where they are / who they are, e.g. "ex-Bain, now at GovAI"
  sector: text("sector").notNull().default(""), // AI governance | think tank | advisory | etc
  why: text("why").notNull().default(""), // why reach them (the strategic reason)
  status: text("status").notNull().default("to_contact"), // to_contact | messaged | replied
  note: text("note").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true, createdAt: true });
export const insertJobSchema = createInsertSchema(jobs).omit({ id: true, createdAt: true });
export const insertLearnSchema = createInsertSchema(learn).omit({ id: true, createdAt: true });
export const insertHustleSchema = createInsertSchema(hustles).omit({ id: true, createdAt: true });
export const insertWinSchema = createInsertSchema(wins).omit({ id: true, createdAt: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertLearn = z.infer<typeof insertLearnSchema>;
export type Learn = typeof learn.$inferSelect;
export type InsertHustle = z.infer<typeof insertHustleSchema>;
export type Hustle = typeof hustles.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertWin = z.infer<typeof insertWinSchema>;
export type Win = typeof wins.$inferSelect;
