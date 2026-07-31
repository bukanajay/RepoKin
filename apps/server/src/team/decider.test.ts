import { CommandId, EventId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  AgentProfile,
  HumanProfile,
  MemberId,
  TeamCommand,
  type PlannedTeamEvent,
  type TeamEvent,
} from "@t3tools/contracts/team";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TeamCommandInvariantError } from "./Errors.ts";
import { decideTeamCommand } from "./decider.ts";
import { createEmptyTeamReadModel, projectTeamEvent } from "./projector.ts";

const decodeHuman = Schema.decodeUnknownSync(HumanProfile);
const decodeAgent = Schema.decodeUnknownSync(AgentProfile);
const decodeCommand = Schema.decodeUnknownSync(TeamCommand);
const decodeMemberId = Schema.decodeUnknownSync(MemberId);

function withSequence(event: PlannedTeamEvent, sequence: number): TeamEvent {
  return { ...event, sequence } as TeamEvent;
}

const projectId = ProjectId.make("project-team-domain");
const humanId = decodeMemberId("human_julius");
const agentId = decodeMemberId("agent_aria");

const humanProfile = decodeHuman({
  schemaVersion: 1,
  id: "human_julius",
  type: "human",
  displayName: "Julius",
  gitEmails: ["julius@example.com"],
});

const agentProfile = decodeAgent({
  schemaVersion: 1,
  id: "agent_aria",
  type: "agent",
  name: "Aria",
  owner: "human_julius",
  character: { characterVersion: 1 },
  createdAt: "2026-07-30T12:00:00.000Z",
  updatedAt: "2026-07-30T12:00:00.000Z",
});

it.layer(NodeServices.layer)("team decider/projector", (it) => {
  it.effect("upserts members, queues messages, and assigns threads", () =>
    Effect.gen(function* () {
      let readModel = createEmptyTeamReadModel("2026-07-30T12:00:00.000Z");

      const memberEvents = [];
      for (const [index, profile] of [humanProfile, agentProfile].entries()) {
        const event = yield* decideTeamCommand({
          readModel,
          command: decodeCommand({
            commandId: `cmd-member-${index}`,
            projectId,
            type: "team.member.upsert",
            profile,
          }),
        });
        memberEvents.push(event);
        readModel = yield* projectTeamEvent(readModel, withSequence(event, index + 1));
      }

      expect(memberEvents.map((event) => event.type)).toEqual([
        "team.member.upserted",
        "team.member.upserted",
      ]);
      expect(readModel.projects[0]?.members.map((member) => member.memberId).toSorted()).toEqual([
        agentId,
        humanId,
      ]);

      const messageEvent = yield* decideTeamCommand({
        readModel,
        command: decodeCommand({
          commandId: "cmd-message",
          projectId,
          type: "team.message.send",
          messageId: MessageId.make("message-1"),
          senderId: humanId,
          recipientId: agentId,
          body: "Please pick up this thread.",
          threadId: ThreadId.make("thread-1"),
        }),
      });
      expect(messageEvent.type).toBe("team.message.queued");
      readModel = yield* projectTeamEvent(readModel, withSequence(messageEvent, 3));
      expect(readModel.projects[0]?.inbox[0]).toMatchObject({
        messageId: "message-1",
        state: "queued",
        recipientId: "agent_aria",
      });

      const deliveredEvent = yield* decideTeamCommand({
        readModel,
        command: decodeCommand({
          commandId: "cmd-message-deliver",
          projectId,
          type: "team.message.deliver",
          messageId: MessageId.make("message-1"),
        }),
      });
      expect(deliveredEvent.type).toBe("team.message.delivered");
      readModel = yield* projectTeamEvent(readModel, withSequence(deliveredEvent, 4));
      expect(readModel.projects[0]?.inbox[0]?.state).toBe("delivered");

      const readEvent = yield* decideTeamCommand({
        readModel,
        command: decodeCommand({
          commandId: "cmd-message-read",
          projectId,
          type: "team.message.markRead",
          messageId: MessageId.make("message-1"),
          readerId: agentId,
        }),
      });
      expect(readEvent.type).toBe("team.message.read");
      readModel = yield* projectTeamEvent(readModel, withSequence(readEvent, 5));
      expect(readModel.projects[0]?.inbox[0]?.state).toBe("read");

      const assignedEvent = yield* decideTeamCommand({
        readModel,
        command: decodeCommand({
          commandId: "cmd-assign",
          projectId,
          type: "team.agent.assign",
          threadId: ThreadId.make("thread-1"),
          assigneeId: agentId,
          assignedById: humanId,
          note: "Aria owns implementation.",
        }),
      });
      expect(assignedEvent.type).toBe("team.agent.assigned");
      readModel = yield* projectTeamEvent(readModel, withSequence(assignedEvent, 6));
      expect(readModel.projects[0]?.assignments[0]).toMatchObject({
        threadId: "thread-1",
        assigneeId: "agent_aria",
      });
      expect(readModel.projects[0]?.activities.at(-1)?.kind).toBe("thread.assigned");
    }),
  );

  it.effect("rejects messages to unknown members", () =>
    Effect.gen(function* () {
      const readModel = createEmptyTeamReadModel("2026-07-30T12:00:00.000Z");

      const failure = yield* Effect.flip(
        decideTeamCommand({
          readModel,
          command: decodeCommand({
            commandId: "cmd-message-unknown",
            projectId,
            type: "team.message.send",
            messageId: MessageId.make("message-unknown"),
            senderId: humanId,
            recipientId: agentId,
            body: "Hello",
          }),
        }),
      );

      expect(failure).toBeInstanceOf(TeamCommandInvariantError);
      expect(failure.message).toContain("Member 'human_julius' does not exist");
    }),
  );

  it.effect("projects request responses only once", () =>
    Effect.gen(function* () {
      let readModel = createEmptyTeamReadModel("2026-07-30T12:00:00.000Z");
      readModel = yield* projectTeamEvent(readModel, {
        sequence: 1,
        eventId: EventId.make("evt-request-created"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "team.request.created",
        commandId: CommandId.make("cmd-request-created"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-request-created"),
        requestId: MessageId.make("request-1"),
        kind: "handoff",
        fromMemberId: humanId,
        toMemberId: agentId,
        threadId: ThreadId.make("thread-1"),
        message: "Please take over.",
        createdAt: "2026-07-30T12:00:00.000Z",
        expiresAt: null,
        metadata: {},
      });

      const responseEvent = yield* decideTeamCommand({
        readModel,
        command: decodeCommand({
          commandId: "cmd-request-response",
          projectId,
          type: "team.request.respond",
          requestId: MessageId.make("request-1"),
          responderId: agentId,
          response: "accepted",
          message: "Taking it.",
        }),
      });
      expect(responseEvent.type).toBe("team.request.responded");

      readModel = yield* projectTeamEvent(readModel, withSequence(responseEvent, 2));

      const secondResponse = yield* Effect.flip(
        decideTeamCommand({
          readModel,
          command: decodeCommand({
            commandId: "cmd-request-response-again",
            projectId,
            type: "team.request.respond",
            requestId: MessageId.make("request-1"),
            responderId: agentId,
            response: "declined",
          }),
        }),
      );
      expect(secondResponse.message).toContain("cannot be responded to again");
    }),
  );
});
