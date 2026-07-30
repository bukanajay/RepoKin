import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceId,
} from "./providerInstance.ts";
import {
  AgentId,
  AgentProfile,
  Character,
  CompiledCharacter,
  HumanId,
  HumanProfile,
  MemberId,
  TeamFile,
  TeamRosterReadModel,
  isAgentId,
  isHumanId,
  isMemberId,
} from "./team.ts";

const decodeAgent = Schema.decodeUnknownSync(AgentProfile);
const encodeAgent = Schema.encodeUnknownSync(AgentProfile);
const decodeHuman = Schema.decodeUnknownSync(HumanProfile);
const encodeHuman = Schema.encodeUnknownSync(HumanProfile);
const decodeCharacter = Schema.decodeUnknownSync(Character);
const encodeCharacter = Schema.encodeUnknownSync(Character);
const decodeTeamFile = Schema.decodeUnknownSync(TeamFile);
const encodeTeamFile = Schema.encodeUnknownSync(TeamFile);
const decodeCompiled = Schema.decodeUnknownSync(CompiledCharacter);
const decodeRoster = Schema.decodeUnknownSync(TeamRosterReadModel);
const decodeProviderInstanceConfig = Schema.decodeUnknownSync(ProviderInstanceConfig);
const encodeProviderInstanceConfig = Schema.encodeUnknownSync(ProviderInstanceConfig);

const ariaCharacter = {
  characterVersion: 1 as const,
  persona: "Direct, allergic to speculative abstraction.",
  expertise: ["typescript", "effect", "accessibility"],
  conventions: ["prefers inferred types", "tests alongside source"],
  communication: { verbosity: "terse" as const, reportsWith: "diff-first" },
  provider: { driver: "claudeAgent", model: "claude-sonnet-4-5" },
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  toolPolicy: {
    allow: ["fs.read", "fs.write", "git.read"],
    deny: ["net.*"],
  },
  pathScope: ["apps/web/**", "packages/client-runtime/**"],
};

const ariaProfile = {
  $schema: "https://agentforge.dev/schema/agent.json",
  schemaVersion: 1 as const,
  id: "agent_aria",
  type: "agent" as const,
  name: "Aria",
  owner: "human_julius",
  homeEnvironment: "env_9f3a",
  avatar: { accentColor: "#7C5CFF" },
  character: ariaCharacter,
  createdAt: "2026-07-30T12:00:00.000Z",
  updatedAt: "2026-07-30T12:00:00.000Z",
};

const juliusProfile = {
  $schema: "https://agentforge.dev/schema/human.json",
  schemaVersion: 1 as const,
  id: "human_julius",
  type: "human" as const,
  displayName: "Julius",
  gitEmails: ["julius@example.com"],
  environments: [
    {
      environmentId: "env_9f3a",
      label: "julius-mbp",
      publicKey: "pk_test_not_a_secret",
    },
  ],
};

describe("member id slugs", () => {
  const cases = [
    { name: "MemberId", decode: Schema.decodeUnknownSync(MemberId), is: isMemberId },
    { name: "AgentId", decode: Schema.decodeUnknownSync(AgentId), is: isAgentId },
    { name: "HumanId", decode: Schema.decodeUnknownSync(HumanId), is: isHumanId },
  ] as const;

  for (const { name, decode, is } of cases) {
    describe(name, () => {
      it.each(["agent_aria", "human_julius", "Aria", "a", "codex_work"])("accepts %s", (id) => {
        expect(decode(id)).toBe(id);
        expect(is(id)).toBe(true);
      });

      it.each([
        ["empty", ""],
        ["leading digit", "1agent"],
        ["leading dash", "-aria"],
        ["dot", "agent.aria"],
        ["space", "agent aria"],
      ])("rejects %s", (_label, value) => {
        expect(() => decode(value)).toThrow();
        expect(is(value)).toBe(false);
      });
    });
  }
});

