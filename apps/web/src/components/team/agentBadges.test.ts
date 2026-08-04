import { describe, expect, it } from "vite-plus/test";

import type { Character } from "@t3tools/contracts/team";

import { deriveAgentBadges } from "./agentBadges";

const baseCharacter: Character = {
  characterVersion: 1,
};

describe("deriveAgentBadges", () => {
  it("defaults runtime mode to approval-required", () => {
    const badges = deriveAgentBadges(baseCharacter);
    expect(badges).toEqual([{ key: "runtime-mode", label: "Approval required" }]);
  });

  it("renders provider driver and model", () => {
    const badges = deriveAgentBadges({
      ...baseCharacter,
      provider: { driver: "claudeAgent", model: "claude-fable-5" },
    } as Character);
    expect(badges[0]).toEqual({ key: "provider", label: "Claude Code · claude-fable-5" });
  });

  it("summarizes a single path scope inline", () => {
    const badges = deriveAgentBadges({
      ...baseCharacter,
      pathScope: ["apps/web/**"],
    } as Character);
    const scope = badges.find((badge) => badge.key === "path-scope");
    expect(scope?.label).toBe("May edit apps/web/**");
  });

  it("counts multiple path scopes with full detail", () => {
    const badges = deriveAgentBadges({
      ...baseCharacter,
      pathScope: ["apps/web/**", "packages/contracts/**"],
    } as Character);
    const scope = badges.find((badge) => badge.key === "path-scope");
    expect(scope?.label).toBe("May edit 2 path scopes");
    expect(scope?.detail).toContain("packages/contracts/**");
  });

  it("summarizes tool policy allow and deny counts", () => {
    const badges = deriveAgentBadges({
      ...baseCharacter,
      toolPolicy: { allow: ["mcp__git__*", "bash"], deny: ["mcp__slack__*"] },
    } as Character);
    const tools = badges.find((badge) => badge.key === "tool-policy");
    expect(tools?.label).toBe("Tools: 2 allowed / 1 denied");
    expect(tools?.detail).toBe("Allowed: mcp__git__*, bash · Denied: mcp__slack__*");
  });

  it("shows plan mode only when non-default", () => {
    const withPlan = deriveAgentBadges({
      ...baseCharacter,
      interactionMode: "plan",
    } as Character);
    expect(withPlan.some((badge) => badge.key === "interaction-mode")).toBe(true);

    const withDefault = deriveAgentBadges({
      ...baseCharacter,
      interactionMode: "default",
    } as Character);
    expect(withDefault.some((badge) => badge.key === "interaction-mode")).toBe(false);
  });
});
