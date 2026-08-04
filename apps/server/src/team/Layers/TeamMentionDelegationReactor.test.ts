import { describe, expect, it } from "@effect/vitest";

import { deriveTaskTitle, extractMentionedAgentIds } from "./TeamMentionDelegationReactor.ts";

describe("extractMentionedAgentIds", () => {
  const agentIds = ["agent_aria", "agent_kilo"];

  it("finds agent mentions and ignores unknown or human handles", () => {
    const result = extractMentionedAgentIds({
      text: "hey @agent_aria and @human_ajay, also @agent_ghost — can you look?",
      agentIds,
    });
    expect(result).toEqual(["agent_aria"]);
  });

  it("de-duplicates repeated mentions of the same agent", () => {
    const result = extractMentionedAgentIds({
      text: "@agent_aria @agent_aria please and @agent_kilo too",
      agentIds,
    });
    expect(result).toEqual(["agent_aria", "agent_kilo"]);
  });

  it("returns nothing when there are no mentions", () => {
    expect(extractMentionedAgentIds({ text: "no mentions here", agentIds })).toEqual([]);
  });
});

describe("deriveTaskTitle", () => {
  it("uses the first line with mentions stripped", () => {
    expect(deriveTaskTitle("@agent_aria please fix the login redirect\nmore detail")).toBe(
      "please fix the login redirect",
    );
  });

  it("falls back when the first line is only a mention", () => {
    expect(deriveTaskTitle("@agent_aria")).toBe("Delegated task");
  });

  it("truncates a long title", () => {
    const title = deriveTaskTitle("a".repeat(200));
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });
});
