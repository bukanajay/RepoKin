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
  requireMember,
  requireMessageAbsent,
  requireQueuedMessage,
  requireReadableMessage,
  requireOpenRequest,
} from "./commandInvariants.ts";
import { TeamCommandInvariantError } from "./Errors.ts";
import { projectTeamEvent } from "./projector.ts";

function defaultTeamMessageExpiresAt(occurredAt: string): string {
  return DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(occurredAt), { hours: 24 }));
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