describe("Character", () => {
  it("decodes a full character with both halves", () => {
    const decoded = decodeCharacter(ariaCharacter);
    expect(decoded.characterVersion).toBe(1);
    expect(decoded.persona).toBe("Direct, allergic to speculative abstraction.");
    expect(decoded.provider?.driver).toBe("claudeAgent");
    expect(decoded.runtimeMode).toBe("approval-required");
    expect(decoded.pathScope).toEqual(["apps/web/**", "packages/client-runtime/**"]);
  });

  it("trims expressive and mechanical string fields", () => {
    const decoded = decodeCharacter({
      characterVersion: 1,
      persona: "  terse reviewer  ",
      expertise: ["  typescript  "],
      provider: { driver: "  codex  ", model: "  gpt-5  " },
      pathScope: ["  apps/web/**  "],
    });
    expect(decoded.persona).toBe("terse reviewer");
    expect(decoded.expertise).toEqual(["typescript"]);
    expect(decoded.provider).toEqual({ driver: "codex", model: "gpt-5" });
    expect(decoded.pathScope).toEqual(["apps/web/**"]);
  });

  it("preserves unknown fields on decode → encode (forward compatibility)", () => {
    const input = {
      characterVersion: 1 as const,
      persona: "hello",
      futureExpressiveField: { nested: true },
      futureMechanicalFlag: "on",
    };
    const decoded = decodeCharacter(input);
    const encoded = encodeCharacter(decoded);
    expect(encoded).toMatchObject({
      characterVersion: 1,
      persona: "hello",
      futureExpressiveField: { nested: true },
      futureMechanicalFlag: "on",
    });
  });
});

describe("AgentProfile", () => {
  it("decodes the illustrative Aria profile", () => {
    const decoded = decodeAgent(ariaProfile);
    expect(decoded.id).toBe("agent_aria");
    expect(decoded.name).toBe("Aria");
    expect(decoded.owner).toBe("human_julius");
    expect(decoded.character.provider?.driver).toBe("claudeAgent");
  });

  it("trims top-level identity fields", () => {
    const decoded = decodeAgent({
      ...ariaProfile,
      id: "  agent_aria  ",
      name: "  Aria  ",
      owner: "  human_julius  ",
    });
    expect(decoded.id).toBe("agent_aria");
    expect(decoded.name).toBe("Aria");
    expect(decoded.owner).toBe("human_julius");
  });

  it("preserves unknown fields on decode → encode", () => {
    const input = {
      ...ariaProfile,
      futureProfileField: "keep-me",
      character: {
        ...ariaCharacter,
        futureCharField: 42,
      },
    };
    const encoded = encodeAgent(decodeAgent(input));
    expect(encoded).toMatchObject({
      futureProfileField: "keep-me",
      character: expect.objectContaining({ futureCharField: 42 }),
    });
  });

  it("rejects a profile with the wrong type discriminator", () => {
    expect(() =>
      decodeAgent({
        ...ariaProfile,
        type: "human",
      }),
    ).toThrow();
  });
});

describe("HumanProfile", () => {
  it("decodes the illustrative Julius profile", () => {
    const decoded = decodeHuman(juliusProfile);
    expect(decoded.id).toBe("human_julius");
    expect(decoded.gitEmails).toEqual(["julius@example.com"]);
    expect(decoded.environments?.[0]?.publicKey).toBe("pk_test_not_a_secret");
  });

  it("preserves unknown fields on decode → encode", () => {
    const encoded = encodeHuman(
      decodeHuman({
        ...juliusProfile,
        futureHumanField: ["a"],
      }),
    );
    expect(encoded).toMatchObject({ futureHumanField: ["a"] });
  });
});

