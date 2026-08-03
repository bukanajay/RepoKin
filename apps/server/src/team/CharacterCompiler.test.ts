import { describe, expect, it } from "vite-plus/test";
import { AgentId, type AgentProfile, HumanId } from "@t3tools/contracts/team";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  CLAUDE_AGENT_DRIVER,
  CODEX_DRIVER,
  compileCharacter,
  previewCharacterInstructions,
} from "./CharacterCompiler.ts";

const makeAgent = (overrides: Partial<AgentProfile["character"]> = {}): AgentProfile => ({
  schemaVersion: 1,
  id: AgentId.make("agent_aria"),
  type: "agent",
  name: "Aria",
  owner: HumanId.make("human_julius"),
  character: {
    characterVersion: 1,
    persona: "A direct reviewer who cares about user-visible behavior.",
    expertise: ["React", "Effect"],
    conventions: ["Prefer small additive files.", "Call out verification gaps."],
    communication: {
      verbosity: "normal",
      reportsWith: "findings-first",
    },
    ...overrides,
  },
});

describe("CharacterCompiler", () => {
  it("fills safe mechanical defaults and compiles expressive instructions", () => {
    const compiled = compileCharacter({ agent: makeAgent() });

    expect(compiled.agentId).toBe("agent_aria");
    expect(compiled.characterVersion).toBe(1);
    expect(compiled.mechanics.runtimeMode).toBe("approval-required");
    expect(compiled.mechanics.interactionMode).toBe("default");
    expect(compiled.mechanicalHash).toMatch(/^[a-f0-9]{64}$/);

    const codexInstructions = previewCharacterInstructions({
      compiled,
      driver: CODEX_DRIVER,
    });
    expect(codexInstructions).toContain("<repokin_character>");
    expect(codexInstructions).toContain("Agent identity: Aria (agent_aria).");
    expect(codexInstructions).toContain("Provider driver: Codex.");
    expect(codexInstructions).toContain("Prefer small additive files.");
    expect(codexInstructions).toContain("Runtime mode: approval-required");
  });

  it("renders preview text for each M1 provider decision", () => {
    const compiled = compileCharacter({
      agent: makeAgent({
        provider: {
          driver: ProviderDriverKind.make("claudeAgent"),
          model: "claude-opus-latest",
        },
        runtimeMode: "auto-accept-edits",
        interactionMode: "plan",
        toolPolicy: {
          allow: ["mcp:t3-code/*"],
          deny: ["shell:rm"],
        },
        pathScope: ["apps/web/**"],
      }),
    });

    const claudeInstructions = previewCharacterInstructions({
      compiled,
      driver: CLAUDE_AGENT_DRIVER,
    });

    expect(claudeInstructions).toContain("Provider driver: Claude Code.");
    expect(claudeInstructions).toContain("Runtime mode: auto-accept-edits");
    expect(claudeInstructions).toContain("Interaction mode: plan");
    expect(claudeInstructions).toContain("Preferred model: claude-opus-latest");
    expect(claudeInstructions).toContain("apps/web/**");
    expect(claudeInstructions).toContain("mcp:t3-code/*");
    expect(claudeInstructions).toContain("shell:rm");
  });

  it("keeps the mechanical hash stable across expressive-only edits", () => {
    const first = compileCharacter({ agent: makeAgent({ persona: "First persona." }) });
    const second = compileCharacter({ agent: makeAgent({ persona: "Second persona." }) });

    expect(first.mechanicalHash).toBe(second.mechanicalHash);
  });

  it("changes the mechanical hash when enforced mechanics change", () => {
    const first = compileCharacter({
      agent: makeAgent({
        runtimeMode: "approval-required",
        pathScope: ["docs/**"],
      }),
    });
    const second = compileCharacter({
      agent: makeAgent({
        runtimeMode: "full-access",
        pathScope: ["docs/**"],
      }),
    });
    const third = compileCharacter({
      agent: makeAgent({
        runtimeMode: "approval-required",
        pathScope: ["apps/server/**"],
      }),
    });

    expect(first.mechanicalHash).not.toBe(second.mechanicalHash);
    expect(first.mechanicalHash).not.toBe(third.mechanicalHash);
  });

  it("returns undefined for drivers without expressive support", () => {
    const compiled = compileCharacter({ agent: makeAgent() });
    expect(
      previewCharacterInstructions({
        compiled,
        driver: ProviderDriverKind.make("experimentalDriver"),
      }),
    ).toBeUndefined();
  });
});
