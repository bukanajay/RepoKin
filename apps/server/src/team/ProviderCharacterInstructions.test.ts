import { describe, expect, it } from "vite-plus/test";

import {
  appendAgentforgeCharacterInstructions,
  normalizeAgentforgeCharacterInstructions,
  prependAgentforgePromptText,
} from "./ProviderCharacterInstructions.ts";

describe("ProviderCharacterInstructions", () => {
  it("normalizes blank instruction text away", () => {
    expect(normalizeAgentforgeCharacterInstructions(undefined)).toBeUndefined();
    expect(normalizeAgentforgeCharacterInstructions(" \n ")).toBeUndefined();
    expect(normalizeAgentforgeCharacterInstructions(" <agentforge_character /> ")).toBe(
      "<agentforge_character />",
    );
  });

  it("appends character instructions to provider instruction text", () => {
    expect(appendAgentforgeCharacterInstructions("base\n", " character ")).toBe(
      "base\n\ncharacter",
    );
  });

  it("prepends character instructions while preserving the user prompt boundary", () => {
    expect(prependAgentforgePromptText("  fix it  ", "character")).toBe(
      "character\n\n<user_prompt>\nfix it\n</user_prompt>",
    );
    expect(prependAgentforgePromptText(undefined, "character")).toBe("character");
    expect(prependAgentforgePromptText("  fix it  ", undefined)).toBe("fix it");
  });
});
