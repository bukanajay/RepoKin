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
  ChannelDeclaration,
  ChannelId,
  CompiledCharacter,
  HumanId,
  HumanProfile,
  MemberId,
  TeamBoardReadModel,
  TeamChannelCommand,
  TeamChannelEvent,
  TeamChannelViewReadModel,
  TeamCommand,
  TeamDomainReadModel,
  TeamEvent,
  TeamAgentUpsertResult,
  TeamInstructionPreviewResult,
  TeamFile,
  TeamFileUpdateInput,
  TeamPostContent,
  TeamRosterSyncResult,
  TeamRosterReadModel,
  TeamSignedMessageEnvelope,
  TeamSignedMessageProofPayload,
  TeamTaskCommand,
  TeamTaskEvent,
  isChannelId,
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
const decodeTeamFileUpdateInput = Schema.decodeUnknownSync(TeamFileUpdateInput);
const decodeTeamRosterSyncResult = Schema.decodeUnknownSync(TeamRosterSyncResult);
const decodeTeamSignedMessageEnvelope = Schema.decodeUnknownSync(TeamSignedMessageEnvelope);
const decodeTeamSignedMessageProofPayload = Schema.decodeUnknownSync(TeamSignedMessageProofPayload);
const decodeCompiled = Schema.decodeUnknownSync(CompiledCharacter);
const decodeAgentUpsertResult = Schema.decodeUnknownSync(TeamAgentUpsertResult);
const decodeInstructionPreview = Schema.decodeUnknownSync(TeamInstructionPreviewResult);
const decodeRoster = Schema.decodeUnknownSync(TeamRosterReadModel);
const decodeTeamCommand = Schema.decodeUnknownSync(TeamCommand);
const decodeTeamEvent = Schema.decodeUnknownSync(TeamEvent);
const decodeTeamDomainReadModel = Schema.decodeUnknownSync(TeamDomainReadModel);
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
  $schema: "https://repokin.dev/schema/agent.json",
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
  $schema: "https://repokin.dev/schema/human.json",
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

  it("decodes M3 roster sync RPC shapes", () => {
    expect(
      decodeTeamFileUpdateInput({
        cwd: "/repo",
        team: { schemaVersion: 1, teamRemote: "upstream" },
        commit: false,
      }),
    ).toMatchObject({
      cwd: "/repo",
      team: { teamRemote: "upstream" },
      commit: false,
    });

    expect(
      decodeTeamRosterSyncResult({
        remote: "upstream",
        branch: "main",
        ref: "refs/repokin/rosters/abc123",
        roster: {
          team: { schemaVersion: 1, teamRemote: "upstream" },
          humans: [],
          agents: [],
          warnings: [],
        },
      }),
    ).toMatchObject({
      remote: "upstream",
      branch: "main",
      roster: { humans: [], agents: [] },
    });
  });

  it("decodes M3 signed message envelope shapes", () => {
    const message = {
      projectId: "project-1",
      messageId: "message-1",
      senderId: "human_julius",
      senderEnvironmentId: "env_sender",
      recipientId: "human_maya",
      recipientEnvironmentId: "env_recipient",
      body: "Can you take the review?",
      threadId: "thread-1",
      sentAt: "2026-07-30T00:00:00.000Z",
    };

    expect(
      decodeTeamSignedMessageEnvelope({
        payload: message,
        proof: "signed.jwt",
      }),
    ).toMatchObject({
      payload: {
        senderId: "human_julius",
        recipientId: "human_maya",
      },
      proof: "signed.jwt",
    });

    expect(
      decodeTeamSignedMessageProofPayload({
        iss: "t3-env:env_sender",
        aud: "https://relay.example.test",
        sub: "env_sender",
        jti: "jti-1",
        iat: 100,
        exp: 200,
        senderEnvironmentId: "env_sender",
        recipientEnvironmentId: "env_recipient",
        message,
      }),
    ).toMatchObject({
      senderEnvironmentId: "env_sender",
      message: { messageId: "message-1" },
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

describe("M2 team domain contracts", () => {
  it("decodes local assignment and message commands with project scope", () => {
    expect(
      decodeTeamCommand({
        commandId: "cmd-assign-1",
        projectId: "project-1",
        type: "team.agent.assign",
        threadId: "thread-1",
        assigneeId: "agent_aria",
        assignedById: "human_julius",
        note: "handoff after setup",
      }),
    ).toMatchObject({
      commandId: "cmd-assign-1",
      projectId: "project-1",
      type: "team.agent.assign",
      assigneeId: "agent_aria",
    });

    expect(
      decodeTeamCommand({
        commandId: "cmd-message-1",
        projectId: "project-1",
        type: "team.message.send",
        messageId: "msg-1",
        senderId: "human_julius",
        recipientId: "agent_aria",
        body: "Please take this thread next.",
        threadId: "thread-1",
        expiresAt: "2026-07-30T13:00:00.000Z",
      }),
    ).toMatchObject({
      type: "team.message.send",
      body: "Please take this thread next.",
      threadId: "thread-1",
    });
  });

  it("decodes durable inbox events and projected delivery state", () => {
    const event = decodeTeamEvent({
      sequence: 1,
      eventId: "evt-message-queued-1",
      aggregateKind: "project",
      aggregateId: "project-1",
      type: "team.message.queued",
      commandId: "cmd-message-1",
      causationEventId: null,
      correlationId: "cmd-message-1",
      messageId: "msg-1",
      senderId: "human_julius",
      recipientId: "agent_aria",
      body: "Please take this thread next.",
      threadId: "thread-1",
      sentAt: "2026-07-30T12:00:00.000Z",
      expiresAt: null,
      metadata: { actorMemberId: "human_julius" },
    });
    expect(event.type).toBe("team.message.queued");

    const readModel = decodeTeamDomainReadModel({
      snapshotSequence: 1,
      updatedAt: "2026-07-30T12:00:00.000Z",
      projects: [
        {
          projectId: "project-1",
          updatedAt: "2026-07-30T12:00:00.000Z",
          members: [],
          assignments: [],
          inbox: [
            {
              messageId: "msg-1",
              senderId: "human_julius",
              recipientId: "agent_aria",
              body: "Please take this thread next.",
              threadId: "thread-1",
              sentAt: "2026-07-30T12:00:00.000Z",
              expiresAt: null,
              state: "queued",
              deliveredAt: null,
              readAt: null,
              expiredAt: null,
            },
          ],
          requests: [],
          activities: [
            {
              eventId: "evt-message-queued-1",
              kind: "message.queued",
              occurredAt: "2026-07-30T12:00:00.000Z",
              actorMemberId: "human_julius",
              subjectMemberId: "agent_aria",
              threadId: "thread-1",
              messageId: "msg-1",
              requestId: null,
              summary: "human_julius messaged agent_aria",
            },
          ],
        },
      ],
    });
    expect(readModel.projects[0]?.inbox[0]?.state).toBe("queued");
  });
});

describe("TeamInstructionPreviewResult", () => {
  it("decodes instructions with mechanical trust metadata", () => {
    const decoded = decodeInstructionPreview({
      agentId: "agent_aria",
      characterVersion: 1,
      driver: "codex",
      instructions: "You are Aria.",
      mechanics: {
        runtimeMode: "approval-required",
        interactionMode: "default",
      },
      mechanicalHash: "sha256:abc",
    });

    expect(decoded.driver).toBe("codex");
    expect(decoded.instructions).toContain("Aria");
    expect(decoded.mechanics.runtimeMode).toBe("approval-required");
    expect(decoded.mechanicalHash).toBe("sha256:abc");
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

describe("TeamAgentUpsertResult", () => {
  it("decodes write metadata with a refreshed roster", () => {
    const decoded = decodeAgentUpsertResult({
      write: {
        path: "/tmp/repo/.repokin/agents/agent_aria.json",
        committed: false,
      },
      roster: {
        humans: [juliusProfile],
        agents: [ariaProfile],
      },
    });

    expect(decoded.write.committed).toBe(false);
    expect(decoded.roster.agents[0]?.id).toBe("agent_aria");
    expect(decoded.roster.warnings).toEqual([]);
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
      config: { repokin: { note: "bindings stay local" } },
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

// ---------------------------------------------------------------------------
// R2 — channels + tasks contract families
// ---------------------------------------------------------------------------

const decodeChannelDeclaration = Schema.decodeUnknownSync(ChannelDeclaration);
const encodeChannelDeclaration = Schema.encodeUnknownSync(ChannelDeclaration);
const decodePostContent = Schema.decodeUnknownSync(TeamPostContent);
const decodeChannelCommand = Schema.decodeUnknownSync(TeamChannelCommand);
const decodeTaskCommand = Schema.decodeUnknownSync(TeamTaskCommand);
const decodeChannelEvent = Schema.decodeUnknownSync(TeamChannelEvent);
const decodeTaskEvent = Schema.decodeUnknownSync(TeamTaskEvent);
const decodeChannelView = Schema.decodeUnknownSync(TeamChannelViewReadModel);
const decodeBoard = Schema.decodeUnknownSync(TeamBoardReadModel);

describe("R2 channel declaration", () => {
  it("round-trips a git-resident channel file", () => {
    const declaration = decodeChannelDeclaration({
      schemaVersion: 1,
      id: "team",
      name: "#team",
      description: "Everything the whole team should see.",
      members: ["human_ajay", "agent_aria"],
    });
    expect(declaration.id).toBe("team");
    expect(encodeChannelDeclaration(declaration).members).toEqual(["human_ajay", "agent_aria"]);
  });

  it("treats a channel without members as whole-roster (field omitted)", () => {
    const declaration = decodeChannelDeclaration({ schemaVersion: 1, id: "team", name: "#team" });
    expect(Object.keys(encodeChannelDeclaration(declaration))).not.toContain("members");
  });

  it("rejects a channel id that is not a slug", () => {
    expect(() =>
      decodeChannelDeclaration({ schemaVersion: 1, id: "#team", name: "#team" }),
    ).toThrow();
  });

  it("preserves unknown fields written by newer builds", () => {
    const declaration = decodeChannelDeclaration({
      schemaVersion: 1,
      id: "team",
      name: "#team",
      pinnedPostId: "post_future",
    });
    expect(encodeChannelDeclaration(declaration)).toHaveProperty("pinnedPostId", "post_future");
  });

  it("guards ChannelId at runtime", () => {
    expect(isChannelId(ChannelId.make("frontend"))).toBe(true);
    expect(isChannelId("#frontend")).toBe(false);
  });
});

describe("R2 typed-post union", () => {
  it("decodes every post kind", () => {
    expect(decodePostContent({ kind: "text", body: "hi" }).kind).toBe("text");
    expect(
      decodePostContent({ kind: "thread-card", threadId: "t1", title: "T", status: "Running" })
        .kind,
    ).toBe("thread-card");
    expect(
      decodePostContent({
        kind: "diff-card",
        title: "feat",
        additions: 10,
        deletions: 2,
        changedFiles: 3,
        branch: "forge/x",
      }).kind,
    ).toBe("diff-card");
    expect(
      decodePostContent({
        kind: "task-card",
        taskId: "task_1",
        title: "T",
        taskState: "in-progress",
      }).kind,
    ).toBe("task-card");
    expect(decodePostContent({ kind: "event", summary: "moved a card" }).kind).toBe("event");
    expect(decodePostContent({ kind: "digest", title: "Daily", bullets: ["a", "b"] }).kind).toBe(
      "digest",
    );
  });

  it("rejects an unknown post kind", () => {
    expect(() => decodePostContent({ kind: "poll", options: [] })).toThrow();
  });

  it("rejects negative diff counts", () => {
    expect(() =>
      decodePostContent({
        kind: "diff-card",
        title: "feat",
        additions: -1,
        deletions: 0,
        changedFiles: 0,
        branch: null,
      }),
    ).toThrow();
  });
});

describe("R2 commands", () => {
  const base = { commandId: "cmd_1", projectId: "proj_1" };

  it("decodes a channel post command", () => {
    const command = decodeChannelCommand({
      ...base,
      type: "team.channel.post",
      postId: "post_1",
      channelId: "team",
      authorId: "agent_aria",
      content: { kind: "text", body: "shipping the board" },
    });
    expect(command.type).toBe("team.channel.post");
  });

  it("decodes the four task commands", () => {
    expect(
      decodeTaskCommand({
        ...base,
        type: "team.task.create",
        taskId: "task_1",
        title: "Wire the inbox",
        createdById: "human_ajay",
      }).type,
    ).toBe("team.task.create");
    expect(
      decodeTaskCommand({
        ...base,
        type: "team.task.move",
        taskId: "task_1",
        toState: "in-review",
        movedById: "human_ajay",
      }).type,
    ).toBe("team.task.move");
    expect(
      decodeTaskCommand({
        ...base,
        type: "team.task.update",
        taskId: "task_1",
        updatedById: "human_ajay",
        title: "Wire the inbox read-state",
      }).type,
    ).toBe("team.task.update");
    expect(
      decodeTaskCommand({
        ...base,
        type: "team.task.assign",
        taskId: "task_1",
        assigneeId: "agent_aria",
        assignedById: "human_ajay",
      }).type,
    ).toBe("team.task.assign");
  });

  it("rejects a task state outside the four columns", () => {
    expect(() =>
      decodeTaskCommand({
        ...base,
        type: "team.task.move",
        taskId: "task_1",
        toState: "archived",
        movedById: "human_ajay",
      }),
    ).toThrow();
  });
});

describe("R2 events and read models", () => {
  const eventBase = {
    sequence: 4,
    eventId: "evt_1",
    aggregateKind: "project",
    aggregateId: "proj_1",
    commandId: "cmd_1",
    causationEventId: null,
    correlationId: null,
    at: "2026-08-04T10:00:00.000Z",
    metadata: {},
  };

  it("decodes a channel posted event", () => {
    const event = decodeChannelEvent({
      ...eventBase,
      type: "team.channel.posted",
      postId: "post_1",
      channelId: "team",
      authorId: "agent_bolt",
      authorEnvironmentId: null,
      content: { kind: "event", summary: "opened a review" },
      postedAt: "2026-08-04T10:00:00.000Z",
    });
    expect(event.type).toBe("team.channel.posted");
  });

  it("decodes a task moved event", () => {
    const event = decodeTaskEvent({
      ...eventBase,
      type: "team.task.moved",
      taskId: "task_1",
      fromState: "in-progress",
      toState: "in-review",
      movedById: "human_ajay",
    });
    expect(event.type).toBe("team.task.moved");
  });

  it("decodes a channel view with gap markers", () => {
    const view = decodeChannelView({
      channel: {
        channelId: "team",
        name: "#team",
        description: null,
        memberIds: ["human_ajay"],
        postCount: 2,
        lastPostAt: "2026-08-04T10:00:00.000Z",
      },
      posts: [
        {
          postId: "post_1",
          channelId: "team",
          authorId: "human_ajay",
          authorEnvironmentId: null,
          content: { kind: "text", body: "hello" },
          postedAt: "2026-08-04T09:00:00.000Z",
        },
      ],
      gaps: [{ channelId: "team", afterPostId: "post_1", beforePostId: null, missedCount: 3 }],
    });
    expect(view.posts).toHaveLength(1);
    expect(view.gaps[0]?.missedCount).toBe(3);
  });

  it("decodes a board read model; columns are derived client-side", () => {
    const board = decodeBoard({
      projectId: "proj_1",
      updatedAt: "2026-08-04T10:00:00.000Z",
      tasks: [
        {
          taskId: "task_1",
          title: "Ship the board",
          description: null,
          labels: ["frontend"],
          refs: { channelId: "team" },
          state: "in-progress",
          assigneeId: "agent_aria",
          createdById: "human_ajay",
          createdAt: "2026-08-04T08:00:00.000Z",
          updatedAt: "2026-08-04T09:00:00.000Z",
        },
      ],
    });
    expect(board.tasks[0]?.state).toBe("in-progress");
    expect(board.tasks[0]?.refs?.channelId).toBe("team");
  });
});
