/**
 * Signed environment-to-environment team message envelopes.
 *
 * The relay is transport only. Environments verify sender identity against the
 * roster public key before converting an envelope into a local inbox command.
 *
 * @module SignedMessaging
 */
import { CommandId } from "@t3tools/contracts";
import {
  type HumanProfile,
  type TeamMessageDeliverCommand,
  type TeamMessageSendCommand,
  TeamSignedDeliveryReceiptPayload,
  type TeamSignedDeliveryReceiptEnvelope,
  TeamSignedDeliveryReceiptProofPayload,
  TeamSignedMessagePayload,
  type TeamSignedMessageEnvelope,
  TeamSignedMessageProofPayload,
  type TeamRosterReadModel,
} from "@t3tools/contracts/team";
import {
  RELAY_TEAM_DELIVERY_RECEIPT_TYP,
  RELAY_TEAM_MESSAGE_TYP,
  normalizeRelayIssuer,
  signRelayJwt,
  verifyRelayJwt,
} from "@t3tools/shared/relayJwt";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeSignedMessagePayload = Schema.decodeUnknownEffect(TeamSignedMessagePayload);
const decodeSignedMessageProofPayload = Schema.decodeUnknownEffect(TeamSignedMessageProofPayload);
const decodeSignedDeliveryReceiptPayload = Schema.decodeUnknownEffect(
  TeamSignedDeliveryReceiptPayload,
);
const decodeSignedDeliveryReceiptProofPayload = Schema.decodeUnknownEffect(
  TeamSignedDeliveryReceiptProofPayload,
);
const TEAM_RELAY_ENVELOPE_LIFETIME = { hours: 24 } as const;

export type TeamSignedMessageDropReason =
  | "payload-decode-failed"
  | "sender-not-in-roster"
  | "sender-environment-key-not-found"
  | "proof-invalid"
  | "payload-mismatch";

export interface TeamSignedMessageAccepted {
  readonly _tag: "accepted";
  readonly command: TeamMessageSendCommand;
  readonly proof: TeamSignedMessageProofPayload;
  readonly senderPublicKey: string;
}

export interface TeamSignedMessageDropped {
  readonly _tag: "dropped";
  readonly reason: TeamSignedMessageDropReason;
  readonly detail: string;
}

export type TeamSignedMessageVerificationResult =
  | TeamSignedMessageAccepted
  | TeamSignedMessageDropped;

export interface TeamSignedDeliveryReceiptAccepted {
  readonly _tag: "accepted";
  readonly command: TeamMessageDeliverCommand;
  readonly proof: TeamSignedDeliveryReceiptProofPayload;
  readonly signerPublicKey: string;
}

export type TeamSignedDeliveryReceiptVerificationResult =
  | TeamSignedDeliveryReceiptAccepted
  | TeamSignedMessageDropped;

const dropped = (
  reason: TeamSignedMessageDropReason,
  detail: string,
): TeamSignedMessageDropped => ({
  _tag: "dropped",
  reason,
  detail,
});

function findHuman(roster: TeamRosterReadModel, humanId: string): HumanProfile | null {
  return roster.humans.find((human) => human.id === humanId) ?? null;
}

export function resolveRosterPublicKeyForMember(input: {
  readonly roster: TeamRosterReadModel;
  readonly memberId: string;
  readonly environmentId: string;
}): { readonly publicKey: string } | TeamSignedMessageDropped {
  if (input.memberId.startsWith("human_")) {
    const human = findHuman(input.roster, input.memberId);
    if (human === null) {
      return dropped("sender-not-in-roster", `Sender ${input.memberId} is not in the roster.`);
    }
    const environment = human.environments?.find(
      (candidate) => candidate.environmentId === input.environmentId,
    );
    return environment === undefined
      ? dropped(
          "sender-environment-key-not-found",
          `Sender ${input.memberId} has no roster key for ${input.environmentId}.`,
        )
      : { publicKey: environment.publicKey };
  }

  const agent = input.roster.agents.find((candidate) => candidate.id === input.memberId);
  if (agent === undefined) {
    return dropped("sender-not-in-roster", `Sender ${input.memberId} is not in the roster.`);
  }
  if (agent.homeEnvironment !== input.environmentId) {
    return dropped(
      "sender-environment-key-not-found",
      `Agent ${input.memberId} is not registered at ${input.environmentId}.`,
    );
  }

  const owner = findHuman(input.roster, agent.owner);
  const environment = owner?.environments?.find(
    (candidate) => candidate.environmentId === input.environmentId,
  );
  return environment === undefined
    ? dropped(
        "sender-environment-key-not-found",
        `Agent ${input.memberId} owner has no roster key for ${input.environmentId}.`,
      )
    : { publicKey: environment.publicKey };
}

