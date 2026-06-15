export type JobFormT = {
  title: string;
  company: string;
  location: string;
  url: string;
  note: string;
  nextStep: string;
  deadline: string;
  relatedTrackId: number | null;
  roleArchetype: string;
  narrativeAngle: string;
  sourceType: string;
};

export const EMPTY_JOB_FORM: JobFormT = {
  title: "",
  company: "",
  location: "",
  url: "",
  note: "",
  nextStep: "",
  deadline: "",
  relatedTrackId: null,
  roleArchetype: "",
  narrativeAngle: "",
  sourceType: "posting",
};

export type JobTruthStripT = {
  jobId: number;
  action: "apply" | "warm" | "prove" | "reject" | "clarify" | "prepare" | "follow_up";
  actionLabel: string;
  headline: string;
  nextMove: string;
  reasons: string[];
  risks: string[];
};
