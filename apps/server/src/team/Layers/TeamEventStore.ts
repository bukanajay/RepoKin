import { EventId, NonNegativeInt, ProjectId } from "@t3tools/contracts";
import { type PlannedTeamEvent, TeamEvent, TeamEventType } from "@t3tools/contracts/team";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  PersistenceDecodeError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type TeamEventStoreError,
} from "../../persistence/Errors.ts";
import { TeamEventStore, type TeamEventStoreShape } from "../Services/TeamEventStore.ts";

const decodeEvent = Schema.decodeUnknownEffect(TeamEvent);
const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown);
const decodeJsonString = Schema.decodeUnknownEffect(UnknownFromJsonString);
const encodeJsonString = Schema.encodeUnknownSync(UnknownFromJsonString);

const AppendTeamEventRequestSchema = Schema.Struct({
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  streamId: ProjectId,
  type: TeamEventType,
  occurredAt: Schema.String,
  commandId: Schema.String,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(Schema.String),
  eventJson: Schema.String,
});

const TeamEventPersistedRowSchema = Schema.Struct({
  sequence: NonNegativeInt,
  eventJson: Schema.String,
});

const ReadFromSequenceRequestSchema = Schema.Struct({
  sequenceExclusive: NonNegativeInt,
  limit: Schema.Number,
});

const DEFAULT_READ_FROM_SEQUENCE_LIMIT = 1_000;
const READ_PAGE_SIZE = 500;
/**
 * Sentinel `limit` for `readAll`: replay every event. `readFromSequence` still
 * pages in `READ_PAGE_SIZE` chunks, so this streams rather than issuing one
 * unbounded query. Bounded streaming consumers (readEvents RPC) pass an
 * explicit limit and are unaffected.
 */
const READ_ALL_LIMIT = Number.POSITIVE_INFINITY;

function eventOccurredAt(event: PlannedTeamEvent): string {
  switch (event.type) {
    case "team.member.upserted":
    case "team.agent.assigned":
      return event.at;
    case "team.message.queued":
      return event.sentAt;
    case "team.message.delivered":
      return event.deliveredAt;
    case "team.message.read":
      return event.readAt;
    case "team.message.expired":
      return event.expiredAt;
    case "team.request.created":
      return event.createdAt;
    case "team.request.responded":
      return event.respondedAt;
    case "team.channel.declared":
    case "team.channel.posted":
    case "team.task.created":
    case "team.task.moved":
    case "team.task.updated":
    case "team.task.assigned":
      return event.at;
  }
}

function parsePersistedEvent(
  row: { readonly sequence: number; readonly eventJson: string },
  operation: string,
): Effect.Effect<TeamEvent, TeamEventStoreError> {
  return Effect.try({
    try: () => row.eventJson,
    catch: (cause) =>
      new PersistenceDecodeError({
        operation,
        issue: "Invalid JSON",
        cause,
      }),
  }).pipe(
    Effect.flatMap(decodeJsonString),
    Effect.flatMap((event) => decodeEvent({ ...(event as object), sequence: row.sequence })),
    Effect.mapError((error) =>
      Schema.isSchemaError(error) ? toPersistenceDecodeError(operation)(error) : error,
    ),
  );
}

function toSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): TeamEventStoreError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeTeamEventStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const appendEventRow = SqlSchema.findOne({
    Request: AppendTeamEventRequestSchema,
    Result: TeamEventPersistedRowSchema,
    execute: (request) =>
      sql`
        INSERT INTO team_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          event_json
        )
        VALUES (
          ${request.eventId},
          ${request.aggregateKind},
          ${request.streamId},
          COALESCE(
            (
              SELECT stream_version + 1
              FROM team_events
              WHERE aggregate_kind = ${request.aggregateKind}
                AND stream_id = ${request.streamId}
              ORDER BY stream_version DESC
              LIMIT 1
            ),
            0
          ),
          ${request.type},
          ${request.occurredAt},
          ${request.commandId},
          ${request.causationEventId},
          ${request.correlationId},
          ${request.eventJson}
        )
        RETURNING sequence, event_json AS "eventJson"
      `,
  });

  const readEventRowsFromSequence = SqlSchema.findAll({
    Request: ReadFromSequenceRequestSchema,
    Result: TeamEventPersistedRowSchema,
    execute: (request) =>
      sql`
        SELECT sequence, event_json AS "eventJson"
        FROM team_events
        WHERE sequence > ${request.sequenceExclusive}
        ORDER BY sequence ASC
        LIMIT ${request.limit}
      `,
  });

  const append: TeamEventStoreShape["append"] = (event) =>
    appendEventRow({
      eventId: event.eventId,
      aggregateKind: event.aggregateKind,
      streamId: event.aggregateId,
      type: event.type,
      occurredAt: eventOccurredAt(event),
      commandId: event.commandId,
      causationEventId: event.causationEventId,
      correlationId: event.correlationId,
      eventJson: encodeJsonString(event),
    }).pipe(
      Effect.mapError(
        toSqlOrDecodeError("TeamEventStore.append:insert", "TeamEventStore.append:decodeRow"),
      ),
      Effect.flatMap((row) => parsePersistedEvent(row, "TeamEventStore.append:rowToEvent")),
    );

  const readFromSequence: TeamEventStoreShape["readFromSequence"] = (
    sequenceExclusive,
    limit = DEFAULT_READ_FROM_SEQUENCE_LIMIT,
  ) => {
    const normalizedLimit = Math.max(0, Math.floor(limit));
    if (normalizedLimit === 0) return Stream.empty;

    const readPage = (
      cursor: number,
      remaining: number,
    ): Stream.Stream<TeamEvent, TeamEventStoreError> =>
      Stream.fromEffect(
        readEventRowsFromSequence({
          sequenceExclusive: cursor,
          limit: Math.min(remaining, READ_PAGE_SIZE),
        }).pipe(
          Effect.mapError(
            toSqlOrDecodeError(
              "TeamEventStore.readFromSequence:query",
              "TeamEventStore.readFromSequence:decodeRows",
            ),
          ),
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              parsePersistedEvent(row, "TeamEventStore.readFromSequence:rowToEvent"),
            ),
          ),
        ),
      ).pipe(
        Stream.flatMap((events) => {
          if (events.length === 0) return Stream.empty;
          const nextRemaining = remaining - events.length;
          if (nextRemaining <= 0) return Stream.fromIterable(events);
          return Stream.concat(
            Stream.fromIterable(events),
            readPage(events[events.length - 1]!.sequence, nextRemaining),
          );
        }),
      );

    return readPage(sequenceExclusive, normalizedLimit);
  };

  return {
    append,
    readFromSequence,
    readAll: () => readFromSequence(0, READ_ALL_LIMIT),
  } satisfies TeamEventStoreShape;
});

export const TeamEventStoreLive = Layer.effect(TeamEventStore, makeTeamEventStore);
