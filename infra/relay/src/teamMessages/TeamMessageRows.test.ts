import type {
  TeamSignedDeliveryReceiptEnvelope,
  TeamSignedMessageEnvelope,
} from "@t3tools/contracts/team";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as RelayDb from "../db.ts";
import * as TeamMessageRows from "./TeamMessageRows.ts";

const envelope = {
  payload: {
    projectId: "project-1",
    messageId: "message-1",
    senderId: "human_julius",
    senderEnvironmentId: "env-sender",
    recipientId: "human_maya",
    recipientEnvironmentId: "env-recipient",
    body: "hello",
    sentAt: "2026-07-30T00:00:00.000Z",
  },
  proof: "proof-token",
} as unknown as TeamSignedMessageEnvelope;

const receiptEnvelope = {
  receipt: {
    projectId: "project-1",
    messageId: "message-1",
    senderId: "human_julius",
    senderEnvironmentId: "env-sender",
    recipientId: "human_maya",
    recipientEnvironmentId: "env-recipient",
    deliveredAt: "2026-07-30T00:00:01.000Z",
  },
  proof: "receipt-proof-token",
} as unknown as TeamSignedDeliveryReceiptEnvelope;

describe("TeamMessageRows", () => {
  it.effect("stores and drains a queued envelope for the recipient environment", () => {
    let storedEnvelopeJson: unknown = null;
    let deleted = false;
    const inMemoryDb = {
      insert: () => ({
        values: (values: { readonly envelopeJson: unknown }) =>
          Effect.sync(() => {
            storedEnvelopeJson = values.envelopeJson;
          }),
      }),
      select: () => ({
        from: () => ({
          where: () => Effect.succeed([{ id: "message-row-1", envelopeJson: storedEnvelopeJson }]),
        }),
      }),
      delete: () => ({
        where: () =>
          Effect.sync(() => {
            deleted = true;
          }),
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const rows = yield* TeamMessageRows.TeamMessageRows;
      yield* rows.enqueue({
        id: "message-row-1",
        recipientEnvironmentId: "env-recipient",
        senderEnvironmentId: "env-sender",
        envelope,
        expiresAt: "2026-07-30T01:00:00.000Z",
        createdAt: "2026-07-30T00:00:00.000Z",
      });

      const drained = yield* rows.drainForEnvironment({
        recipientEnvironmentId: "env-recipient",
        nowIso: "2026-07-30T00:30:00.000Z",
      });

      expect(drained).toEqual([envelope]);
      expect(deleted).toBe(true);
    }).pipe(
      Effect.provide(
        TeamMessageRows.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, inMemoryDb))),
      ),
    );
  });

  it.effect("stores and drains a delivery receipt for the original sender environment", () => {
    let storedEnvelopeJson: unknown = null;
    const inMemoryDb = {
      insert: () => ({
        values: (values: { readonly envelopeJson: unknown }) =>
          Effect.sync(() => {
            storedEnvelopeJson = values.envelopeJson;
          }),
      }),
      select: () => ({
        from: () => ({
          where: () => Effect.succeed([{ id: "receipt-row-1", envelopeJson: storedEnvelopeJson }]),
        }),
      }),
      delete: () => ({ where: () => Effect.void }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const rows = yield* TeamMessageRows.TeamMessageRows;
      yield* rows.enqueue({
        id: "receipt-row-1",
        recipientEnvironmentId: "env-sender",
        senderEnvironmentId: "env-recipient",
        envelope: receiptEnvelope,
        expiresAt: "2026-07-31T00:00:00.000Z",
        createdAt: "2026-07-30T00:00:01.000Z",
      });

      const drained = yield* rows.drainForEnvironment({
        recipientEnvironmentId: "env-sender",
        nowIso: "2026-07-30T00:30:00.000Z",
      });

      expect(drained).toEqual([receiptEnvelope]);
    }).pipe(
      Effect.provide(
        TeamMessageRows.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, inMemoryDb))),
      ),
    );
  });

  it.effect("preserves recipient context on persistence failures", () => {
    const cause = new Error("database unavailable");
    const failingDb = {
      insert: () => ({
        values: () => Effect.fail(cause),
      }),
      select: () => ({
        from: () => ({
          where: () => Effect.fail(cause),
        }),
      }),
      delete: () => ({
        where: () => Effect.fail(cause),
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const rows = yield* TeamMessageRows.TeamMessageRows;

      const enqueueError = yield* rows
        .enqueue({
          id: "message-row-1",
          recipientEnvironmentId: "env-recipient",
          senderEnvironmentId: "env-sender",
          envelope,
          expiresAt: "2026-07-30T01:00:00.000Z",
          createdAt: "2026-07-30T00:00:00.000Z",
        })
        .pipe(Effect.flip);
      expect(enqueueError).toMatchObject({
        recipientEnvironmentId: "env-recipient",
        cause,
      });
      expect(enqueueError.message).toBe(
        "Failed to enqueue a team message for environment env-recipient.",
      );

      const drainError = yield* rows
        .drainForEnvironment({
          recipientEnvironmentId: "env-recipient",
          nowIso: "2026-07-30T00:30:00.000Z",
        })
        .pipe(Effect.flip);
      expect(drainError).toMatchObject({
        recipientEnvironmentId: "env-recipient",
        cause,
      });
      expect(drainError.message).toBe(
        "Failed to drain queued team messages for environment env-recipient.",
      );

      const pruneError = yield* rows
        .pruneExpired({ nowIso: "2026-07-30T00:30:00.000Z" })
        .pipe(Effect.flip);
      expect(pruneError).toMatchObject({ cause });
      expect(pruneError.message).toBe("Failed to prune expired queued team messages.");
    }).pipe(
      Effect.provide(
        TeamMessageRows.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, failingDb))),
      ),
    );
  });
});
