export type NetworkTargetSubdivision = {
  key: string;
  label: string;
  whyItMatters: string;
  suggestedMaterials: string[];
};

export type NetworkTargetMilestone = {
  key: string;
  label: string;
  subdivisionKey: string;
  milestoneType: "content" | "synthesis" | "artifact";
  suggestedTaskTitle: string;
  doneWhen: string;
  scaffolding: string[];
};

export type NetworkTargetStarterPacket = {
  title: string;
  why: string;
  askType: string;
  subdivisions: NetworkTargetSubdivision[];
  milestones: NetworkTargetMilestone[];
};

function normalizeArchetype(value: string) {
  return String(value || "").toLowerCase();
}

function looksOperational(archetype: string, trackName: string) {
  const text = `${archetype} ${trackName}`.toLowerCase();
  return /chief of staff|operations|ops|strategy and ops|operator|delivery|execution/.test(text);
}

function looksPolicy(archetype: string, trackName: string) {
  const text = `${archetype} ${trackName}`.toLowerCase();
  return /policy|governance|regulation|public|government|geopolit|foreign policy/.test(text);
}

function buildsSubdivisions(trackName: string, trackArchetype: string): NetworkTargetSubdivision[] {
  const archetype = normalizeArchetype(trackArchetype);

  if (looksOperational(archetype, trackName)) {
    return [
      {
        key: "near-peer",
        label: `Near-peer chief of staff or strategy-ops operator in ${trackName}`,
        whyItMatters: "A near-peer can tell you what the work is really like, what gets hired for, and whether your background reads as credible.",
        suggestedMaterials: [
          `LinkedIn search: ("chief of staff" OR "strategy and operations") AND "${trackName}"`,
          "Look for people who joined in the last 2-4 years or moved from consulting, investing, or policy-adjacent roles",
        ],
      },
      {
        key: "insider",
        label: `Operator one level above the role in ${trackName}`,
        whyItMatters: "Someone a level above the role can explain how execution, stakeholder management, and decision-making actually work.",
        suggestedMaterials: [
          `Search for directors, heads, or VP-level operators connected to ${trackName}`,
          "Check team pages, org charts, and LinkedIn for who manages this kind of work",
        ],
      },
      {
        key: "connector",
        label: `Connector or recruiter who repeatedly hires for ${trackName}`,
        whyItMatters: "A connector who sees repeat hiring patterns can tell you which backgrounds convert and who is worth knowing.",
        suggestedMaterials: [
          `Search LinkedIn for recruiters, talent partners, or connectors tied to ${trackName}`,
          "Look for alumni, ex-colleagues, or second-degree links who place or hire these roles",
        ],
      },
    ];
  }

  if (looksPolicy(archetype, trackName)) {
    return [
      {
        key: "recent-switcher",
        label: `Recent switcher into ${trackName}`,
        whyItMatters: "A recent switcher can tell you what made their move credible and what they had to learn or reframe.",
        suggestedMaterials: [
          `LinkedIn search: people who recently moved into "${trackName}" from adjacent strategy, policy, or investing backgrounds`,
          "Look for alumni or ex-colleagues who crossed into this space in the last few years",
        ],
      },
      {
        key: "practitioner",
        label: `Practitioner already doing the work in ${trackName}`,
        whyItMatters: "A practitioner can explain the day-to-day decisions, live debates, and what actually matters inside the field.",
        suggestedMaterials: [
          `Search for current advisors, policy leads, researchers, or governance staff tied to ${trackName}`,
          "Check think tanks, public-interest orgs, foundations, regulators, and advisory groups where this work shows up",
        ],
      },
      {
        key: "connector",
        label: `Well-networked connector around ${trackName}`,
        whyItMatters: "A connector can shorten the path to the right conversations and help you avoid random outreach.",
        suggestedMaterials: [
          "Look for alumni, conference speakers, or repeat conveners around this field",
          `Search newsletters, events, and panels where ${trackName} insiders keep appearing`,
        ],
      },
    ];
  }

  return [
    {
      key: "recent-switcher",
      label: `Recent switcher into ${trackName}`,
      whyItMatters: "A recent switcher can tell you what made their move believable and what helped them get traction fastest.",
      suggestedMaterials: [
        `LinkedIn search for people who moved into "${trackName}" from adjacent backgrounds`,
        "Prioritise alumni, ex-colleagues, and second-degree links before cold outreach",
      ],
    },
    {
      key: "insider",
      label: `Current insider doing ${trackName} work`,
      whyItMatters: "A current insider can tell you what the role actually looks like, not just what the posting says.",
      suggestedMaterials: [
        `Search for current team members, managers, or leads tied to ${trackName}`,
        "Check company teams, org pages, and LinkedIn for the people closest to the work",
      ],
    },
    {
      key: "connector",
      label: `Connector or recruiter around ${trackName}`,
      whyItMatters: "A connector can point you to the right people and explain what kinds of profiles actually get pulled in.",
      suggestedMaterials: [
        `Search for recruiters, connectors, or talent partners tied to "${trackName}"`,
        "Look for the people who seem to know many others in this path, not just one company",
      ],
    },
  ];
}

function buildMilestones(trackName: string, primaryKey: string): NetworkTargetMilestone[] {
  return [
    {
      key: "map",
      label: "Map the people landscape",
      subdivisionKey: primaryKey,
      milestoneType: "content",
      suggestedTaskTitle: `Map 5 real people around ${trackName}`,
      doneWhen: "You have 5 real people mapped by name, role, and why they might help.",
      scaffolding: [
        "What titles do people actually use in this path?",
        "Which organisations or backgrounds keep repeating?",
        "Who seems closest to the role shape you want?",
      ],
    },
    {
      key: "pick",
      label: "Pick the best first 2-3 people",
      subdivisionKey: primaryKey,
      milestoneType: "content",
      suggestedTaskTitle: `Pick the best 2-3 first networking targets for ${trackName}`,
      doneWhen: "You have 2-3 people chosen, each with a clear reason and a realistic ask.",
      scaffolding: [
        "Who is most likely to answer?",
        "Who is most likely to give useful reality-checks or access?",
        "Which ask is specific enough to make sense for them?",
      ],
    },
    {
      key: "hook",
      label: "Write your outreach hook",
      subdivisionKey: primaryKey,
      milestoneType: "synthesis",
      suggestedTaskTitle: "Write the specific hook for why you are reaching out",
      doneWhen: "You have one credible reason for reaching out and one bounded ask.",
      scaffolding: [
        "What overlap in background or interest makes this outreach credible?",
        "What exactly do you want from the conversation?",
        "Why this person before anyone else?",
      ],
    },
    {
      key: "message",
      label: "Draft the first message",
      subdivisionKey: primaryKey,
      milestoneType: "artifact",
      suggestedTaskTitle: "Draft the first sendable networking message",
      doneWhen: "You have a short message you could actually send today.",
      scaffolding: [
        "Open with one specific reason you picked them.",
        "Keep the ask bounded and easy to answer.",
        "Make it short enough that it feels sendable, not polished forever.",
      ],
    },
  ];
}

export function networkTargetStarterPacket(
  trackName: string,
  trackArchetype: string,
): NetworkTargetStarterPacket {
  const subdivisions = buildsSubdivisions(trackName, trackArchetype);
  const primary = subdivisions[0];
  return {
    title: primary.label,
    why: primary.whyItMatters,
    askType: "advice",
    subdivisions,
    milestones: buildMilestones(trackName, primary.key),
  };
}
