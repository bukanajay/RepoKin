import { describe, expect, it } from "vite-plus/test";

import {
  appendRepokinCharacterInstructions,
  normalizeRepokinCharacterInstructions,
  prependRepokinPromptText,
} from "./ProviderCharacterInstructions.ts";

describe("ProviderCharacterInstructions", () => {
  it("normalizes blank instruction text away", () => {
    expect(normalizeRepokinCharacterInstructions(undefined)).toBeUndefined();
    expect(normalizeRepokinCharacterInstructions(" \n ")).toBeUndefined();
    expect(normalizeRepokinCharacterInstructions(" <repokin_character /> ")).toBe(
      "<repokin_character />",
    );
  });

  it("appends character instructions to provider instruction text", () => {
    expect(appendRepokinCharacterInstructions("base\n", " character ")).toBe("base\n\ncharacter");
  });

  it("prepends character instructions while preserving the user prompt boundary", () => {
    expect(prependRepokinPromptText("  fix it  ", "character")).toBe(
      "character\n\n<user_prompt>\nfix it\n</user_prompt>",
    );
    expect(prependRepokinPromptText(undefined, "character")).toBe("character");
    expect(prependRepokinPromptText("  fix it  ", undefined)).toBe("fix it");
  });
});
