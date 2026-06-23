import { storage } from "./storage";
import { USER_PROFILE } from "./userPromptProfile";

export const USER_EVIDENCE_CORPUS_VERSION = 1;

export type UserEvidenceSourceType =
  | "cv"
  | "profile_summary"
  | "win"
  | "learning_output"
  | "completed_learning"
  | "proof_asset"
  | "relationship"
  | "interaction";

export type UserEvidenceStrength = "verified" | "direct" | "supporting" | "declared" | "planned";
export type UserEvidenceState = "observed" | "completed" | "published" | "active" | "planned";

export type UserEvidenceItem = {
  id: string;
  sourceType: UserEvidenceSourceType;
  label: string;
  detail: string;
  sourceUrl: string;
  strength: UserEvidenceStrength;
  state: UserEvidenceState;
  usableForCoverage: boolean;
  sourceEntityType: string;
  sourceEntityId: number | null;
  trackIds: number[];
  observedAt: number | null;
};

export type UserEvidenceCorpus = {
  mode: "user_evidence_corpus";
  version: number;
  targetTrackId: number;
  fingerprint: string;
  items: UserEvidenceItem[];
  sourceCounts: Record<UserEvidenceSourceType, number>;
  caveats: string[];
  generatedAt: number;
};

function compact(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalize(value: unknown): string {
  return compact(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[_\p{Pd}]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(prefix: string, ...parts: unknown[]): string {
  const normalized = parts.map(normalize).filter(Boolean).join("|");
  return `${prefix}-${stableHash(normalized || prefix)}`;
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)))];
}

function cvChunks(value: string, maxChars = 1050, maxChunks = 12): string[] {
  const source = String(value || "").trim();
  if (!source) return [];
  const rawLines = source.split(/\n+/).map(compact).filter(Boolean);
  const lines = rawLines.length > 1
    ? rawLines
    : source.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(compact).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = "";
      if (chunks.length >= maxChunks) break;
    }
    current = compact(`${current} ${line}`);
  }
  if (current && chunks.length < maxChunks) chunks.push(current);
  if (!chunks.length) {
    for (let offset = 0; offset < source.length && chunks.length < maxChunks; offset += maxChars) {
      chunks.push(compact(source.slice(offset, offset + maxChars)));
    }
  }
  return chunks.filter(Boolean);
}

function strengthRank(value: UserEvidenceStrength): number {
  if (value === "verified") return 5;
  if (value === "direct") return 4;
  if (value === "declared") return 3;
  if (value === "supporting") return 2;
  return 1;
}

function sourceCounts(items: UserEvidenceItem[]): Record<UserEvidenceSourceType, number> {
  const counts: Record<UserEvidenceSourceType, number> = {
    cv: 0,
    profile_summary: 0,
    win: 0,
    learning_output: 0,
    completed_learning: 0,
    proof_asset: 0,
    relationship: 0,
    interaction: 0,
  };
  for (const item of items) counts[item.sourceType] += 1;
  return counts;
}

function detailForLearn(item: any): string {
  return compact([
    item.title,
    item.capabilityBuilt ? `Capability: ${item.capabilityBuilt}` : "",
    item.requiredOutput ? `Required output: ${item.requiredOutput}` : "",
    item.outputTitle ? `Output: ${item.outputTitle}` : "",
    item.note,
  ].filter(Boolean).join(". "));
}

function detailForHustle(item: any): string {
  return compact([
    item.title,
    item.coreClaim ? `Core claim: ${item.coreClaim}` : "",
    item.audience ? `Audience: ${item.audience}` : "",
    item.firstPostIdea ? `Initial output: ${item.firstPostIdea}` : "",
    item.note,
  ].filter(Boolean).join(". "));
}

