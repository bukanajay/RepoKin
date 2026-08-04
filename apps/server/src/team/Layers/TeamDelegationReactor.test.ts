import { CommandId, EnvironmentId, EventId, MessageId, ProjectId } from "@t3tools/contracts";
import {
  MemberId,
  TaskId,
  type TeamProjectReadModel,
  type TeamRequestReadModel,
  type TeamRequestRespondedEvent,
  type TeamTaskReadModel,
} from "@t3tools/contracts/team";
import { describe, expect, it } from "@effect/vitest";

import { resolveDelegationAcceptMove } from "./TeamDelegationReactor.ts";

const projectId = ProjectId.make("project-deleg");
const humanId = MemberId.make("human_ajay");
const agentId = MemberId.make("agent_aria");
const taskId = TaskId.make("task-1");
const requestId = MessageId.make("req-1");

const request = (over: Partial<TeamRequestReadModel> = {}): TeamRequestReadModel => ({
  requestId,
  kind: "handoff",
  fromMemberId: humanId,
  toMemberId: agentId,
  threadId: null,
  taskId,
  message: null,
  state: "open",
  createdAt: "2026-08-04T12:00:00.000Z",
  expiresAt: null,
  respondedAt: null,
  response: null,
  responseMessage: null,
  ...over,
});

const task = (state: TeamTaskReadModel["state"]): TeamTaskReadModel =>
  ({
    taskId,
    title: "Implement",
    description: null,
    labels: [],
    refs: null,
    state,
    createdById: humanId,
    assigneeId: agentId,
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:00.000Z",
  }) as TeamTaskReadModel;

const project = (over: Partial<TeamProjectReadModel>): TeamProjectReadModel =>
  ({
    projectId,
    members: [],
    assignments: [],
    inbox: [],
    requests: [],
    channels: [],
    posts: [],
    tasks: [],
    activities: [],
    ...over,
  }) as unknown as TeamProjectReadModel;

const respondedEvent = (
  response: TeamRequestRespondedEvent["response"],
): TeamRequestRespondedEvent => ({
  sequence: 9,
  eventId: EventId.make("evt-responded"),
  aggregateKind: "project",
  aggregateId: projectId,
  type: "team.request.responded",
  commandId: CommandId.make("cmd-responded"),
  causationEventId: null,
  correlationId: null,
  requestId,
  responderId: agentId,
  response,
  message: null,
  respondedAt: "2026-08-04T12:01:00.000Z",
  metadata: { environmentId: EnvironmentId.make("env_a") },
});

describe("resolveDelegationAcceptMove", () => {
  it("moves a backlog task to in-progress when its handoff is accepted", () => {
    const result = resolveDelegationAcceptMove({
      event: respondedEvent("accepted"),
      project: project({ requests: [request()], tasks: [task("backlog")] }),
    });
    expect(result).toEqual({ taskId, movedById: agentId });
  });

  it("does nothing when the request was declined", () => {
    const result = resolveDelegationAcceptMove({
      event: respondedEvent("declined"),
      project: project({ requests: [request()], tasks: [task("backlog")] }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when the request is not linked to a task", () => {
    const result = resolveDelegationAcceptMove({
      event: respondedEvent("accepted"),
      project: project({ requests: [request({ taskId: null })], tasks: [task("backlog")] }),
    });
    expect(result).toBeNull();
  });

  it("is idempotent — a task already past backlog is not moved again", () => {
    const result = resolveDelegationAcceptMove({
      event: respondedEvent("accepted"),
      project: project({ requests: [request()], tasks: [task("in-progress")] }),
    });
    expect(result).toBeNull();
  });
});
