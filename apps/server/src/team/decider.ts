import { EventId } from "@t3tools/contracts";
import {
  MemberId,
  type PlannedTeamEvent,
  type TeamCommand,
  type TeamDomainReadModel,
  type TeamEvent,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as PlatformError from "effect/PlatformError";

import {
  isAgentMember,
  requireChannel,
  requireMember,
  requireMessageAbsent,
  requirePromptedPost,
  requireQueuedMessage,
  requireReadableMessage,
  requireOpenRequest,
  requireTask,
  requireTaskAbsent,
} from "./commandInvariants.ts";
import { TeamCommandInvariantError } from "./Errors.ts";
import { projectTeamEvent } from "./projector.ts";

function defaultTeamMessageExpiresAt(occurredAt: string): string {
  return DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(occurredAt), { hours: 24 }));
}

/**
 * Next per-sender causal sequence for a channel post (PRD FR-12.5).
 * Keyed by (channel, authorId) — the author is the causal "sender"; member
 * ids are roster-unique so multi-author environments don't share a counter.
 * Legacy posts (senderSeq 0) do not advance the high-water mark.
 */
function nextSenderSeq(input: {
  readonly readModel: TeamDomainReadModel;
  readonly projectId: TeamCommand["projectId"];
  readonly channelId: string;
  readonly authorId: string;
}): number {
  const project = input.readModel.projects.find(
    (candidate) => candidate.projectId === input.projectId,
  );
  let highWater = 0;
  for (const post of project?.posts ?? []) {
    if (
      post.channelId === input.channelId &&
      post.authorId === input.authorId &&
      post.senderSeq > highWater
    ) {
      highWater = post.senderSeq;
    }
  }
  return highWater + 1;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const decodeMemberId = Schema.decodeUnknownSync(MemberId);

function withEventBase(input: {
  readonly command: TeamCommand;
  readonly occurredAt: string;
}): Effect.Effect<
  Pick<
    PlannedTeamEvent,
    | "eventId"
    | "aggregateKind"
    | "aggregateId"
    | "commandId"
    | "causationEventId"
    | "correlationId"
    | "metadata"
  >,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: "project" as const,
          aggregateId: input.command.projectId,
          commandId: input.command.commandId,
          causationEventId: null,
          correlationId: input.command.commandId,
          metadata: input.command.metadata ?? {},
        })),
      ),
    ),
  );
}

function withSequence(event: PlannedTeamEvent, sequence: number): TeamEvent {
  return { ...event, sequence } as TeamEvent;
}