export async function buildUserEvidenceCorpus(targetTrackId: number): Promise<UserEvidenceCorpus> {
  const [profile, wins, learns, hustles, contacts] = await Promise.all([
    storage.getProfile(),
    storage.getWins(),
    storage.getLearn(),
    storage.getHustles(),
    storage.getContacts(),
  ]);

  const items: UserEvidenceItem[] = [];
  const cv = String(profile?.cvText || "").trim();
  cvChunks(cv).forEach((detail, index) => {
    items.push({
      id: stableId("user-evidence-cv", detail),
      sourceType: "cv",
      label: `CV evidence ${index + 1}`,
      detail,
      sourceUrl: "",
      strength: "declared",
      state: "observed",
      usableForCoverage: true,
      sourceEntityType: "user_profile",
      sourceEntityId: profile?.id ?? null,
      trackIds: [],
      observedAt: profile?.updatedAt ?? null,
    });
  });

  if (!cv && compact(USER_PROFILE)) {
    items.push({
      id: stableId("user-evidence-profile-summary", USER_PROFILE),
      sourceType: "profile_summary",
      label: "Anchor profile summary",
      detail: compact(USER_PROFILE),
      sourceUrl: "",
      strength: "declared",
      state: "observed",
      usableForCoverage: true,
      sourceEntityType: "profile_summary",
      sourceEntityId: null,
      trackIds: [],
      observedAt: null,
    });
  }

  [...wins]
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
    .slice(0, 16)
    .forEach((win: any) => {
      const detail = compact(`${win.text}${win.takeaway ? `. Takeaway: ${win.takeaway}` : ""}`);
      if (!detail) return;
      items.push({
        id: stableId("user-evidence-win", win.id, detail),
        sourceType: "win",
        label: compact(win.text) || "Recorded outcome",
        detail,
        sourceUrl: "",
        strength: "supporting",
        state: "completed",
        usableForCoverage: true,
        sourceEntityType: compact(win.sourceEntityType || "win"),
        sourceEntityId: Number.isFinite(Number(win.sourceEntityId)) ? Number(win.sourceEntityId) : win.id,
        trackIds: uniqueNumbers([win.trackId]),
        observedAt: Number.isFinite(Number(win.createdAt)) ? Number(win.createdAt) : null,
      });
    });

  learns
    .filter((item: any) => item.done || item.active || compact(item.outputEvidenceUrl) || normalize(item.outputStatus) === "published")
    .slice(0, 18)
    .forEach((item: any) => {
      const hasVerifiedOutput = Boolean(compact(item.outputEvidenceUrl)) || normalize(item.outputStatus) === "published";
      const completed = Boolean(item.done);
      const active = Boolean(item.active);
      const sourceType: UserEvidenceSourceType = hasVerifiedOutput ? "learning_output" : "completed_learning";
      items.push({
        id: stableId("user-evidence-learn", item.id, item.title, item.outputTitle),
        sourceType,
        label: compact(item.outputTitle || item.title) || "Learning evidence",
        detail: detailForLearn(item),
        sourceUrl: compact(item.outputEvidenceUrl || item.url),
        strength: hasVerifiedOutput ? "verified" : completed ? "supporting" : "planned",
        state: hasVerifiedOutput ? "published" : completed ? "completed" : active ? "active" : "planned",
        usableForCoverage: hasVerifiedOutput || completed,
        sourceEntityType: "learn",
        sourceEntityId: item.id,
        trackIds: uniqueNumbers([item.relatedTrackId]),
        observedAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : null,
      });
    });

  hustles
    .filter((item: any) => normalize(item.stage) === "testing" || normalize(item.stage) === "earning")
    .slice(0, 10)
    .forEach((item: any) => {
      const produced = normalize(item.stage) === "earning";
      items.push({
        id: stableId("user-evidence-proof", item.id, item.title),
        sourceType: "proof_asset",
        label: compact(item.title) || "Proof asset",
        detail: detailForHustle(item),
        sourceUrl: "",
        strength: produced ? "supporting" : "planned",
        state: produced ? "observed" : "active",
        usableForCoverage: produced,
        sourceEntityType: "hustle",
        sourceEntityId: item.id,
        trackIds: uniqueNumbers([item.proofAssetForTrack]),
        observedAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : null,
      });
    });

  const contactInteractionGroups = await Promise.all(contacts.slice(0, 60).map(async (contact: any) => ({
    contact,
    interactions: await storage.getContactInteractions(contact.id),
  })));

  for (const { contact, interactions } of contactInteractionGroups) {
    const relationshipStrength = normalize(contact.relationshipStrength);
    const relationshipWarm = ["warm", "strong"].includes(relationshipStrength);
    const hasReply = normalize(contact.status) === "replied";
    const relationshipActive = relationshipWarm || hasReply;
    if (relationshipActive) {
      const label = compact(contact.name || contact.who || contact.targetRole || contact.targetOrg) || "Relevant professional relationship";
      items.push({
        id: stableId("user-evidence-relationship", contact.id, label),
        sourceType: "relationship",
        label,
        detail: compact([
          contact.who,
          contact.targetOrg ? `Organization: ${contact.targetOrg}` : "",
          contact.targetRole ? `Role: ${contact.targetRole}` : "",
          contact.sourceNetwork ? `Source network: ${contact.sourceNetwork}` : "",
          contact.why,
        ].filter(Boolean).join(". ")),
        sourceUrl: compact(contact.linkedinUrl),
        strength: relationshipWarm ? "direct" : "supporting",
        state: "active",
        usableForCoverage: true,
        sourceEntityType: "contact",
        sourceEntityId: contact.id,
        trackIds: uniqueNumbers([contact.relatedTrackId]),
        observedAt: Number.isFinite(Number(contact.createdAt)) ? Number(contact.createdAt) : null,
      });
    }

    [...interactions]
      .sort((left: any, right: any) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, 5)
      .forEach((interaction: any) => {
        const type = normalize(interaction.type);
        if (!["response", "meeting", "intro", "referral", "note"].includes(type)) return;
        const label = compact(`${interaction.type}: ${contact.name || contact.who || contact.targetOrg || "contact"}`);
        items.push({
          id: stableId("user-evidence-interaction", interaction.id, contact.id, interaction.note),
          sourceType: "interaction",
          label,
          detail: compact(interaction.note || `${interaction.type} interaction with ${contact.who || contact.targetOrg || "a relevant contact"}`),
          sourceUrl: compact(contact.linkedinUrl),
          strength: ["meeting", "intro", "referral"].includes(type) ? "direct" : "supporting",
          state: "observed",
          usableForCoverage: true,
          sourceEntityType: "contact_interaction",
          sourceEntityId: interaction.id,
          trackIds: uniqueNumbers([contact.relatedTrackId]),
          observedAt: Number.isFinite(Number(interaction.createdAt)) ? Number(interaction.createdAt) : null,
        });
      });
  }

  const selectedItems = [...items]
    .sort((left, right) => {
      const leftTrack = left.trackIds.includes(targetTrackId) ? 1 : 0;
      const rightTrack = right.trackIds.includes(targetTrackId) ? 1 : 0;
      return rightTrack - leftTrack
        || strengthRank(right.strength) - strengthRank(left.strength)
        || Number(right.observedAt || 0) - Number(left.observedAt || 0);
    })
    .slice(0, 64);

  const counts = sourceCounts(selectedItems);
  const usable = selectedItems.filter((item) => item.usableForCoverage);
  const caveats: string[] = [];
  if (!cv) caveats.push("No CV is stored, so experience, credentials, and transferable skills may be under-evidenced.");
  if (!usable.some((item) => item.strength === "verified")) caveats.push("No inspectable output link was found, so proof-based coverage is conservative.");
  if (!usable.some((item) => item.sourceType === "relationship" || item.sourceType === "interaction")) caveats.push("No active relationship or interaction evidence was found for network and access requirements.");
  if (selectedItems.some((item) => !item.usableForCoverage)) caveats.push("In-progress and planned items are visible to the assessor but are not treated as proven capability.");

  const fingerprintInput = usable
    .map((item) => `${item.id}|${item.strength}|${item.state}|${item.detail}|${item.sourceUrl}`)
    .sort()
    .join("||");

  return {
    mode: "user_evidence_corpus",
    version: USER_EVIDENCE_CORPUS_VERSION,
    targetTrackId,
    fingerprint: stableHash(fingerprintInput || `empty:${targetTrackId}`),
    items: selectedItems,
    sourceCounts: counts,
    caveats,
    generatedAt: Date.now(),
  };
}