describe("TeamFile", () => {
  it("decodes a minimal team file", () => {
    expect(decodeTeamFile({ schemaVersion: 1 })).toEqual({ schemaVersion: 1 });
  });

  it("preserves unknown fields on decode → encode", () => {
    const encoded = encodeTeamFile(
      decodeTeamFile({
        schemaVersion: 1,
        teamRemote: "origin",
        futureTeamSetting: true,
      }),
    );
    expect(encoded).toMatchObject({
      schemaVersion: 1,
      teamRemote: "origin",
      futureTeamSetting: true,
    });
  });
});

describe("CompiledCharacter", () => {
  it("decodes compiler output with safe mechanical defaults", () => {
    const decoded = decodeCompiled({
      agentId: "agent_aria",
      characterVersion: 1,
      instructionsByDriver: {
        claudeAgent: "You are Aria...",
        codex: "You are Aria...",
      },
      mechanics: {},
      mechanicalHash: "sha256:abc",
    });
    expect(decoded.mechanics.runtimeMode).toBe("approval-required");
    expect(decoded.mechanics.interactionMode).toBe("default");
    expect(decoded.instructionsByDriver[ProviderDriverKind.make("claudeAgent")]).toContain("Aria");
  });
});

describe("TeamRosterReadModel", () => {
  it("decodes a roster with warnings defaulting to empty", () => {
    const decoded = decodeRoster({
      team: { schemaVersion: 1 },
      humans: [juliusProfile],
      agents: [ariaProfile],
    });
    expect(decoded.humans).toHaveLength(1);
    expect(decoded.agents).toHaveLength(1);
    expect(decoded.warnings).toEqual([]);
  });
});

describe("secret exclusion invariant", () => {
  /**
   * Provider credentials live only on ProviderInstanceConfig (environment-local).
   * Agent/human profiles must not carry them: encoding a profile built from
   * team contracts never embeds a sensitive provider env value.
   */
  it("agent profile serialization cannot embed provider instance secrets", () => {
    const secret = "sk-super-secret-never-in-git";
    const providerConfig = decodeProviderInstanceConfig({
      driver: "codex",
      environment: [
        { name: "OPENAI_API_KEY", value: secret, sensitive: true },
        { name: "CODEX_API_KEY", value: secret, sensitive: true },
      ],
      config: { agentforge: { note: "bindings stay local" } },
    });

    // Round-trip the provider config to prove the secret is present there.
    const providerJson = JSON.stringify(encodeProviderInstanceConfig(providerConfig));
    expect(providerJson).toContain(secret);

    // A valid agent profile has no field that accepts environment / secrets.
    const profile = decodeAgent(ariaProfile);
    const profileJson = JSON.stringify(encodeAgent(profile));

    expect(profileJson).not.toContain(secret);
    expect(profileJson).not.toContain("OPENAI_API_KEY");
    expect(profileJson).not.toContain("sensitive");
    expect(profileJson).not.toMatch(/"environment"\s*:/);

    // Structural: AgentProfile keys (encoded) exclude secret carriers.
    const encodedKeys = Object.keys(encodeAgent(profile));
    expect(encodedKeys).not.toContain("environment");
    expect(encodedKeys).not.toContain("apiKey");
    expect(encodedKeys).not.toContain("token");
    expect(encodedKeys).not.toContain("secrets");
    expect(encodedKeys).not.toContain("providerInstance");
    expect(encodedKeys).not.toContain("config");
  });

  it("character has no field that can hold a ProviderInstanceConfig envelope", () => {
    const secret = "sk-another-secret";
    const character = decodeCharacter({
      characterVersion: 1,
      // Only driver + model preference — never credentials.
      provider: { driver: ProviderDriverKind.make("codex"), model: "gpt-5" },
    });
    const json = JSON.stringify(encodeCharacter(character));
    expect(json).not.toContain(secret);
    expect(json).not.toMatch(/"environment"\s*:/);
    expect(json).not.toMatch(/"sensitive"\s*:/);
  });
});

describe("ProviderInstanceId brand reuse in team bindings", () => {
  it("accepts the same slug rules as provider instances", () => {
    expect(ProviderInstanceId.make("codex_work")).toBe("codex_work");
  });
});
