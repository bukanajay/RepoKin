import { ProviderDriverKind } from "@t3tools/contracts";
import { AgentId, type CompiledCharacterMechanics } from "@t3tools/contracts/team";
import { describe, expect, it } from "vite-plus/test";

import {
  evaluateCharacterTrust,
  readTrustedMechanicalHash,
  summarizeMechanicalSettings,
  trustMechanicalHash,
} from "./CharacterTrust.ts";

describe("CharacterTrust", () => {
  it("evaluates missing, matching, and changed mechanical hashes", () => {
    const agentId = AgentId.make("agent_aria");
    const projectKey = "/workspace/app";
    const trustedMechanics = trustMechanicalHash({
      trustedMechanics: {},
      projectKey,
      agentId,
      mechanicalHash: "hash-1",
    });

    expect(readTrustedMechanicalHash({ trustedMechanics, projectKey, agentId })).toBe("hash-1");
    expect(
      evaluateCharacterTrust({
        trustedMechanics,
        projectKey,
        agentId,
        mechanicalHash: "hash-1",
      }),
    ).toBe("trusted");
    expect(
      evaluateCharacterTrust({
        trustedMechanics,
        projectKey,
        agentId,
        mechanicalHash: "hash-2",
      }),
    ).toBe("changed");
    expect(
      evaluateCharacterTrust({
        trustedMechanics,
        projectKey,
        agentId: AgentId.make("agent_review"),
        mechanicalHash: "hash-1",
      }),
    ).toBe("untrusted");
  });

  it("summarizes mechanical settings in user-facing terms", () => {
    const mechanics: CompiledCharacterMechanics = {
      runtimeMode: "approval-required",
      interactionMode: "plan",
      provider: {
        driver: ProviderDriverKind.make("codex"),
        model: "gpt-5-codex",
      },
      pathScope: ["apps/web/**"],
      toolPolicy: {
        allow: ["shell.read"],
        deny: ["network"],
      },
    };

    expect(summarizeMechanicalSettings(mechanics)).toEqual([
      "Runtime: approval-required",
      "Interaction: plan",
      "Provider: codex / gpt-5-codex",
      "Path scope: apps/web/**",
      "Allowed tools: shell.read",
      "Denied tools: network",
    ]);
  });
});
