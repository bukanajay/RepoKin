import { CommandId, NonNegativeInt, ProjectId } from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type TeamCommandReceiptRepositoryError,
} from "../../persistence/Errors.ts";
import {
  TeamCommandReceiptRepository,
  type TeamCommandReceiptRepositoryShape,
} from "../Services/TeamCommandReceipts.ts";

const TeamCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);

const TeamCommandReceiptRowSchema = Schema.Struct({
  commandId: CommandId,
  aggregateId: ProjectId,
  acceptedAt: Schema.String,
  resultSequence: NonNegativeInt,
  status: TeamCommandReceiptStatus,
  error: Schema.NullOr(Schema.String),
});

const GetReceiptRequestSchema = Schema.Struct({
  commandId: CommandId,
});

function toSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): TeamCommandReceiptRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeTeamCommandReceiptRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getReceiptRow = SqlSchema.findOne({
    Request: GetReceiptRequestSchema,
    Result: TeamCommandReceiptRowSchema,
    execute: (request) =>
      sql`
        SELECT
          command_id AS "commandId",
          aggregate_id AS "aggregateId",
          accepted_at AS "acceptedAt",
          result_sequence AS "resultSequence",
          status,
          error
        FROM team_command_receipts
        WHERE command_id = ${request.commandId}
      `,
  });

  const upsertReceipt = SqlSchema.void({
    Request: TeamCommandReceiptRowSchema,
    execute: (receipt) =>
      sql`
        INSERT INTO team_command_receipts (
          command_id,
          aggregate_id,
          accepted_at,
          result_sequence,
          status,
          error
        )
        VALUES (
          ${receipt.commandId},
          ${receipt.aggregateId},
          ${receipt.acceptedAt},
          ${receipt.resultSequence},
          ${receipt.status},
          ${receipt.error}
        )
        ON CONFLICT(command_id) DO UPDATE SET
          aggregate_id = excluded.aggregate_id,
          accepted_at = excluded.accepted_at,
          result_sequence = excluded.result_sequence,
          status = excluded.status,
          error = excluded.error
      `,
  });

  const getByCommandId: TeamCommandReceiptRepositoryShape["getByCommandId"] = (input) =>
    getReceiptRow(input).pipe(
      Effect.map(Option.some),
      Effect.catchTag("NoSuchElementError", () => Effect.succeed(Option.none())),
      Effect.mapError(
        toSqlOrDecodeError(
          "TeamCommandReceipts.getByCommandId:query",
          "TeamCommandReceipts.getByCommandId:decodeRow",
        ),
      ),
    );

  const upsert: TeamCommandReceiptRepositoryShape["upsert"] = (receipt) =>
    upsertReceipt(receipt).pipe(
      Effect.mapError(
        toSqlOrDecodeError(
          "TeamCommandReceipts.upsert:query",
          "TeamCommandReceipts.upsert:decodeRequest",
        ),
      ),
    );

  return {
    getByCommandId,
    upsert,
  } satisfies TeamCommandReceiptRepositoryShape;
});

export const TeamCommandReceiptRepositoryLive = Layer.effect(
  TeamCommandReceiptRepository,
  makeTeamCommandReceiptRepository,
);
