import { describe, expect, it } from "@effect/vitest";

import { chooseDelegationModelSlug } from "./TeamDelegationRunReactor.ts";

describe("chooseDelegationModelSlug", () => {
  const models = [
    { slug: "old-model", isLegacy: true },
    { slug: "fast-model" },
    { slug: "smart-model", isDefault: true },
  ];

  it("prefers the agent's declared model when the instance offers it", () => {
    expect(chooseDelegationModelSlug({ preferredModel: "fast-model", models })).toBe("fast-model");
  });

  it("ignores a preferred model the instance does not offer", () => {
    expect(chooseDelegationModelSlug({ preferredModel: "ghost-model", models })).toBe(
      "smart-model",
    );
  });

  it("falls back to the default non-legacy model", () => {
    expect(chooseDelegationModelSlug({ preferredModel: undefined, models })).toBe("smart-model");
  });

  it("falls back to the first non-legacy model when none is marked default", () => {
    expect(
      chooseDelegationModelSlug({
        preferredModel: undefined,
        models: [{ slug: "legacy", isLegacy: true }, { slug: "current" }],
      }),
    ).toBe("current");
  });

  it("returns null when the instance exposes no models", () => {
    expect(chooseDelegationModelSlug({ preferredModel: "x", models: [] })).toBeNull();
  });
});
