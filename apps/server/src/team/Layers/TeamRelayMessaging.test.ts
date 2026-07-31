import { EnvironmentId } from "@t3tools/contracts";
import {
  AgentId,
  type AgentProfile,
  HumanId,
  type HumanProfile,
  MemberId,
  type TeamRosterReadModel,
} from "@t3tools/contracts/team";
import { describe, expect, it } from "@effect/vitest";

import { resolveRemoteRecipientEnvironment } from "./TeamRelayMessaging.ts";

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
  humans: [julius],
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

  it("returns null for a human recipient, deferring multi-environment routing to M3.3", () => {
    expect(
      resolveRemoteRecipientEnvironment({
        roster,
        recipientId: MemberId.make(julius.id),
        localEnvironmentId,
      }),
    ).toBeNull();
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
});
