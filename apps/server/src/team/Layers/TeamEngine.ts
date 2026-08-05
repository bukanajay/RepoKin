import type { TeamCommand, TeamDomainReadModel, TeamEvent } from "@t3tools/contracts/team";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { TeamCommandReceiptRepository } from "../Services/TeamCommandReceipts.ts";
import { TeamEngineService, type TeamEngineShape } from "../Services/TeamEngine.ts";
import { TeamEventStore } from "../Services/TeamEventStore.ts";
import {
  TeamCommandInvariantError,
  TeamCommandPreviouslyRejectedError,
  type TeamDispatchError,
} from "../Errors.ts";
import { decideTeamCommand } from "../decider.ts";
import { createEmptyTeamReadModel, projectTeamEvent, projectTeamEvents } from "../projector.ts";

const isTeamCommandPreviouslyRejectedError = Schema.is(TeamCommandPreviouslyRejectedError);
const isTeamCommandInvariantError = Schema.is(TeamCommandInvariantError);

interface CommandEnvelope {
  readonly command: TeamCommand;
  readonly result: Deferred.Deferred<{ readonly sequence: number }, TeamDispatchError>;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const makeTeamEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* TeamEventStore;
  const receiptRepository = yield* TeamCommandReceiptRepository;
  const crypto = yield* Crypto.Crypto;

  let commandReadModel: TeamDomainReadModel = createEmptyTeamReadModel(yield* nowIso);
  const commandQueue = yield* Queue.unbounded<CommandEnvelope>();
  const eventPubSub = yield* PubSub.unbounded<TeamEvent>();

  // Bulk fold that validates once at the end — boot replay of a large history
  // must not re-decode the whole read model per event (O(n²)).
  const projectEventsOntoReadModel = (
    baseReadModel: TeamDomainReadModel,
    events: ReadonlyArray<TeamEvent>,
  ) => projectTeamEvents(baseReadModel, events);

  const processEnvelope = (envelope: CommandEnvelope): Effect.Effect<void> =>
    Effect.exit(
      Effect.gen(function* () {
        const existingReceipt = yield* receiptRepository.getByCommandId({
          commandId: envelope.command.commandId,
        });
        if (Option.isSome(existingReceipt)) {
          if (existingReceipt.value.status === "accepted") {
            return {
              sequence: existingReceipt.value.resultSequence,
            };
          }
          return yield* new TeamCommandPreviouslyRejectedError({
            commandId: envelope.command.commandId,
            detail: existingReceipt.value.error ?? "Previously rejected.",
          });
        }

        const plannedEvent = yield* decideTeamCommand({
          command: envelope.command,
          readModel: commandReadModel,
        }).pipe(Effect.provideService(Crypto.Crypto, crypto));

        const committed = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const savedEvent = yield* eventStore.append(plannedEvent);
              const nextCommandReadModel = yield* projectTeamEvent(commandReadModel, savedEvent);
              yield* receiptRepository.upsert({
                commandId: envelope.command.commandId,
                aggregateId: savedEvent.aggregateId,
                acceptedAt: yield* nowIso,
                resultSequence: savedEvent.sequence,
                status: "accepted",
                error: null,
              });
              return { savedEvent, nextCommandReadModel } as const;
            }),
          )
          .pipe(
            Effect.catchTag("SqlError", (sqlError) =>
              Effect.fail(
                toPersistenceSqlError("TeamEngine.processEnvelope:transaction")(sqlError),
              ),
            ),
          );

        commandReadModel = committed.nextCommandReadModel;
        yield* PubSub.publish(eventPubSub, committed.savedEvent);
        return { sequence: committed.savedEvent.sequence };
      }),
    ).pipe(
      Effect.flatMap((exit) =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit)) {
            yield* Deferred.succeed(envelope.result, exit.value);
            return;
          }

          const error = Cause.squash(exit.cause) as TeamDispatchError;
          if (isTeamCommandInvariantError(error) && !isTeamCommandPreviouslyRejectedError(error)) {
            yield* receiptRepository
              .upsert({
                commandId: envelope.command.commandId,
                aggregateId: envelope.command.projectId,
                acceptedAt: yield* nowIso,
                resultSequence: commandReadModel.snapshotSequence,
                status: "rejected",
                error: error.message,
              })
              .pipe(Effect.catch(() => Effect.void));
          }

          yield* Deferred.fail(envelope.result, error);
        }),
      ),
    );

  const replayedEvents = yield* Stream.runCollect(eventStore.readAll()).pipe(
    Effect.map((chunk): TeamEvent[] => Array.from(chunk)),
  );
  commandReadModel = yield* projectEventsOntoReadModel(commandReadModel, replayedEvents);

  const worker = Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope)));
  yield* Effect.forkScoped(worker);
  yield* Effect.logDebug("team engine started").pipe(
    Effect.annotateLogs({ sequence: commandReadModel.snapshotSequence }),
  );

  const dispatch: TeamEngineShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<{ readonly sequence: number }, TeamDispatchError>();
      yield* Queue.offer(commandQueue, { command, result });
      return yield* Deferred.await(result);
    });

  return {
    dispatch,
    readEvents: (fromSequenceExclusive, limit) =>
      eventStore.readFromSequence(fromSequenceExclusive, limit),
    latestSequence: Effect.sync(() => commandReadModel.snapshotSequence),
    getReadModel: Effect.sync(() => commandReadModel),
    get streamDomainEvents(): TeamEngineShape["streamDomainEvents"] {
      return Stream.fromPubSub(eventPubSub);
    },
  } satisfies TeamEngineShape;
});

export const TeamEngineLive = Layer.effect(TeamEngineService, makeTeamEngine);