export function signedMessagePayloadToCommand(
  payload: TeamSignedMessagePayload,
): TeamMessageSendCommand {
  return {
    commandId: CommandId.make(`team:remote:${payload.messageId}`),
    projectId: payload.projectId,
    type: "team.message.send",
    messageId: payload.messageId,
    senderId: payload.senderId,
    recipientId: payload.recipientId,
    body: payload.body,
    ...(payload.threadId === undefined ? {} : { threadId: payload.threadId }),
    ...(payload.expiresAt === undefined ? {} : { expiresAt: payload.expiresAt }),
    metadata: {
      actorMemberId: payload.senderId,
      environmentId: payload.senderEnvironmentId,
    },
  };
}

export function signedDeliveryReceiptPayloadToCommand(
  payload: TeamSignedDeliveryReceiptPayload,
): TeamMessageDeliverCommand {
  return {
    commandId: CommandId.make(
      `team:remote-receipt:${payload.messageId}:${payload.recipientEnvironmentId}`,
    ),
    projectId: payload.projectId,
    type: "team.message.deliver",
    messageId: payload.messageId,
    metadata: {
      actorMemberId: payload.recipientId,
      environmentId: payload.recipientEnvironmentId,
    },
  };
}

export const signTeamMessageEnvelope = Effect.fn("TeamSignedMessaging.signEnvelope")(
  function* (input: {
    readonly privateKey: string;
    readonly relayIssuer: string;
    readonly payload: TeamSignedMessagePayload;
    readonly jti: string;
    readonly now?: DateTime.Utc;
  }) {
    const now = input.now ?? (yield* DateTime.now);
    const expiresAt = DateTime.add(now, TEAM_RELAY_ENVELOPE_LIFETIME);
    const proofPayload = {
      iss: `t3-env:${input.payload.senderEnvironmentId}`,
      aud: normalizeRelayIssuer(input.relayIssuer),
      sub: input.payload.senderEnvironmentId,
      jti: input.jti,
      iat: Math.floor(now.epochMilliseconds / 1_000),
      exp: Math.floor(expiresAt.epochMilliseconds / 1_000),
      senderEnvironmentId: input.payload.senderEnvironmentId,
      recipientEnvironmentId: input.payload.recipientEnvironmentId,
      message: input.payload,
    } satisfies TeamSignedMessageProofPayload;
    const proof = yield* signRelayJwt({
      privateKey: input.privateKey,
      typ: RELAY_TEAM_MESSAGE_TYP,
      payload: proofPayload,
    });
    return { payload: input.payload, proof };
  },
);

export const signTeamDeliveryReceiptEnvelope = Effect.fn(
  "TeamSignedMessaging.signDeliveryReceiptEnvelope",
)(function* (input: {
  readonly privateKey: string;
  readonly relayIssuer: string;
  readonly receipt: TeamSignedDeliveryReceiptPayload;
  readonly jti: string;
  readonly now?: DateTime.Utc;
}) {
  const now = input.now ?? (yield* DateTime.now);
  const expiresAt = DateTime.add(now, TEAM_RELAY_ENVELOPE_LIFETIME);
  const proofPayload = {
    iss: `t3-env:${input.receipt.recipientEnvironmentId}`,
    aud: normalizeRelayIssuer(input.relayIssuer),
    sub: input.receipt.recipientEnvironmentId,
    jti: input.jti,
    iat: Math.floor(now.epochMilliseconds / 1_000),
    exp: Math.floor(expiresAt.epochMilliseconds / 1_000),
    senderEnvironmentId: input.receipt.senderEnvironmentId,
    recipientEnvironmentId: input.receipt.recipientEnvironmentId,
    receipt: input.receipt,
  } satisfies TeamSignedDeliveryReceiptProofPayload;
  const proof = yield* signRelayJwt({
    privateKey: input.privateKey,
    typ: RELAY_TEAM_DELIVERY_RECEIPT_TYP,
    payload: proofPayload,
  });
  return { receipt: input.receipt, proof };
});

