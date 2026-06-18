import { storage } from "./storage";
import { classifyContact, filterTrackRelevantContacts, generateNetworkGaps } from "./networkStrategy";

function hasContactSignal(contact: { who?: string; targetOrg?: string; targetRole?: string }) {
  return !!((contact.who || "").trim() || (contact.targetOrg || "").trim() || (contact.targetRole || "").trim());
}

export async function refreshNetworkIntelligence() {
  const [tracks, contacts, jobs] = await Promise.all([
    storage.getCareerTracks(),
    storage.getContacts(),
    storage.getJobs(),
  ]);

  const activeTracks = tracks.filter((track) => track.status === "active");
  if (activeTracks.length === 0) return;

  await Promise.all(activeTracks.map(async (track) => {
    try {
      const relevantContacts = filterTrackRelevantContacts(track, contacts);
      const gaps = await generateNetworkGaps(track, relevantContacts);
      if (!gaps.length) return;
      await storage.upsertNetworkGaps(track.id, gaps.map((gap) => ({
        trackId: track.id,
        archetype: gap.archetype,
        priority: gap.priority,
        reason: gap.reason,
        whyItMatters: gap.whyItMatters,
        whatToAsk: gap.whatToAsk,
        suggestedSearches: JSON.stringify(gap.suggestedSearches),
        createdAt: Date.now(),
      })));
    } catch (error) {
      console.error(`network gap refresh skipped for track ${track.id}`, error);
    }
  }));

  const contactsToRefresh = contacts.filter(hasContactSignal);
  await Promise.all(contactsToRefresh.map(async (contact) => {
    try {
      const classifications = await classifyContact(contact, activeTracks, jobs);
      await storage.upsertContactClassifications(contact.id, classifications.map((classification) => ({
        contactId: contact.id,
        trackId: classification.trackId,
        archetype: classification.archetype,
        relevanceScore: classification.relevanceScore,
        accessTypes: JSON.stringify(classification.accessTypes),
        reasoning: classification.reasoning,
        createdAt: Date.now(),
      })));
    } catch (error) {
      console.error(`contact classification refresh skipped for contact ${contact.id}`, error);
    }
  }));
}
