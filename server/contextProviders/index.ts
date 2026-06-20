import { externalResearchContextProvider } from "./externalResearch";
import { notionContextProvider } from "./notion";
import type { ContextBlock, TaskContextProviderInput } from "./types";

export * from "./types";
export * from "./notion";
export * from "./externalResearch";

export async function collectTaskBreakdownContext(input: TaskContextProviderInput) {
  const userAuthored = await notionContextProvider.collect(input);
  const externalResearch = await externalResearchContextProvider.collect({
    ...input,
    userAuthoredBlocks: userAuthored.blocks,
  });
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