export const verifyTeamMessageEnvelope = Effect.fn("TeamSignedMessaging.verifyEnvelope")(
  function* (input: {
    readonly envelope: TeamSignedMessageEnvelope;
    readonly roster: TeamRosterReadModel;
    readonly relayIssuer: string;
    readonly nowEpochSeconds: number;
  }) {
    const payloadOption = yield* decodeSignedMessagePayload(input.envelope.payload).pipe(
      Effect.option,
    );
    if (Option.isNone(payloadOption)) {
      return dropped("payload-decode-failed", "The signed team message payload is malformed.");
    }

    const payload = payloadOption.value;
    const publicKeyResult = resolveRosterPublicKeyForMember({
      roster: input.roster,
      memberId: payload.senderId,
      environmentId: payload.senderEnvironmentId,
    });
    if ("_tag" in publicKeyResult) {
      return publicKeyResult;
    }

    const proofOption = yield* verifyRelayJwt({
      publicKey: publicKeyResult.publicKey,
      token: input.envelope.proof,
      typ: RELAY_TEAM_MESSAGE_TYP,
      issuer: `t3-env:${payload.senderEnvironmentId}`,
      audience: normalizeRelayIssuer(input.relayIssuer),
      nowEpochSeconds: input.nowEpochSeconds,
      maxTokenAge: "24 hours",
    }).pipe(Effect.flatMap(decodeSignedMessageProofPayload), Effect.option);
    if (Option.isNone(proofOption)) {
      return dropped("proof-invalid", "The signed team message proof did not verify.");
    }

    const proof = proofOption.value;
    if (
      proof.senderEnvironmentId !== payload.senderEnvironmentId ||
      proof.recipientEnvironmentId !== payload.recipientEnvironmentId ||
      !Equal.equals(proof.message, payload)
    ) {
      return dropped("payload-mismatch", "The signed proof does not cover the envelope payload.");
    }

    return {
      _tag: "accepted",
      command: signedMessagePayloadToCommand(payload),
      proof,
      senderPublicKey: publicKeyResult.publicKey,
    } satisfies TeamSignedMessageAccepted;
  },
);

export const verifyTeamDeliveryReceiptEnvelope = Effect.fn(
  "TeamSignedMessaging.verifyDeliveryReceiptEnvelope",
)(function* (input: {
  readonly envelope: TeamSignedDeliveryReceiptEnvelope;
  readonly roster: TeamRosterReadModel;
  readonly relayIssuer: string;
  readonly nowEpochSeconds: number;
}) {
  const receiptOption = yield* decodeSignedDeliveryReceiptPayload(input.envelope.receipt).pipe(
    Effect.option,
  );
  if (Option.isNone(receiptOption)) {
    return dropped("payload-decode-failed", "The signed delivery receipt is malformed.");
  }

  const receipt = receiptOption.value;
  const publicKeyResult = resolveRosterPublicKeyForMember({
    roster: input.roster,
    memberId: receipt.recipientId,
    environmentId: receipt.recipientEnvironmentId,
  });
  if ("_tag" in publicKeyResult) {
    return publicKeyResult;
  }

  const proofOption = yield* verifyRelayJwt({
    publicKey: publicKeyResult.publicKey,
    token: input.envelope.proof,
    typ: RELAY_TEAM_DELIVERY_RECEIPT_TYP,
    issuer: `t3-env:${receipt.recipientEnvironmentId}`,
    audience: normalizeRelayIssuer(input.relayIssuer),
    nowEpochSeconds: input.nowEpochSeconds,
    maxTokenAge: "24 hours",
  }).pipe(Effect.flatMap(decodeSignedDeliveryReceiptProofPayload), Effect.option);
  if (Option.isNone(proofOption)) {
    return dropped("proof-invalid", "The signed delivery receipt proof did not verify.");
  }

  const proof = proofOption.value;
  if (
    proof.senderEnvironmentId !== receipt.senderEnvironmentId ||
    proof.recipientEnvironmentId !== receipt.recipientEnvironmentId ||
    !Equal.equals(proof.receipt, receipt)
  ) {
    return dropped("payload-mismatch", "The signed proof does not cover the delivery receipt.");
  }

  return {
    _tag: "accepted",
    command: signedDeliveryReceiptPayloadToCommand(receipt),
    proof,
    signerPublicKey: publicKeyResult.publicKey,
  } satisfies TeamSignedDeliveryReceiptAccepted;
});
