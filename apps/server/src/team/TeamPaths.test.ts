import { describe, expect, it } from "vite-plus/test";

import * as TeamPaths from "./TeamPaths.ts";

describe("TeamPaths", () => {
  it("builds absolute and relative .agentforge paths", () => {
    expect(TeamPaths.agentforgeDir("/repo")).toBe("/repo/.agentforge");
    expect(TeamPaths.teamFilePath("/repo")).toBe("/repo/.agentforge/team.json");
    expect(TeamPaths.humansDir("/repo")).toBe("/repo/.agentforge/humans");
    expect(TeamPaths.agentsDir("/repo")).toBe("/repo/.agentforge/agents");
    expect(TeamPaths.humanProfilePath("/repo", "julius")).toBe(
      "/repo/.agentforge/humans/julius.json",
    );
    expect(TeamPaths.agentProfilePath("/repo", "aria")).toBe("/repo/.agentforge/agents/aria.json");
    expect(TeamPaths.teamFilePathRelative()).toBe(".agentforge/team.json");
    expect(TeamPaths.humanProfilePathRelative("julius")).toBe(".agentforge/humans/julius.json");
    expect(TeamPaths.agentProfilePathRelative("aria")).toBe(".agentforge/agents/aria.json");
  });

  it("slugifies human emails from the local-part", () => {
    expect(TeamPaths.slugFromGitEmail("julius@example.com")).toBe("julius");
    expect(TeamPaths.slugFromGitEmail("  Jane.Doe+dev@example.com  ")).toBe("jane-doe-dev");
    expect(TeamPaths.slugFromGitEmail("")).toBeNull();
  });

  it("slugifies agent names", () => {
    expect(TeamPaths.slugFromAgentName("Aria")).toBe("aria");
    expect(TeamPaths.slugFromAgentName("Code Reviewer")).toBe("code-reviewer");
    expect(TeamPaths.slugFromAgentName("  ")).toBeNull();
  });

  it("prefixes non-letter stems so they remain valid member slugs", () => {
    expect(TeamPaths.slugifyMemberStem("42-bot")).toBe("m-42-bot");
    expect(TeamPaths.isValidMemberSlug("m-42-bot")).toBe(true);
  });

  it("disambiguates colliding slugs", () => {
    const existing = new Set(["aria", "aria-2"]);
    expect(TeamPaths.disambiguateSlug("aria", existing)).toBe("aria-3");
    expect(TeamPaths.disambiguateSlug("bruno", existing)).toBe("bruno");
  });

  it("parses profile slugs from filenames", () => {
    expect(TeamPaths.profileSlugFromFileName("aria.json")).toBe("aria");
    expect(TeamPaths.profileSlugFromFileName("not valid.json")).toBeNull();
  });
});
