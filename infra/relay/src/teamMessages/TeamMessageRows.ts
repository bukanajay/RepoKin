import { TeamSignedMessageEnvelope } from "@t3tools/contracts/team";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { and, eq, gt, inArray, lte } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import { relayTeamMessages } from "../persistence/schema.ts";

export class TeamMessageEnqueuePersistenceError extends Schema.TaggedErrorClass<TeamMessageEnqueuePersistenceError>()(
  "TeamMessageEnqueuePersistenceError",
  {
    recipientEnvironmentId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to enqueue a team message for environment ${this.recipientEnvironmentId}.`;
  }
}

export class TeamMessageDrainPersistenceError extends Schema.TaggedErrorClass<TeamMessageDrainPersistenceError>()(
  "TeamMessageDrainPersistenceError",
  {
    recipientEnvironmentId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to drain queued team messages for environment ${this.recipientEnvironmentId}.`;
  }
}

export class TeamMessagePrunePersistenceError extends Schema.TaggedErrorClass<TeamMessagePrunePersistenceError>()(
  "TeamMessagePrunePersistenceError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to prune expired queued team messages.";
  }
}

export class TeamMessageRows extends Context.Service<
  TeamMessageRows,
  {
    readonly enqueue: (input: {
      readonly id: string;
      readonly recipientEnvironmentId: string;
      readonly senderEnvironmentId: string;
      readonly envelope: TeamSignedMessageEnvelope;
      readonly expiresAt: string;
      readonly createdAt: string;
    }) => Effect.Effect<void, TeamMessageEnqueuePersistenceError>;
    readonly drainForEnvironment: (input: {
      readonly recipientEnvironmentId: string;
      readonly nowIso: string;
    }) => Effect.Effect<ReadonlyArray<TeamSignedMessageEnvelope>, TeamMessageDrainPersistenceError>;
    readonly pruneExpired: (input: {
      readonly nowIso: string;
    }) => Effect.Effect<void, TeamMessagePrunePersistenceError>;
  }
>()("t3code-relay/teamMessages/TeamMessageRows") {}

const decodeJsonString = Schema.decodeEffect(Schema.UnknownFromJsonString);
const encodeJsonValue = Schema.encodeEffect(Schema.UnknownFromJsonString);

const encodeEnvelopeJson = Schema.encodeEffect(Schema.fromJsonString(TeamSignedMessageEnvelope));
const decodeEnvelopeJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(TeamSignedMessageEnvelope),
);

export const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;

  return TeamMessageRows.of({
    enqueue: Effect.fn("relay.team_message_rows.enqueue")(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.recipient_environment_id": input.recipientEnvironmentId,
        "relay.sender_environment_id": input.senderEnvironmentId,
      });
      const envelopeJson = yield* encodeEnvelopeJson(input.envelope).pipe(
        Effect.flatMap(decodeJsonString),
        Effect.map(Function.cast<unknown, TeamSignedMessageEnvelope>),
        Effect.mapError(
          (cause) =>
            new TeamMessageEnqueuePersistenceError({
              recipientEnvironmentId: input.recipientEnvironmentId,
              cause,
            }),
        ),
      );
      yield* db
        .insert(relayTeamMessages)
        .values({
          id: input.id,
          recipientEnvironmentId: input.recipientEnvironmentId,
          senderEnvironmentId: input.senderEnvironmentId,
          envelopeJson,
          expiresAt: input.expiresAt,
          createdAt: input.createdAt,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TeamMessageEnqueuePersistenceError({
                recipientEnvironmentId: input.recipientEnvironmentId,
                cause,
              }),
          ),
        );
    }),

    drainForEnvironment: Effect.fn("relay.team_message_rows.drain_for_environment")(
      function* (input) {
        yield* Effect.annotateCurrentSpan({
          "relay.recipient_environment_id": input.recipientEnvironmentId,
        });
        const rows = yield* db
          .select({ id: relayTeamMessages.id, envelopeJson: relayTeamMessages.envelopeJson })
          .from(relayTeamMessages)
          .where(
            and(
              eq(relayTeamMessages.recipientEnvironmentId, input.recipientEnvironmentId),
              gt(relayTeamMessages.expiresAt, input.nowIso),
            ),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new TeamMessageDrainPersistenceError({
                  recipientEnvironmentId: input.recipientEnvironmentId,
                  cause,
                }),
            ),
          );
        if (rows.length === 0) {
          return [];
        }
        yield* db
          .delete(relayTeamMessages)
          .where(
            inArray(
              relayTeamMessages.id,
              rows.map((row) => row.id),
            ),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new TeamMessageDrainPersistenceError({
                  recipientEnvironmentId: input.recipientEnvironmentId,
                  cause,
                }),
            ),
          );
        return yield* Effect.forEach(rows, (row) => encodeJsonValue(row.envelopeJson), {
          concurrency: "unbounded",
        }).pipe(
          Effect.map((values) =>
            values.flatMap((value) => Option.toArray(decodeEnvelopeJson(value))),
          ),
          Effect.mapError(
            (cause) =>
              new TeamMessageDrainPersistenceError({
                recipientEnvironmentId: input.recipientEnvironmentId,
                cause,
              }),
          ),
        );
      },
    ),

    pruneExpired: Effect.fn("relay.team_message_rows.prune_expired")(function* (input) {
      yield* db
        .delete(relayTeamMessages)
        .where(lte(relayTeamMessages.expiresAt, input.nowIso))
        .pipe(Effect.mapError((cause) => new TeamMessagePrunePersistenceError({ cause })));
    }),
  });
});

export const layer = Layer.effect(TeamMessageRows, make);