export const decideTeamCommand = Effect.fn("decideTeamCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: TeamCommand;
  readonly readModel: TeamDomainReadModel;
}): Effect.fn.Return<
  PlannedTeamEvent,
  TeamCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  const occurredAt = yield* nowIso;
  const base = yield* withEventBase({ command, occurredAt });

  switch (command.type) {
    case "team.member.upsert": {
      return {
        ...base,
        type: "team.member.upserted",
        memberId: decodeMemberId(command.profile.id),
        memberType: command.profile.type,
        profile: command.profile,
        at: occurredAt,
      };
    }

    case "team.agent.assign": {
      yield* requireMember({ readModel, command, memberId: command.assigneeId });
      yield* requireMember({ readModel, command, memberId: command.assignedById });
      return {
        ...base,
        type: "team.agent.assigned",
        threadId: command.threadId,
        assigneeId: command.assigneeId,
        assignedById: command.assignedById,
        note: command.note ?? null,
        at: occurredAt,
      };
    }

    case "team.message.send": {
      yield* requireMember({ readModel, command, memberId: command.senderId });
      yield* requireMember({ readModel, command, memberId: command.recipientId });
      yield* requireMessageAbsent({ readModel, command, messageId: command.messageId });
      return {
        ...base,
        type: "team.message.queued",
        messageId: command.messageId,
        senderId: command.senderId,
        recipientId: command.recipientId,
        body: command.body,
        threadId: command.threadId ?? null,
        sentAt: occurredAt,
        expiresAt: command.expiresAt ?? defaultTeamMessageExpiresAt(occurredAt),
      };
    }

    case "team.message.deliver": {
      yield* requireQueuedMessage({ readModel, command, messageId: command.messageId });
      return {
        ...base,
        type: "team.message.delivered",
        messageId: command.messageId,
        deliveredAt: occurredAt,
      };
    }

    case "team.message.markRead": {
      yield* requireReadableMessage({
        readModel,
        command,
        messageId: command.messageId,
        readerId: command.readerId,
      });
      return {
        ...base,
        type: "team.message.read",
        messageId: command.messageId,
        readerId: command.readerId,
        readAt: occurredAt,
      };
    }

    case "team.message.expire": {
      yield* requireQueuedMessage({ readModel, command, messageId: command.messageId });
      return {
        ...base,
        type: "team.message.expired",
        messageId: command.messageId,
        expiredAt: occurredAt,
      };
    }

    case "team.request.create": {
      yield* requireMember({ readModel, command, memberId: command.fromMemberId });
      yield* requireMember({ readModel, command, memberId: command.toMemberId });
      if (command.taskId !== undefined) {
        yield* requireTask({ readModel, command, taskId: command.taskId });
      }
      // FR-18.2 spirit: an agent cannot delegate work to itself and thereby
      // self-approve a run. The accept gate must be a different member.
      if (
        command.fromMemberId === command.toMemberId &&
        isAgentMember(readModel, command.projectId, command.fromMemberId)
      ) {
        return yield* new TeamCommandInvariantError({
          commandType: command.type,
          detail: `Agent '${command.fromMemberId}' cannot delegate request '${command.requestId}' to itself (FR-18.2).`,
        });
      }
      return {
        ...base,
        type: "team.request.created",
        requestId: command.requestId,
        kind: command.kind,
        fromMemberId: command.fromMemberId,
        toMemberId: command.toMemberId,
        threadId: command.threadId ?? null,
        taskId: command.taskId ?? null,
        message: command.message ?? null,
        createdAt: occurredAt,
        expiresAt: command.expiresAt ?? null,
      };
    }

    case "team.request.respond": {
      const request = yield* requireOpenRequest({
        readModel,
        command,
        requestId: command.requestId,
      });
      if (request.toMemberId !== command.responderId) {
        return yield* new TeamCommandInvariantError({
          commandType: command.type,
          detail: `Member '${command.responderId}' cannot respond to request '${command.requestId}'.`,
        });
      }
      return {
        ...base,
        type: "team.request.responded",
        requestId: command.requestId,
        responderId: command.responderId,
        response: command.response,
        message: command.message ?? null,
        respondedAt: occurredAt,
      };
    }

    case "team.channel.declare": {
      return {
        ...base,
        type: "team.channel.declared",
        channelId: command.declaration.id,
        declaration: command.declaration,
        at: occurredAt,
      };
    }

    case "team.channel.post": {
      yield* requireMember({ readModel, command, memberId: command.authorId });
      yield* requireChannel({ readModel, command, channelId: command.channelId });
      yield* requirePromptedPost({
        readModel,
        command,
        authorId: command.authorId,
        content: command.content,
      });
      const authorEnvironmentId = command.metadata?.environmentId ?? null;
      // Remote re-dispatch carries the origin's senderSeq so gap detection on
      // the receiver can see jumps (PRD Q7). Local authors get the next value
      // for this (channel, author environment) stream; when environment is
      // unknown we still advance a local stream keyed by author so a later
      // stamp doesn't reset the counter mid-channel.
      const senderSeq =
        command.senderSeq !== undefined
          ? command.senderSeq
          : nextSenderSeq({
              readModel,
              projectId: command.projectId,
              channelId: command.channelId,
              authorId: command.authorId,
            });
      return {
        ...base,
        type: "team.channel.posted",
        postId: command.postId,
        channelId: command.channelId,
        authorId: command.authorId,
        authorEnvironmentId,
        content: command.content,
        postedAt: occurredAt,
        at: occurredAt,
        senderSeq,
      };
    }

    case "team.task.create": {
      yield* requireMember({ readModel, command, memberId: command.createdById });
      yield* requireTaskAbsent({ readModel, command, taskId: command.taskId });
      if (command.assigneeId !== undefined) {
        yield* requireMember({ readModel, command, memberId: command.assigneeId });
        // FR-18.2: an agent never self-assigns.
        if (
          command.assigneeId === command.createdById &&
          isAgentMember(readModel, command.projectId, command.createdById)
        ) {
          return yield* new TeamCommandInvariantError({
            commandType: command.type,
            detail: `Agent '${command.createdById}' cannot self-assign task '${command.taskId}' (FR-18.2).`,
          });
        }
      }
      return {
        ...base,
        type: "team.task.created",
        taskId: command.taskId,
        title: command.title,
        description: command.description ?? null,
        labels: command.labels ?? [],
        refs: command.refs ?? null,
        createdById: command.createdById,
        assigneeId: command.assigneeId ?? null,
        at: occurredAt,
      };
    }

    case "team.task.move": {
      yield* requireMember({ readModel, command, memberId: command.movedById });
      const task = yield* requireTask({ readModel, command, taskId: command.taskId });
      // FR-18.3: an agent never marks its own task done — human review is required.
      if (
        command.toState === "done" &&
        task.assigneeId === command.movedById &&
        isAgentMember(readModel, command.projectId, command.movedById)
      ) {
        return yield* new TeamCommandInvariantError({
          commandType: command.type,
          detail: `Agent '${command.movedById}' cannot mark its own task '${command.taskId}' done (FR-18.3).`,
        });
      }
      return {
        ...base,
        type: "team.task.moved",
        taskId: command.taskId,
        fromState: task.state,
        toState: command.toState,
        movedById: command.movedById,
        at: occurredAt,
      };
    }

    case "team.task.update": {
      yield* requireMember({ readModel, command, memberId: command.updatedById });
      yield* requireTask({ readModel, command, taskId: command.taskId });
      return {
        ...base,
        type: "team.task.updated",
        taskId: command.taskId,
        updatedById: command.updatedById,
        title: command.title ?? null,
        description: command.description ?? null,
        labels: command.labels ?? null,
        refs: command.refs ?? null,
        at: occurredAt,
      };
    }

    case "team.task.assign": {
      yield* requireMember({ readModel, command, memberId: command.assignedById });
      yield* requireTask({ readModel, command, taskId: command.taskId });
      if (command.assigneeId !== null) {
        yield* requireMember({ readModel, command, memberId: command.assigneeId });
        // FR-18.2: an agent never self-assigns.
        if (
          command.assigneeId === command.assignedById &&
          isAgentMember(readModel, command.projectId, command.assignedById)
        ) {
          return yield* new TeamCommandInvariantError({
            commandType: command.type,
            detail: `Agent '${command.assignedById}' cannot self-assign task '${command.taskId}' (FR-18.2).`,
          });
        }
      }
      return {
        ...base,
        type: "team.task.assigned",
        taskId: command.taskId,
        assigneeId: command.assigneeId,
        assignedById: command.assignedById,
        at: occurredAt,
      };
    }

    case "team.task.comment": {
      yield* requireMember({ readModel, command, memberId: command.authorId });
      yield* requireTask({ readModel, command, taskId: command.taskId });
      return {
        ...base,
        type: "team.task.commented",
        taskId: command.taskId,
        commentId: command.commentId,
        authorId: command.authorId,
        body: command.body,
        at: occurredAt,
      };
    }

    case "team.task.review": {
      yield* requireMember({ readModel, command, memberId: command.reviewerId });
      const task = yield* requireTask({ readModel, command, taskId: command.taskId });
      // FR-13.6 / FR-18.3: only humans review; agent assignee cannot self-approve.
      if (isAgentMember(readModel, command.projectId, command.reviewerId)) {
        return yield* new TeamCommandInvariantError({
          commandType: command.type,
          detail: `Agent '${command.reviewerId}' cannot submit a structured review (FR-13.6).`,
        });
      }
      if (
        command.verdict === "approve" &&
        task.assigneeId === command.reviewerId &&
        isAgentMember(readModel, command.projectId, command.reviewerId)
      ) {
        return yield* new TeamCommandInvariantError({
          commandType: command.type,
          detail: `Reviewer cannot approve their own assigned agent work (FR-18.3).`,
        });
      }
      const toState = command.verdict === "approve" ? ("done" as const) : ("in-progress" as const);
      return {
        ...base,
        type: "team.task.reviewed",
        taskId: command.taskId,
        commentId: command.commentId,
        reviewerId: command.reviewerId,
        verdict: command.verdict,
        findings: command.findings ?? null,
        fromState: task.state,
        toState,
        at: occurredAt,
      };
    }
  }
});

export const decideTeamCommandSequence = Effect.fn("decideTeamCommandSequence")(function* ({
  commands,
  readModel,
}: {
  readonly commands: ReadonlyArray<TeamCommand>;
  readonly readModel: TeamDomainReadModel;
}): Effect.fn.Return<
  ReadonlyArray<PlannedTeamEvent>,
  TeamCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedTeamEvent[] = [];

  for (const command of commands) {
    const event = yield* decideTeamCommand({ command, readModel: nextReadModel });
    plannedEvents.push(event);
    nextSequence += 1;
    nextReadModel = yield* projectTeamEvent(nextReadModel, withSequence(event, nextSequence)).pipe(
      Effect.orDie,
    );
  }

  return plannedEvents;
});
