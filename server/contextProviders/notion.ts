import type { ContextBlock, TaskContextProvider } from "./types";

function clean(value: unknown, max = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildUserAuthoredContextBlocks(context: string): ContextBlock[] {
  const text = clean(context, 500);
  if (!text) return [];
  return [{
    kind: "user_authored",
    priority: "primary",
    label: "User-authored context",
    text,
    metadata: { provider: "notion" },
  }];
}

export const notionContextProvider: TaskContextProvider = {
  async collect(input) {
    return {
      provider: "user_authored",
      status: input.userAuthoredContext?.trim() ? "ok" : "empty",
      blocks: buildUserAuthoredContextBlocks(input.userAuthoredContext || ""),
    };
  },
};
