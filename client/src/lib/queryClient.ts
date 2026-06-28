import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
const BACKGROUND_BLOCK_NOTICE_MS = 2_000;
const PROTECTED_MUTATIONS = [
  /^\/api\/plan-items\/\d+\/start$/,
  /^\/api\/tasks\/\d+\/start$/,
  /^\/api\/career-tracks\/\d+\/execution-priority\/materialize$/,
  /^\/api\/work\/(?:confirm|activate)$/,
  /^\/api\/capture\/\d+\/discovery-options\/activate$/,
  /^\/api\/ownership\/strategic-objects\/resolve$/,
  /^\/api\/competence\/development-sprints\/\d+\/approve$/,
  /^\/api\/competence\/development-sprints\/tasks\/\d+\/assess$/,
  /^\/api\/projects\/\d+\/activate-next$/,
  /^\/api\/projects\/\d+\/milestones\/\d+\/complete$/,
];

let lastBlockedBackgroundMutation: { url: string; at: number } | null = null;

function hasExplicitUserIntent(): boolean {
  if (typeof navigator === "undefined") return false;
  const activation = (navigator as Navigator & { userActivation?: { isActive?: boolean } }).userActivation;
  return activation?.isActive === true;
}

function idempotencyKey() {
  const uuid = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `anchor-${uuid}`;
}

function isProtectedMutation(method: string, url: string) {
  return method.toUpperCase() !== "GET" && PROTECTED_MUTATIONS.some((pattern) => pattern.test(url));
}

export class ExplicitUserIntentRequiredError extends Error {
  code = "explicit_user_intent_required";
  url: string;

  constructor(url: string) {
    super("This change needs an explicit user action.");
    this.name = "ExplicitUserIntentRequiredError";
    this.url = url;
  }
}

/**
 * The current Today component still contains a legacy auto-start effect. This
 * marker lets the toast layer suppress only the obsolete error generated when
 * that background request is correctly blocked.
 */
export function consumeBlockedBackgroundMutation(): string | null {
  const blocked = lastBlockedBackgroundMutation;
  if (!blocked || Date.now() - blocked.at > BACKGROUND_BLOCK_NOTICE_MS) return null;
  lastBlockedBackgroundMutation = null;
  return blocked.url;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const upperMethod = method.toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(upperMethod);
  const explicitIntent = mutating && hasExplicitUserIntent();

  if (isProtectedMutation(upperMethod, url) && !explicitIntent) {
    lastBlockedBackgroundMutation = { url, at: Date.now() };
    throw new ExplicitUserIntentRequiredError(url);
  }

  const headers: Record<string, string> = {};
  if (data !== undefined) headers["Content-Type"] = "application/json";
  if (mutating) {
    headers["Idempotency-Key"] = idempotencyKey();
    headers["X-Anchor-User-Intent"] = explicitIntent ? "explicit" : "background";
  }

  const res = await fetch(`${API_BASE}${url}`, {
    method: upperMethod,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
