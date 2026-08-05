/**
 * Multi-environment simulation tests (R2.5 / R3.4 gates without two machines).
 *
 * Two logical environments (env_sender / env_recipient) share one roster and
 * exchange signed envelopes the same way the relay would. Assertions cover:
 *   - channel post fan-out preserves senderSeq (gap detection on the far side)
 *   - work-signal sign → verify → ingest → map projection
 *   - gap markers when intermediate remote seqs never arrive
 */
import * as NodeCrypto from "node:crypto";

import { expect, it } from "@effect/vitest";
import { CommandId, EnvironmentId, EventId, ProjectId } from "@t3tools/contracts";
import {
  ChannelId,
  MemberId,
  PostId,
  type TeamRosterReadModel,
  type TeamWorkSignal,
} from "@t3tools/contracts/team";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  signTeamEventEnvelope,
  signTeamWorkSignalEnvelope,
  verifyTeamEventEnvelope,
  verifyTeamWorkSignalEnvelope,
} from "./SignedMessaging.ts";
import { detectChannelGaps } from "./channelPosts.ts";
import { detectOverlaps, projectWorkMapNodes } from "./workMap.ts";

const relayIssuer = "https://relay.test";
const projectId = ProjectId.make("project-1");
const envSender = EnvironmentId.make("env_sender");
const envRecipient = EnvironmentId.make("env_recipient");

const makeKeyPair = () =>
  NodeCrypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });

const senderKeys = makeKeyPair();
const recipientKeys = makeKeyPair();

const julius = {
  schemaVersion: 1 as const,
  id: "human_julius" as const,
  type: "human" as const,
  displayName: "Julius",
  gitEmails: ["julius@example.com"],
  environments: [
    {
      environmentId: envSender,
      label: "julius-mbp",
      publicKey: senderKeys.publicKey,
    },
  ],
};

const maya = {
  schemaVersion: 1 as const,
  id: "human_maya" as const,
  type: "human" as const,
  displayName: "Maya",
  gitEmails: ["maya@example.com"],
  environments: [
    {
      environmentId: envRecipient,
      label: "maya-studio",
      publicKey: recipientKeys.publicKey,
    },
  ],
};

const aria = {
  schemaVersion: 1 as const,
  id: "agent_aria" as const,
  type: "agent" as const,
  name: "Aria",
  owner: "human_julius" as const,
  homeEnvironment: envSender,
  character: {
    schemaVersion: 1 as const,
    expressive: {
      voice: "concise",
      persona: "careful engineer",
      tone: "direct",
      conventions: [] as string[],
      avoid: [] as string[],
    },
    mechanical: {
      model: "default",
      runtimeMode: "approval-required" as const,
      interactionMode: "default" as const,
      pathScope: ["apps/**"],
      toolPolicy: "default",
    },
  },
};

const roster = {
  humans: [julius, maya],
  agents: [aria],
  warnings: [],
} as unknown as TeamRosterReadModel;

const now = DateTime.makeUnsafe("2026-08-05T12:00:00.000Z");
const nowEpochSeconds = Math.floor(now.epochMilliseconds / 1_000);

it.effect("channel post fan-out preserves senderSeq for gap detection", () =>
  Effect.gen(function* () {
    // Sender posts seq 1 and seq 4; recipient never sees 2–3 → gap of 2.
    const posts = [
      {
        postId: PostId.make("p1"),
        channelId: ChannelId.make("team"),
        authorId: MemberId.make("human_julius"),
        authorEnvironmentId: envSender,
        content: { kind: "text" as const, body: "first" },
        postedAt: "2026-08-05T11:00:00.000Z",
        senderSeq: 1,
      },
      {
        postId: PostId.make("p4"),
        channelId: ChannelId.make("team"),
        authorId: MemberId.make("human_julius"),
        authorEnvironmentId: envSender,
        content: { kind: "text" as const, body: "after gap" },
        postedAt: "2026-08-05T11:30:00.000Z",
        senderSeq: 4,
      },
    ];

    for (const [index, post] of posts.entries()) {
      const event = {
        sequence: index + 1,
        eventId: EventId.make(`evt-${post.postId}`),
        aggregateKind: "project" as const,
        aggregateId: projectId,
        commandId: CommandId.make(`cmd-${post.postId}`),
        causationEventId: null,
        correlationId: null,
        at: post.postedAt,
        metadata: { actorMemberId: post.authorId },
        type: "team.channel.posted" as const,
        postId: post.postId,
        channelId: post.channelId,
        authorId: post.authorId,
        authorEnvironmentId: post.authorEnvironmentId,
        content: post.content,
        postedAt: post.postedAt,
        senderSeq: post.senderSeq,
      };
      const envelope = yield* signTeamEventEnvelope({
        privateKey: senderKeys.privateKey,
        relayIssuer,
        payload: {
          projectId,
          senderId: post.authorId,
          senderEnvironmentId: envSender,
          recipientEnvironmentId: envRecipient,
          event,
          sentAt: post.postedAt,
        },
        jti: `jti-${post.postId}`,
        now,
      });
      const verified = yield* verifyTeamEventEnvelope({
        envelope,
        roster,
        relayIssuer,
        nowEpochSeconds,
      });
      expect(verified._tag).toBe("accepted");
      if (verified._tag === "accepted") {
        expect(verified.command).toMatchObject({
          type: "team.channel.post",
          senderSeq: post.senderSeq,
          metadata: { environmentId: envSender },
        });
      }
    }

    const gaps = detectChannelGaps(posts, ChannelId.make("team"));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.missedCount).toBe(2);
    expect(gaps[0]?.afterPostId).toBe("p1");
    expect(gaps[0]?.beforePostId).toBe("p4");
  }),
);

