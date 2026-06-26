import { externalResearchContextProvider } from "./externalResearch";
import { notionContextProvider } from "./notion";
import type { ContextBlock, TaskContextProviderInput } from "./types";

export * from "./types";
export * from "./notion";
export * from "./externalResearch";

const BROAD_RESEARCH_RE = /^(?:please\s+)?(?:research|investigate|look\s+into|find\s+out\s+about|explore|understand)\s+(?:about\s+)?(.+?)\s*$/i;

export function inputForTaskResearch(input: TaskContextProviderInput): TaskContextProviderInput {
  const match = String(input.task.title || "").trim().match(BROAD_RESEARCH_RE);
  if (!match?.[1]) return input;
  const target = String(match[1])
    .replace(/\s+(?:so\s+that|so\s+i\s+can|to\s+help\s+me|in\s+order\s+to)\s+.+$/i, "")
    .replace(/[.?!]+$/g, "")
    .trim();
  if (!target) return input;
  return {
    ...input,
    task: {
      ...input.task,
      // The provider only uses this adapted task to build a public query. The
      // original title remains authoritative everywhere else.
      title: target,
      doneWhen: "Identify the public entity or topic, its current landscape, and the evidence relevant to the task objective",
    },
  };
}

export async function collectTaskBreakdownContext(input: TaskContextProviderInput) {
  const userAuthored = await notionContextProvider.collect(input);
  const researchInput = inputForTaskResearch({
    ...input,
    userAuthoredBlocks: userAuthored.blocks,
  });
  const externalResearch = await externalResearchContextProvider.collect(researchInput);
  return {
    userAuthored,
    externalResearch,
    blocks: {
      userAuthored: userAuthored.blocks,
      externalResearch: externalResearch.blocks,
    },
  };
}

function formatResearchBlock(block: ContextBlock) {
  const citation = [
    block.metadata?.citationId ? `[${block.metadata.citationId}]` : "",
    block.sourceTitle ? `Source: ${block.sourceTitle}` : "",
    block.sourceDomain ? `Domain: ${block.sourceDomain}` : "",
    block.sourceDate ? `Date: ${block.sourceDate}` : "",
  ].filter(Boolean).join(" | ");
  return `${citation}\nSnippet: ${block.text}`;
}

export function formatContextBlocksForPrompt(blocks: {
  userAuthored?: ContextBlock[];
  externalResearch?: ContextBlock[];
}) {
  const sections: string[] = [];
  if (blocks.userAuthored?.length) {
    sections.push(
      "User-authored context (higher priority than external research):\n"
      + blocks.userAuthored.map((block) => `- ${block.text}`).join("\n"),
    );
  }
  if (blocks.externalResearch?.length) {
    sections.push(
      "External public evidence (supporting only; do not treat as the planner):\n"
      + blocks.externalResearch.map((block) => `- ${formatResearchBlock(block)}`).join("\n"),
    );
  }
  return sections.join("\n\n");
}
