import type { Task } from "@shared/schema";

export type ProviderName = "user_authored" | "external_research";
export type ProviderStatus = "ok" | "skipped" | "empty" | "rate_limited" | "unavailable" | "error";
export type SourceKind = "job" | "learn" | "hustle" | "contact" | "goal" | "task";

export type ContextBlock = {
  kind: "user_authored" | "external_research";
  priority: "primary" | "supporting";
  label: string;
  text: string;
  sourceTitle?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  sourceDate?: string;
  retrievedAt?: string;
  metadata?: {
    provider?: "notion" | "mock_external_research";
    citationId?: string;
    freshnessSensitive?: boolean;
    query?: string;
  };
};

export type TaskContextProviderResult = {
  provider: ProviderName;
  status: ProviderStatus;
  blocks: ContextBlock[];
  debug?: {
    reason?: string;
    query?: string;
    resultCount?: number;
  };
};

export type TaskContextSourceBundle = {
  sourceContext: string;
  playbook: string;
  sourceKind: SourceKind;
  source: Record<string, unknown> | null;
  parentContext: string;
  cvText?: string;
  jdText?: string;
};

export type TaskContextProviderInput = {
  task: Pick<Task, "title" | "category" | "doneWhen" | "minimumOutcome" | "sourceUrl" | "sourceNote" | "sourceType">;
  sourceBundle: TaskContextSourceBundle;
  userAuthoredContext?: string;
  userAuthoredBlocks?: ContextBlock[];
  mockMode?: "success" | "empty" | "rate_limited" | "unavailable" | "error";
  mockHits?: ExternalResearchHit[];
  now?: number;
};

export interface TaskContextProvider {
  collect(input: TaskContextProviderInput): Promise<TaskContextProviderResult>;
}

export type ExternalResearchIntent =
  | "entity_research"
  | "company_research"
  | "deadline_verification"
  | "eligibility_check"
  | "market_scan"
  | "resource_verification"
  | "none";

export type ExternalResearchQueryPlan = {
  intent: ExternalResearchIntent;
  freshnessSensitive: boolean;
  primary: string;
  fallback?: string;
};

export type ExternalResearchHit = {
  title: string;
  url: string;
  snippet: string;
  date: string;
  source: string;
  retrievedAt: string;
};
