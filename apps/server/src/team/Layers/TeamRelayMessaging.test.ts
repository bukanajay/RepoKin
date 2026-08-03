import { EnvironmentId, MessageId, ProjectId } from "@t3tools/contracts";
import {
  AgentId,
  type AgentProfile,
  HumanId,
  type HumanProfile,
  MemberId,
  type TeamRosterReadModel,
  type TeamSignedDeliveryReceiptPayload,
} from "@t3tools/contracts/team";
import { describe, expect, it } from "@effect/vitest";

import {
  matchesQueuedMessageForReceipt,
  resolveRemoteRecipientEnvironment,
} from "./TeamRelayMessaging.ts";

const julius: HumanProfile = {
  schemaVersion: 1,
  id: HumanId.make("human_julius"),
  type: "human",
  displayName: "Julius",
  gitEmails: ["julius@example.com"],
  environments: [
    { environmentId: EnvironmentId.make("env-local"), publicKey: "julius-key" },
    { environmentId: EnvironmentId.make("env-remote"), publicKey: "julius-key-2" },
  ],
};

const maya: HumanProfile = {
  schemaVersion: 1,
  id: HumanId.make("human_maya"),
  type: "human",
  displayName: "Maya",
  gitEmails: ["maya@example.com"],
  environments: [{ environmentId: EnvironmentId.make("env-maya"), publicKey: "maya-key" }],
};

const localAria: AgentProfile = {
  schemaVersion: 1,
  id: AgentId.make("agent_aria"),
  type: "agent",
  name: "Aria",
  owner: julius.id,
  homeEnvironment: EnvironmentId.make("env-local"),
  character: { characterVersion: 1, persona: "Local agent" },
};

const remoteBrooks: AgentProfile = {
  schemaVersion: 1,
  id: AgentId.make("agent_brooks"),
  type: "agent",
  name: "Brooks",
  owner: julius.id,
  homeEnvironment: EnvironmentId.make("env-remote"),
  character: { characterVersion: 1, persona: "Remote agent" },
};

const homelessCleo: AgentProfile = {
  schemaVersion: 1,
  id: AgentId.make("agent_cleo"),
  type: "agent",
  name: "Cleo",
  owner: julius.id,
  character: { characterVersion: 1, persona: "Homeless agent" },
};

const roster: TeamRosterReadModel = {
  humans: [julius, maya],
  agents: [localAria, remoteBrooks, homelessCleo],
  warnings: [],
};

const localEnvironmentId = EnvironmentId.make("env-local");

describe("resolveRemoteRecipientEnvironment", () => {
  it("returns null for a recipient bound to the local environment", () => {
    expect(
      resolveRemoteRecipientEnvironment({
        roster,
        recipientId: MemberId.make(localAria.id),
        localEnvironmentId,
      }),
    ).toBeNull();
  });

  it("returns the agent's home environment when it differs from the local one", () => {
    expect(
      resolveRemoteRecipientEnvironment({
        roster,
        recipientId: MemberId.make(remoteBrooks.id),
        localEnvironmentId,
      }),
    ).toBe("env-remote");
  });

  it("returns null for an agent without a declared home environment", () => {
    expect(
      resolveRemoteRecipientEnvironment({
        roster,
        recipientId: MemberId.make(homelessCleo.id),
        localEnvironmentId,
      }),
    ).toBeNull();
  });

  it("keeps a human recipient local when this environment is linked", () => {
    expect(
      resolveRemoteRecipientEnvironment({
        roster,
        recipientId: MemberId.make(julius.id),
        localEnvironmentId,
      }),
    ).toBeNull();
  });

  it("returns a human recipient's only linked remote environment", () => {
    expect(
      resolveRemoteRecipientEnvironment({
        roster,
        recipientId: MemberId.make(maya.id),
        localEnvironmentId,
      }),
    ).toBe("env-maya");
  });

  it("returns null for an unknown recipient", () => {
    expect(
      resolveRemoteRecipientEnvironment({
        roster,
        recipientId: MemberId.make("agent_unknown"),
        localEnvironmentId,
      }),
    ).toBeNull();
  });

  it("routes a multi-device human when exactly one remote environment is active", () => {
    expect(
      resolveRemoteRecipientEnvironment({
        roster,
        recipientId: MemberId.make(julius.id),
        localEnvironmentId: EnvironmentId.make("env-sender"),
        activeHumanEnvironmentIds: [EnvironmentId.make("env-remote")],
      }),
    ).toBe("env-remote");
  });

  it("keeps a multi-device human queued when presence is ambiguous", () => {
    expect(
      resolveRemoteRecipientEnvironment({
        roster,
        recipientId: MemberId.make(julius.id),
        localEnvironmentId: EnvironmentId.make("env-sender"),
        activeHumanEnvironmentIds: [
          EnvironmentId.make("env-local"),
          EnvironmentId.make("env-remote"),
        ],
      }),
    ).toBeNull();
  });
});

describe("matchesQueuedMessageForReceipt", () => {
  const receipt: TeamSignedDeliveryReceiptPayload = {
    projectId: ProjectId.make("project-1"),
    messageId: MessageId.make("message-1"),
    senderId: MemberId.make(julius.id),
    senderEnvironmentId: EnvironmentId.make("env-local"),
    recipientId: MemberId.make(maya.id),
    recipientEnvironmentId: EnvironmentId.make("env-maya"),
    deliveredAt: "2026-07-30T00:00:01.000Z",
  };
  const message = {
    messageId: receipt.messageId,
    senderId: receipt.senderId,
    recipientId: receipt.recipientId,
    senderEnvironmentId: receipt.senderEnvironmentId,
    body: "Please review this change.",
    threadId: null,
    sentAt: "2026-07-30T00:00:00.000Z",
    expiresAt: null,
    state: "queued" as const,
    deliveredAt: null,
    readAt: null,
    expiredAt: null,
  };

  it("matches the signed receipt to its queued sender and recipient", () => {
    expect(matchesQueuedMessageForReceipt({ message, receipt })).toBe(true);
  });

  it("rejects a receipt for a different recipient", () => {
    expect(
      matchesQueuedMessageForReceipt({
        message,
        receipt: { ...receipt, recipientId: MemberId.make("human_someone_else") },
      }),
    ).toBe(false);
  });
});
