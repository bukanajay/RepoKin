import * as NodeCrypto from "node:crypto";

import { expect, it } from "@effect/vitest";
import { EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  AgentId,
  type AgentProfile,
  HumanId,
  type HumanProfile,
  MemberId,
  type TeamRosterReadModel,
  type TeamSignedMessagePayload,
} from "@t3tools/contracts/team";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  resolveRosterPublicKeyForMember,
  signTeamMessageEnvelope,
  verifyTeamMessageEnvelope,
} from "./SignedMessaging.ts";

const relayIssuer = "https://relay.example.test/";
const now = DateTime.makeUnsafe("2026-07-30T00:00:00.000Z");
const nowEpochSeconds = Math.floor(now.epochMilliseconds / 1_000);

const makeKeyPair = () =>
  NodeCrypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });

const senderKeys = makeKeyPair();
const otherKeys = makeKeyPair();
const decodeMemberId = Schema.decodeUnknownSync(MemberId);

const julius: HumanProfile = {
  schemaVersion: 1,
  id: HumanId.make("human_julius"),
  type: "human",
  displayName: "Julius",
  gitEmails: ["julius@example.com"],
  environments: [
    {
      environmentId: EnvironmentId.make("env_sender"),
      label: "julius-mbp",
      publicKey: senderKeys.publicKey,
    },
  ],
};

const maya: HumanProfile = {
  schemaVersion: 1,
  id: HumanId.make("human_maya"),
  type: "human",
  displayName: "Maya",
  gitEmails: ["maya@example.com"],
  environments: [
    {
      environmentId: EnvironmentId.make("env_recipient"),
      label: "maya-mbp",
      publicKey: otherKeys.publicKey,
    },
  ],
};

const aria: AgentProfile = {
  schemaVersion: 1,
  id: AgentId.make("agent_aria"),
  type: "agent",
  name: "Aria",
  owner: julius.id,
  homeEnvironment: EnvironmentId.make("env_sender"),
  character: {
    characterVersion: 1,
    persona: "Implementation agent",
  },
};

const roster: TeamRosterReadModel = {
  humans: [julius, maya],
  agents: [aria],
  warnings: [],
};

const payload: TeamSignedMessagePayload = {
  projectId: ProjectId.make("project-1"),
  messageId: MessageId.make("message-1"),
  senderId: decodeMemberId(julius.id),
  senderEnvironmentId: EnvironmentId.make("env_sender"),
  recipientId: decodeMemberId(maya.id),
  recipientEnvironmentId: EnvironmentId.make("env_recipient"),
  body: "Can you take the review?",
  threadId: ThreadId.make("thread-1"),
  sentAt: "2026-07-30T00:00:00.000Z",
};

it.effect("accepts a team message signed by the sender roster key", () =>
  Effect.gen(function* () {
    const envelope = yield* signTeamMessageEnvelope({
      privateKey: senderKeys.privateKey,
      relayIssuer,
      payload,
      jti: "jti-1",
      now,
    });

    const result = yield* verifyTeamMessageEnvelope({
      envelope,
      roster,
      relayIssuer,
      nowEpochSeconds,
    });

    expect(result._tag).toBe("accepted");
    if (result._tag === "accepted") {
      expect(result.command).toMatchObject({
        type: "team.message.send",
        projectId: "project-1",
        messageId: "message-1",
        senderId: "human_julius",
        recipientId: "human_maya",
        body: "Can you take the review?",
        metadata: {
          actorMemberId: "human_julius",
          environmentId: "env_sender",
        },
      });
    }
  }),
);

it.effect("drops a message when the roster key does not verify the proof", () =>
  Effect.gen(function* () {
    const envelope = yield* signTeamMessageEnvelope({
      privateKey: senderKeys.privateKey,
      relayIssuer,
      payload,
      jti: "jti-2",
      now,
    });
    const wrongRoster: TeamRosterReadModel = {
      ...roster,
      humans: [
        {
          ...julius,
          environments: (julius.environments ?? []).map((environment) => ({
            ...environment,
            publicKey: otherKeys.publicKey,
          })),
        },
        maya,
      ],
    };

    const result = yield* verifyTeamMessageEnvelope({
      envelope,
      roster: wrongRoster,
      relayIssuer,
      nowEpochSeconds,
    });

    expect(result).toMatchObject({ _tag: "dropped", reason: "proof-invalid" });
  }),
);

it.effect("drops a message when the sender environment key is not in the roster", () =>
  Effect.gen(function* () {
    const envelope = yield* signTeamMessageEnvelope({
      privateKey: senderKeys.privateKey,
      relayIssuer,
      payload: {
        ...payload,
        senderEnvironmentId: EnvironmentId.make("env_unregistered"),
      },
      jti: "jti-3",
      now,
    });

    const result = yield* verifyTeamMessageEnvelope({
      envelope,
      roster,
      relayIssuer,
      nowEpochSeconds,
    });

    expect(result).toMatchObject({
      _tag: "dropped",
      reason: "sender-environment-key-not-found",
    });
  }),
);

it.effect("drops a message when the envelope payload is not the signed payload", () =>
  Effect.gen(function* () {
    const envelope = yield* signTeamMessageEnvelope({
      privateKey: senderKeys.privateKey,
      relayIssuer,
      payload,
      jti: "jti-4",
      now,
    });

    const result = yield* verifyTeamMessageEnvelope({
      envelope: {
        ...envelope,
        payload: {
          ...payload,
          body: "Tampered body",
        },
      },
      roster,
      relayIssuer,
      nowEpochSeconds,
    });

    expect(result).toMatchObject({ _tag: "dropped", reason: "payload-mismatch" });
  }),
);

it("resolves an agent sender through its owner key and home environment", () => {
  expect(
    resolveRosterPublicKeyForMember({
      roster,
      memberId: "agent_aria",
      environmentId: "env_sender",
    }),
  ).toEqual({ publicKey: senderKeys.publicKey });
});