it.effect("work-signal snapshot fans out, verifies, and projects overlaps", () =>
  Effect.gen(function* () {
    const senderSignals: TeamWorkSignal[] = [
      {
        projectId,
        memberId: MemberId.make("human_julius"),
        memberType: "human",
        environmentId: envSender,
        directories: ["apps/web/src", "apps/server/src/team"],
        updatedAt: "2026-08-05T12:00:00.000Z",
        source: "working-tree",
      },
      {
        projectId,
        memberId: MemberId.make("agent_aria"),
        memberType: "agent",
        environmentId: envSender,
        directories: ["apps/web/src"],
        updatedAt: "2026-08-05T12:00:00.000Z",
        source: "thread",
      },
    ];

    const envelope = yield* signTeamWorkSignalEnvelope({
      privateKey: senderKeys.privateKey,
      relayIssuer,
      payload: {
        projectId,
        senderId: MemberId.make("human_julius"),
        senderEnvironmentId: envSender,
        recipientEnvironmentId: envRecipient,
        signals: senderSignals,
        sentAt: "2026-08-05T12:00:00.000Z",
      },
      jti: "work-signal-jti-1",
      now,
    });

    const verified = yield* verifyTeamWorkSignalEnvelope({
      envelope,
      roster,
      relayIssuer,
      nowEpochSeconds,
    });
    expect(verified._tag).toBe("accepted");
    if (verified._tag !== "accepted") return;

    const localSignals: TeamWorkSignal[] = [
      {
        projectId,
        memberId: MemberId.make("human_maya"),
        memberType: "human",
        environmentId: envRecipient,
        directories: ["apps/web/src"],
        updatedAt: "2026-08-05T12:00:05.000Z",
        source: "working-tree",
      },
    ];

    const merged = [...verified.signals, ...localSignals];
    const projection = projectWorkMapNodes(
      merged.map((signal) => ({
        memberId: String(signal.memberId),
        directories: [...signal.directories],
      })),
    );
    const web = projection.find((node) => node.path === "apps/web/src");
    expect([...(web?.memberIds ?? [])].toSorted()).toEqual([
      "agent_aria",
      "human_julius",
      "human_maya",
    ]);

    const overlaps = detectOverlaps(
      merged.map((signal) => ({
        memberId: String(signal.memberId),
        directories: [...signal.directories],
      })),
    );
    expect(overlaps.some((overlap) => overlap.path === "apps/web/src")).toBe(true);
    expect(overlaps.find((overlap) => overlap.path === "apps/web/src")?.memberIds).toContain(
      "human_maya",
    );
  }),
);

it.effect("rejects work signals signed with the wrong environment key", () =>
  Effect.gen(function* () {
    const envelope = yield* signTeamWorkSignalEnvelope({
      privateKey: recipientKeys.privateKey,
      relayIssuer,
      payload: {
        projectId,
        senderId: MemberId.make("human_julius"),
        senderEnvironmentId: envSender,
        recipientEnvironmentId: envRecipient,
        signals: [],
        sentAt: "2026-08-05T12:00:00.000Z",
      },
      jti: "bad-key-jti",
      now,
    });
    const verified = yield* verifyTeamWorkSignalEnvelope({
      envelope,
      roster,
      relayIssuer,
      nowEpochSeconds,
    });
    expect(verified._tag).toBe("dropped");
  }),
);
