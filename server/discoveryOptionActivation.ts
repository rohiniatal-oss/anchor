import type { Task } from "@shared/schema";
import { storage } from "./storage";
import type { RankedDiscoveryOption } from "./discoveryOptions";

export type DiscoveryActivationType = "job" | "contact" | "learn" | "proof" | "task";

export type DiscoveryOptionActivationResult = {
  activationType: DiscoveryActivationType;
  reused: boolean;
  object: unknown;
  task?: Task | null;
};

const ACTIVATION_TYPES = new Set<DiscoveryActivationType>(["job", "contact", "learn", "proof", "task"]);

function compact(value: unknown, max = 500) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function normalize(value: unknown) {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function title(value: unknown, fallback = "Discovery option") {
  return compact(value, 180) || fallback;
}

function sourceDomain(option: RankedDiscoveryOption) {
  return compact(option.sourceDomain || (() => {
    try {
      return new URL(option.sourceUrl || "").hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })(), 120);
}

function noteFor(option: RankedDiscoveryOption) {
  return [
    option.whyRelevant ? `Why relevant: ${option.whyRelevant}` : "",
    option.nextAction ? `Next action: ${option.nextAction}` : "",
    option.sourceTitle ? `Source: ${option.sourceTitle}` : "",
    option.sourceDomain ? `Domain: ${option.sourceDomain}` : "",
  ].filter(Boolean).join("\n");
}

function defaultActivationType(kind: RankedDiscoveryOption["kind"]): DiscoveryActivationType {
  if (kind === "role") return "job";
  if (kind === "person") return "contact";
  if (kind === "learning" || kind === "resource") return "learn";
  if (kind === "proof") return "proof";
  return "task";
}

function activationTypeFor(value: unknown, option: RankedDiscoveryOption): DiscoveryActivationType {
  if (value == null || value === "") return defaultActivationType(option.kind);
  if (ACTIVATION_TYPES.has(value as DiscoveryActivationType)) return value as DiscoveryActivationType;
  throw new Error("Unsupported discovery activation type");
}

function categoryFor(kind: RankedDiscoveryOption["kind"]) {
  if (kind === "role") return "job";
  if (kind === "learning" || kind === "resource") return "learning";
  if (kind === "proof") return "substack";
  if (kind === "person" || kind === "organization") return "admin";
  return "thinking";
}

function optionPayload(option: RankedDiscoveryOption) {
  return JSON.stringify({
    rank: option.rank,
    kind: option.kind,
    title: option.title,
    sourceTitle: option.sourceTitle,
    sourceUrl: option.sourceUrl || "",
    sourceDomain: option.sourceDomain || "",
    confidence: option.confidence,
  });
}

async function captureTask(captureId: number) {
  return (await storage.getTasks()).find((task) => task.id === captureId) || null;
}

async function activateJob(capture: Task, option: RankedDiscoveryOption) {
  const jobs = await storage.getJobs();
  const existing = jobs.find((job) => {
    const sourceMatch = option.sourceUrl && [job.url, job.sourceUrl].some((url) => normalize(url) === normalize(option.sourceUrl));
    return sourceMatch
      || normalize(`${job.title} ${job.company}`) === normalize(`${option.title} ${sourceDomain(option)}`)
      || normalize(job.title) === normalize(option.title);
  });
  if (existing) return { activationType: "job" as const, reused: true, object: existing, task: null };
  const job = await storage.createJob({
    title: title(option.title, "Discovered role signal"),
    company: sourceDomain(option),
    url: option.sourceUrl || "",
    note: noteFor(option),
    nextStep: "Verify this is a real current opportunity before treating it as an application target.",
    status: "wishlist",
    roleArchetype: capture.title,
    relatedTrackId: capture.relatedTrackId ?? undefined,
    sourceUrl: option.sourceUrl || "",
    sourceType: "discovery_option",
    sourceCheckedAt: Date.now(),
    applicationWindowStatus: option.sourceUrl ? "open" : "rolling",
    deadlineConfidence: "low",
    roleModel: optionPayload(option),
  } as any);
  return { activationType: "job" as const, reused: false, object: job, task: null };
}

async function activateContact(capture: Task, option: RankedDiscoveryOption) {
  const contacts = await storage.getContacts();
  const existing = contacts.find((contact) => normalize(contact.who || contact.name) === normalize(option.title));
  if (existing) return { activationType: "contact" as const, reused: true, object: existing, task: null };
  const contact = await storage.createContact({
    name: "",
    who: title(option.title, "Discovered person or network signal"),
    why: option.whyRelevant || `Discovery result from ${capture.title}`,
    status: "to_contact",
    relationshipStrength: "cold",
    askType: "advice",
    note: noteFor(option),
    targetRole: capture.title,
    sourceNetwork: sourceDomain(option),
    relatedTrackId: capture.relatedTrackId ?? undefined,
    linkedinUrl: option.sourceUrl || "",
  } as any);
  return { activationType: "contact" as const, reused: false, object: contact, task: null };
}

async function activateLearn(capture: Task, option: RankedDiscoveryOption) {
  const learnItems = await storage.getLearn();
  const existing = learnItems.find((item) => {
    const sourceMatch = option.sourceUrl && normalize(item.url) === normalize(option.sourceUrl);
    return sourceMatch || normalize(item.title) === normalize(option.title);
  });
  if (existing) return { activationType: "learn" as const, reused: true, object: existing, task: null };
  const learn = await storage.createLearn({
    title: title(option.title, "Discovered learning option"),
    type: option.kind === "learning" ? "course" : "resource",
    learnStatus: "open",
    url: option.sourceUrl || "",
    note: noteFor(option),
    capabilityBuilt: capture.title,
    requiredOutput: "A short note deciding whether this discovery result is worth using.",
    relatedTrackId: capture.relatedTrackId ?? undefined,
    sourceType: "discovery_option",
    sourceId: capture.id,
    proofIntent: false,
  } as any);
  return { activationType: "learn" as const, reused: false, object: learn, task: null };
}

async function activateProof(capture: Task, option: RankedDiscoveryOption) {
  const hustles = await storage.getHustles();
  const existing = hustles.find((hustle) => normalize(hustle.title) === normalize(option.title));
  if (existing) return { activationType: "proof" as const, reused: true, object: existing, task: null };
  const hustle = await storage.createHustle({
    title: title(option.title, "Discovered proof asset idea"),
    note: noteFor(option),
    nextStep: "Extract the structure and outline an original proof asset before committing to build it.",
    stage: "idea",
    proofAssetForTrack: capture.relatedTrackId ?? undefined,
  } as any);
  return { activationType: "proof" as const, reused: false, object: hustle, task: null };
}

async function activateTask(capture: Task, option: RankedDiscoveryOption) {
  const tasks = await storage.getTasks();
  const existing = tasks.find((task) =>
    task.sourceType === "discovery_option"
    && task.sourceId === capture.id
    && normalize(task.title).includes(normalize(option.title).slice(0, 80))
    && !task.done,
  );
  if (existing) return { activationType: "task" as const, reused: true, object: existing, task: existing };
  const task = await storage.createTask({
    title: `Assess ${title(option.title, "discovery option")}`,
    list: "inbox",
    done: false,
    category: categoryFor(option.kind),
    size: "medium",
    status: "not_started",
    doneWhen: "A pursue, save, contact, learn, build, monitor, or stop decision is recorded for this discovery option.",
    minimumOutcome: "One decision about the discovery option and the evidence behind it.",
    steps: JSON.stringify([
      { text: option.sourceUrl ? "Open the source link" : "Open the saved evidence note", done: false },
      { text: "Write the one fact that changes the decision", done: false },
      { text: "Choose save, contact, learn, build, monitor, or stop", done: false },
    ]),
    estimateMinutes: 25,
    estimateConfidence: "medium",
    estimateReason: "discovery_option_activation",
    readiness: "ready",
    sourceType: "discovery_option",
    sourceId: capture.id,
    sourceUrl: option.sourceUrl || "",
    sourceNote: noteFor(option),
    sourceStatus: "activated",
    relatedTrackId: capture.relatedTrackId ?? undefined,
  } as any);
  return { activationType: "task" as const, reused: false, object: task, task };
}

export async function activateDiscoveryOption(input: {
  captureId: number;
  option?: RankedDiscoveryOption;
  activationType?: DiscoveryActivationType;
}): Promise<DiscoveryOptionActivationResult | null> {
  const capture = await captureTask(input.captureId);
  if (!capture) return null;
  const option = input.option;
  if (!option?.title) throw new Error("A ranked discovery option is required");
  const activationType = activationTypeFor(input.activationType, option);

  let result: DiscoveryOptionActivationResult;
  if (activationType === "job") result = await activateJob(capture, option);
  else if (activationType === "contact") result = await activateContact(capture, option);
  else if (activationType === "learn") result = await activateLearn(capture, option);
  else if (activationType === "proof") result = await activateProof(capture, option);
  else result = await activateTask(capture, option);

  await storage.updateTask(capture.id, {
    sourceStatus: "discovery_option_activated",
    sourceNote: [capture.sourceNote, `Activated discovery option as ${result.activationType}: ${option.title}`].filter(Boolean).join("\n"),
    pinned: false,
  } as any);
  await storage.logActivity({
    eventType: "discovery_option_activated",
    sourceType: "task",
    sourceId: capture.id,
    taskId: result.task?.id,
    metadata: JSON.stringify({ activationType: result.activationType, reused: result.reused, option: optionPayload(option), explicit: true }),
  } as any);
  return result;
}
