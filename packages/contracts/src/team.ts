/**
 * RepoKin team contracts — roster, character, and compiled character shapes.
 *
 * Lives on the `./team` subpath export so it never touches the main contracts
 * barrel (fork-policy: additive only). Schema only; no runtime logic.
 *
 * Repository layout (see PRD §7):
 *   .repokin/team.json
 *   .repokin/humans/<slug>.json
 *   .repokin/agents/<slug>.json
 *
 * @module team
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  CommandId,
  EnvironmentId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProviderInteractionMode,
  RuntimeMode,
} from "./orchestration.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

// ---------------------------------------------------------------------------
// Paths and published schema URLs
// ---------------------------------------------------------------------------

/** Directory at the repository root that holds the team roster. */
export const REPOKIN_DIR_NAME = ".repokin";

/** Team-level config file name under {@link REPOKIN_DIR_NAME}. */
export const TEAM_FILE_NAME = "team.json";

/** Subdirectory of human member profiles. */
export const TEAM_HUMANS_DIR_NAME = "humans";

/** Subdirectory of agent member profiles. */
export const TEAM_AGENTS_DIR_NAME = "agents";

export const TEAM_FILE_SCHEMA_URL = "https://repokin.dev/schema/team.json";
export const HUMAN_PROFILE_SCHEMA_URL = "https://repokin.dev/schema/human.json";
export const AGENT_PROFILE_SCHEMA_URL = "https://repokin.dev/schema/agent.json";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const MEMBER_SLUG_MAX_CHARS = 64;
/**
 * Same slug rules as provider instance ids: letter-first, then letters, digits,
 * `-`, `_`. Used for member / agent / human ids and profile file stems.
 */
const MEMBER_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

const memberSlugSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MEMBER_SLUG_MAX_CHARS),
  Schema.isPattern(MEMBER_SLUG_PATTERN),
);

/**
 * Preserve unknown keys on decode → encode so teammates on newer builds do not
 * lose fields when an older build rewrites a profile (PRD FR-2.4).
 */
const preserveUnknownFields = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "preserve" } });

// Annotations go on the encoded (string) side so they survive into the
// published JSON Schema; decoding still trims and re-validates non-emptiness.
const trimmedNonEmpty = (annotations: { readonly description: string }, maxLength?: number) => {
  const annotated = Schema.String.annotate(annotations);
  const encoded =
    maxLength === undefined
      ? annotated.check(Schema.isNonEmpty())
      : annotated.check(Schema.isNonEmpty(), Schema.isMaxLength(maxLength));
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

const trimmedStringList = (annotations: { readonly description: string }) =>
  Schema.Array(trimmedNonEmpty(annotations)).annotate(annotations);

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Any roster member (human or agent). */
export const MemberId = memberSlugSchema.pipe(Schema.brand("MemberId"));
export type MemberId = typeof MemberId.Type;

/** Persistent agent member id (filename stem is a convenience; id is authoritative). */
export const AgentId = memberSlugSchema.pipe(Schema.brand("AgentId"));
export type AgentId = typeof AgentId.Type;

/** Human member id. */
export const HumanId = memberSlugSchema.pipe(Schema.brand("HumanId"));
export type HumanId = typeof HumanId.Type;

const isMemberIdValue = Schema.is(MemberId);
export const isMemberId = (value: unknown): value is MemberId => isMemberIdValue(value);

const isAgentIdValue = Schema.is(AgentId);
export const isAgentId = (value: unknown): value is AgentId => isAgentIdValue(value);

const isHumanIdValue = Schema.is(HumanId);
export const isHumanId = (value: unknown): value is HumanId => isHumanIdValue(value);

// ---------------------------------------------------------------------------
// Character — expressive half (influences the model) + mechanical half (enforced)
// ---------------------------------------------------------------------------

export const CHARACTER_VERSION = 1 as const;

export const CharacterVersion = Schema.Literal(CHARACTER_VERSION).annotate({
  description: "Schema version for the character object. Evolve additively only.",
});
export type CharacterVersion = typeof CharacterVersion.Type;

export const CharacterCommunicationVerbosity = Schema.Literals([
  "terse",
  "normal",
  "verbose",
]).annotate({
  description: "How chatty the agent is when reporting work.",
});
export type CharacterCommunicationVerbosity = typeof CharacterCommunicationVerbosity.Type;

export const CharacterCommunication = preserveUnknownFields(
  Schema.Struct({
    verbosity: Schema.optionalKey(
      CharacterCommunicationVerbosity.annotate({
        description: "Preferred verbosity when the agent reports progress or results.",
      }),
    ),
    reportsWith: Schema.optionalKey(
      trimmedNonEmpty({
        description:
          'Preferred report shape, e.g. "diff-first", "summary-first", free prose accepted.',
      }),
    ),
  }).annotate({
    description: "How the agent communicates (expressive half).",
  }),
);
export type CharacterCommunication = typeof CharacterCommunication.Type;

/**
 * Preferred provider driver + model. This is mechanical: the harness applies it
 * at session start. Credentials never live here — only preference.
 */
export const CharacterProviderPreference = preserveUnknownFields(
  Schema.Struct({
    driver: ProviderDriverKind.annotate({
      description: "Preferred provider driver kind (e.g. codex, claudeAgent).",
    }),
    model: Schema.optionalKey(
      trimmedNonEmpty({
        description: "Preferred model id for the driver, when the driver supports selection.",
      }),
    ),
  }).annotate({
    description: "Provider driver and model preference for this agent (mechanical).",
  }),
);
export type CharacterProviderPreference = typeof CharacterProviderPreference.Type;

/**
 * Allow/deny lists for MCP servers and tool families. Exact vocabulary is
 * driver-specific; strings are opaque at the contracts layer.
 */
export const CharacterToolPolicy = preserveUnknownFields(
  Schema.Struct({
    allow: Schema.optionalKey(
      trimmedStringList({
        description: "Tool or MCP family patterns the agent may use.",
      }),
    ),
    deny: Schema.optionalKey(
      trimmedStringList({
        description: "Tool or MCP family patterns the agent must not use.",
      }),
    ),
  }).annotate({
    description: "Tool policy applied by the harness (mechanical).",
  }),
);
export type CharacterToolPolicy = typeof CharacterToolPolicy.Type;

/**
 * Default mechanical runtime mode for untrusted / never-trusted agents.
 * Safer than the product-wide session default (`full-access`).
 */
export const DEFAULT_CHARACTER_RUNTIME_MODE: RuntimeMode = "approval-required";

/**
 * Character is versioned and has two halves:
 * - expressive: persona, expertise, conventions, communication
 * - mechanical: provider, runtimeMode, interactionMode, toolPolicy, pathScope
 *
 * Mechanical settings are enforced by the harness; expressive settings influence
 * the model via compiled instructions.
 */
export const Character = preserveUnknownFields(
  Schema.Struct({
    characterVersion: CharacterVersion,

    // --- expressive half ----------------------------------------------------
    persona: Schema.optionalKey(
      trimmedNonEmpty({
        description: "Free prose: voice, disposition, and how the agent approaches work.",
      }),
    ),
    expertise: Schema.optionalKey(
      trimmedStringList({
        description: "Domains and stacks the agent specializes in.",
      }),
    ),
    conventions: Schema.optionalKey(
      trimmedStringList({
        description: "Coding style and review preferences.",
      }),
    ),
    communication: Schema.optionalKey(CharacterCommunication),

    // --- mechanical half ----------------------------------------------------
    provider: Schema.optionalKey(CharacterProviderPreference),
    runtimeMode: Schema.optionalKey(
      RuntimeMode.annotate({
        description:
          "Harness runtime mode for sessions started as this agent. Defaults to approval-required when unset and untrusted.",
      }),
    ),
    interactionMode: Schema.optionalKey(
      ProviderInteractionMode.annotate({
        description: 'Interaction mode for sessions started as this agent ("default" or "plan").',
      }),
    ),
    toolPolicy: Schema.optionalKey(CharacterToolPolicy),
    pathScope: Schema.optionalKey(
      trimmedStringList({
        description:
          "Repository globs the agent may modify (e.g. apps/web/**). Empty/omitted means no extra path restriction beyond harness defaults.",
      }),
    ),
  }).annotate({
    title: "Agent character",
    description:
      "Versioned definition of how an agent behaves: expressive prose plus mechanical harness settings.",
  }),
);
export type Character = typeof Character.Type;

// ---------------------------------------------------------------------------
// Member profiles (Git-resident; no secrets ever)
// ---------------------------------------------------------------------------

export const MemberType = Schema.Literals(["human", "agent"]).annotate({
  description: 'Discriminator for member profiles: "human" or "agent".',
});
export type MemberType = typeof MemberType.Type;

export const MemberAvatar = preserveUnknownFields(
  Schema.Struct({
    accentColor: Schema.optionalKey(
      trimmedNonEmpty({
        description: 'Accent color for the member (e.g. "#7C5CFF").',
      }),
    ),
    imageUrl: Schema.optionalKey(
      trimmedNonEmpty({
        description: "Optional avatar image URL. Never a data: URL of credentials.",
      }),
    ),
  }).annotate({
    description: "Visual identity for a member in the roster UI.",
  }),
);
export type MemberAvatar = typeof MemberAvatar.Type;

/**
 * Public key of an environment that is authorized to act as this human on the
 * wire. Secrets and private keys never appear here.
 */
export const HumanEnvironmentKey = preserveUnknownFields(
  Schema.Struct({
    environmentId: EnvironmentId.annotate({
      description: "Environment id that holds the matching private key.",
    }),
    label: Schema.optionalKey(
      trimmedNonEmpty({
        description: 'Human-readable label for the machine (e.g. "julius-mbp").',
      }),
    ),
    publicKey: trimmedNonEmpty({
      description: "Environment public key used to verify signed envelopes from this member.",
    }),
  }).annotate({
    description: "One environment identity registered for a human member.",
  }),
);
export type HumanEnvironmentKey = typeof HumanEnvironmentKey.Type;

export const HumanProfile = preserveUnknownFields(
  Schema.Struct({
    $schema: Schema.optionalKey(
      Schema.String.annotate({
        description: `URL of the JSON Schema for this file, typically "${HUMAN_PROFILE_SCHEMA_URL}".`,
      }),
    ),
    schemaVersion: Schema.Literal(1).annotate({
      description: "Profile schema version. Evolve additively only.",
    }),
    id: HumanId.annotate({
      description: "Stable human member id. Authoritative over the filename.",
    }),
    type: Schema.Literal("human").annotate({
      description: 'Always "human" for human profiles.',
    }),
    displayName: trimmedNonEmpty({
      description: "Display name shown in the roster and attribution.",
    }),
    gitEmails: Schema.Array(
      trimmedNonEmpty({
        description: "Git email addresses that identify this human in commits and git config.",
      }),
    ).annotate({
      description: "One or more git emails for this human. Primary identity anchor.",
    }),
    bio: Schema.optionalKey(
      trimmedNonEmpty({
        description: "Optional short bio.",
      }),
    ),
    pronouns: Schema.optionalKey(
      trimmedNonEmpty({
        description: "Optional pronouns.",
      }),
    ),
    avatar: Schema.optionalKey(MemberAvatar),
    environments: Schema.optionalKey(
      Schema.Array(HumanEnvironmentKey).annotate({
        description: "Environment public keys this human operates from.",
      }),
    ),
    createdAt: Schema.optionalKey(IsoDateTime),
    updatedAt: Schema.optionalKey(IsoDateTime),
  }).annotate({
    title: "Human member profile",
    description:
      "Checked-in human member profile under .repokin/humans/. No secrets, tokens, or private keys.",
  }),
);
export type HumanProfile = typeof HumanProfile.Type;

export const AgentProfile = preserveUnknownFields(
  Schema.Struct({
    $schema: Schema.optionalKey(
      Schema.String.annotate({
        description: `URL of the JSON Schema for this file, typically "${AGENT_PROFILE_SCHEMA_URL}".`,
      }),
    ),
    schemaVersion: Schema.Literal(1).annotate({
      description: "Profile schema version. Evolve additively only.",
    }),
    id: AgentId.annotate({
      description: "Stable agent member id. Authoritative over the filename.",
    }),
    type: Schema.Literal("agent").annotate({
      description: 'Always "agent" for agent profiles.',
    }),
    name: trimmedNonEmpty({
      description: "Display name of the agent (e.g. Aria).",
    }),
    owner: HumanId.annotate({
      description: "Human member accountable for this agent.",
    }),
    homeEnvironment: Schema.optionalKey(
      EnvironmentId.annotate({
        description: "Environment id where this agent normally runs.",
      }),
    ),
    avatar: Schema.optionalKey(MemberAvatar),
    character: Character.annotate({
      description: "Expressive and mechanical character definition for this agent.",
    }),
    createdAt: Schema.optionalKey(IsoDateTime),
    updatedAt: Schema.optionalKey(IsoDateTime),
  }).annotate({
    title: "Agent member profile",
    description:
      "Checked-in agent profile under .repokin/agents/. Character only — never provider credentials or sensitive env vars.",
  }),
);
export type AgentProfile = typeof AgentProfile.Type;

export const MemberProfile = Schema.Union([HumanProfile, AgentProfile]).annotate({
  description: "A human or agent profile from the team roster.",
});
export type MemberProfile = typeof MemberProfile.Type;

// ---------------------------------------------------------------------------
// Team file
// ---------------------------------------------------------------------------

export const TeamFile = preserveUnknownFields(
  Schema.Struct({
    $schema: Schema.optionalKey(
      Schema.String.annotate({
        description: `URL of the JSON Schema for this file, typically "${TEAM_FILE_SCHEMA_URL}".`,
      }),
    ),
    schemaVersion: Schema.Literal(1).annotate({
      description: "Team file schema version. Evolve additively only.",
    }),
    /**
     * Explicit team remote name or URL. Never silently inferred at write time;
     * defaults may be suggested in the UI (PRD Q4).
     */
    teamRemote: Schema.optionalKey(
      trimmedNonEmpty({
        description:
          "Git remote name or URL whose default branch holds the canonical roster (e.g. origin).",
      }),
    ),
    displayName: Schema.optionalKey(
      trimmedNonEmpty({
        description: "Optional team display name for the roster UI.",
      }),
    ),
  }).annotate({
    title: "RepoKin team file",
    description:
      "Team-level config at .repokin/team.json. Roster members live as separate files under humans/ and agents/.",
  }),
);
export type TeamFile = typeof TeamFile.Type;

// ---------------------------------------------------------------------------
// Compiled character — runtime only (never written to Git)
// ---------------------------------------------------------------------------

/**
 * Mechanical settings after compilation, ready for the harness to apply at
 * session start. Safe defaults are filled where the profile omitted them.
 */
export const CompiledCharacterMechanics = Schema.Struct({
  provider: Schema.optionalKey(CharacterProviderPreference),
  runtimeMode: RuntimeMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CHARACTER_RUNTIME_MODE)),
  ),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  toolPolicy: Schema.optionalKey(CharacterToolPolicy),
  pathScope: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
}).annotate({
  description: "Mechanical half of a character after compilation (harness-enforced).",
});
export type CompiledCharacterMechanics = typeof CompiledCharacterMechanics.Type;

/**
 * Output of CharacterCompiler. Adapters splice `instructions` into their
 * native instruction path; the harness applies `mechanics` at session start.
 */
export const CompiledCharacter = Schema.Struct({
  agentId: AgentId,
  characterVersion: CharacterVersion,
  /** Per-driver instruction text. Drivers not present are unsupported for expressive half. */
  instructionsByDriver: Schema.Record(ProviderDriverKind, Schema.String),
  mechanics: CompiledCharacterMechanics,
  /** Hash of the mechanical half used for the trust prompt (PRD §6.5). */
  mechanicalHash: TrimmedNonEmptyString,
}).annotate({
  description:
    "Compiler output consumed by provider adapters and the session harness. Not stored in Git.",
});
export type CompiledCharacter = typeof CompiledCharacter.Type;

export const TeamInstructionPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  agentId: AgentId,
  driver: ProviderDriverKind,
}).annotate({
  description: "Preview the provider-specific instruction text compiled for one RepoKin agent.",
});
export type TeamInstructionPreviewInput = typeof TeamInstructionPreviewInput.Type;

export const TeamInstructionPreviewResult = Schema.Struct({
  agentId: AgentId,
  characterVersion: CharacterVersion,
  driver: ProviderDriverKind,
  instructions: TrimmedNonEmptyString,
  mechanics: CompiledCharacterMechanics,
  mechanicalHash: TrimmedNonEmptyString,
}).annotate({
  description:
    "Provider-specific RepoKin instruction preview plus the mechanical settings/hash for trust UI.",
});
export type TeamInstructionPreviewResult = typeof TeamInstructionPreviewResult.Type;

export class TeamInstructionPreviewError extends Schema.TaggedErrorClass<TeamInstructionPreviewError>()(
  "TeamInstructionPreviewError",
  {
    reason: Schema.Literals([
      "roster-read-failed",
      "agent-not-found",
      "driver-unsupported",
      "compile-failed",
    ]),
    cwd: Schema.String,
    agentId: AgentId,
    driver: ProviderDriverKind,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export const TeamRosterReadInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
}).annotate({
  description: "Read the RepoKin roster from one working-tree repository.",
});
export type TeamRosterReadInput = typeof TeamRosterReadInput.Type;

export class TeamRosterReadError extends Schema.TaggedErrorClass<TeamRosterReadError>()(
  "TeamRosterReadError",
  {
    cwd: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

// ---------------------------------------------------------------------------
// Thin team domain shapes (M1 read models / M2 commands) — schema only
// ---------------------------------------------------------------------------

export const AgentRuntimeBinding = Schema.Struct({
  agentId: AgentId,
  /** Local provider instance that runs this agent in this environment. */
  providerInstanceId: ProviderInstanceId,
}).annotate({
  description:
    "Environment-local binding of an agent to a provider instance. Never committed to Git.",
});
export type AgentRuntimeBinding = typeof AgentRuntimeBinding.Type;

export const TeamRosterReadModel = Schema.Struct({
  team: Schema.optionalKey(TeamFile),
  humans: Schema.Array(HumanProfile),
  agents: Schema.Array(AgentProfile),
  /** Paths or ids of profiles that failed to decode; never fatal. */
  warnings: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([] as string[] as readonly string[])),
  ),
}).annotate({
  description: "In-memory roster snapshot projected from .repokin/.",
});
export type TeamRosterReadModel = typeof TeamRosterReadModel.Type;

export const TeamProfileWriteResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  committed: Schema.Boolean,
}).annotate({
  description: "Result of writing one RepoKin profile file.",
});
export type TeamProfileWriteResult = typeof TeamProfileWriteResult.Type;

export const TeamAgentUpsertInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  profile: AgentProfile,
  /**
   * UI writes default to local-only. Committed roster publishing becomes an
   * explicit M1.7/M3 action instead of a surprise side effect.
   */
  commit: Schema.optionalKey(Schema.Boolean),
}).annotate({
  description: "Create or update one agent profile in the selected repository's .repokin tree.",
});
export type TeamAgentUpsertInput = typeof TeamAgentUpsertInput.Type;

export const TeamAgentUpsertResult = Schema.Struct({
  write: TeamProfileWriteResult,
  roster: TeamRosterReadModel,
}).annotate({
  description: "Profile write metadata plus the refreshed RepoKin roster.",
});
export type TeamAgentUpsertResult = typeof TeamAgentUpsertResult.Type;

export class TeamAgentUpsertError extends Schema.TaggedErrorClass<TeamAgentUpsertError>()(
  "TeamAgentUpsertError",
  {
    reason: Schema.Literals(["write-failed", "roster-read-failed"]),
    cwd: Schema.String,
    agentId: AgentId,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export const TeamFileUpdateInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  team: TeamFile,
  commit: Schema.optionalKey(Schema.Boolean),
}).annotate({
  description: "Create or update the selected repository's .repokin/team.json file.",
});
export type TeamFileUpdateInput = typeof TeamFileUpdateInput.Type;

export const TeamFileUpdateResult = Schema.Struct({
  write: TeamProfileWriteResult,
  roster: TeamRosterReadModel,
}).annotate({
  description: "Team file write metadata plus the refreshed RepoKin roster.",
});
export type TeamFileUpdateResult = typeof TeamFileUpdateResult.Type;

export class TeamFileUpdateError extends Schema.TaggedErrorClass<TeamFileUpdateError>()(
  "TeamFileUpdateError",
  {
    reason: Schema.Literals(["write-failed", "roster-read-failed"]),
    cwd: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export const TeamRosterSyncInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
}).annotate({
  description: "Fetch and read the explicitly configured RepoKin team remote roster.",
});
export type TeamRosterSyncInput = typeof TeamRosterSyncInput.Type;

export const TeamRosterSyncResult = Schema.Struct({
  remote: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  roster: TeamRosterReadModel,
}).annotate({
  description: "Fetched remote roster details plus the decoded RepoKin roster.",
});
export type TeamRosterSyncResult = typeof TeamRosterSyncResult.Type;

export class TeamRosterSyncError extends Schema.TaggedErrorClass<TeamRosterSyncError>()(
  "TeamRosterSyncError",
  {
    reason: Schema.Literals([
      "team-remote-missing",
      "default-branch-unresolved",
      "fetch-failed",
      "roster-read-failed",
    ]),
    cwd: Schema.String,
    remote: Schema.optionalKey(Schema.String),
    branch: Schema.optionalKey(Schema.String),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

const TeamSignedJwtRegisteredClaims = {
  iss: TrimmedNonEmptyString,
  aud: TrimmedNonEmptyString,
  sub: TrimmedNonEmptyString,
  jti: TrimmedNonEmptyString,
  iat: Schema.Int,
  exp: Schema.Int,
} as const;

export const TeamSignedMessagePayload = Schema.Struct({
  projectId: ProjectId,
  messageId: MessageId,
  senderId: MemberId,
  senderEnvironmentId: EnvironmentId,
  recipientId: MemberId,
  recipientEnvironmentId: EnvironmentId,
  body: trimmedNonEmpty({
    description: "Direct message body carried over the signed team transport.",
  }),
  threadId: Schema.optionalKey(ThreadId),
  sentAt: IsoDateTime,
  expiresAt: Schema.optionalKey(IsoDateTime),
}).annotate({
  description: "Environment-to-environment team message covered by an environment signature.",
});
export type TeamSignedMessagePayload = typeof TeamSignedMessagePayload.Type;

export const TeamSignedMessageProofPayload = Schema.Struct({
  ...TeamSignedJwtRegisteredClaims,
  senderEnvironmentId: EnvironmentId,
  recipientEnvironmentId: EnvironmentId,
  message: TeamSignedMessagePayload,
}).annotate({
  description: "JWT payload signed by the sender environment for a team message.",
});
export type TeamSignedMessageProofPayload = typeof TeamSignedMessageProofPayload.Type;

export const TeamSignedMessageEnvelope = Schema.Struct({
  payload: TeamSignedMessagePayload,
  proof: TrimmedNonEmptyString,
}).annotate({
  description: "Relay-transported signed team message envelope.",
});
export type TeamSignedMessageEnvelope = typeof TeamSignedMessageEnvelope.Type;

export const TeamSignedDeliveryReceiptPayload = Schema.Struct({
  projectId: ProjectId,
  messageId: MessageId,
  senderId: MemberId,
  senderEnvironmentId: EnvironmentId,
  recipientId: MemberId,
  recipientEnvironmentId: EnvironmentId,
  deliveredAt: IsoDateTime,
}).annotate({
  description: "Recipient-confirmed delivery details returned to the original sender environment.",
});
export type TeamSignedDeliveryReceiptPayload = typeof TeamSignedDeliveryReceiptPayload.Type;

export const TeamSignedDeliveryReceiptProofPayload = Schema.Struct({
  ...TeamSignedJwtRegisteredClaims,
  senderEnvironmentId: EnvironmentId,
  recipientEnvironmentId: EnvironmentId,
  receipt: TeamSignedDeliveryReceiptPayload,
}).annotate({
  description: "JWT payload signed by the recipient environment for a delivery receipt.",
});
export type TeamSignedDeliveryReceiptProofPayload =
  typeof TeamSignedDeliveryReceiptProofPayload.Type;

export const TeamSignedDeliveryReceiptEnvelope = Schema.Struct({
  receipt: TeamSignedDeliveryReceiptPayload,
  proof: TrimmedNonEmptyString,
}).annotate({
  description: "Relay-transported signed team-message delivery receipt.",
});
export type TeamSignedDeliveryReceiptEnvelope = typeof TeamSignedDeliveryReceiptEnvelope.Type;

// The relay-envelope union (`TeamRelayEnvelope`) is declared after the R2 event
// families below, since the cross-environment event envelope carries a
// `ReplicatedTeamEvent` and the union must include it.

// ---------------------------------------------------------------------------
// M2 local team domain — event-sourced, environment-local coordination.
// ---------------------------------------------------------------------------

/** Presence states for M2+; never committed to Git. */
export const MemberPresenceState = Schema.Literals(["online", "busy", "away", "offline"]).annotate({
  description: "Presence state for a member in an environment. Never committed to Git.",
});
export type MemberPresenceState = typeof MemberPresenceState.Type;

export const TeamMessageDeliveryState = Schema.Literals([
  "queued",
  "delivered",
  "read",
  "expired",
]).annotate({
  description: "Environment-local delivery state for a direct team message.",
});
export type TeamMessageDeliveryState = typeof TeamMessageDeliveryState.Type;

export const TeamRequestState = Schema.Literals([
  "open",
  "accepted",
  "declined",
  "expired",
]).annotate({
  description: "Environment-local lifecycle state for a team request.",
});
export type TeamRequestState = typeof TeamRequestState.Type;

export const TeamRequestResponse = Schema.Literals(["accepted", "declined"]).annotate({
  description: "Explicit human or agent response to a team request.",
});
export type TeamRequestResponse = typeof TeamRequestResponse.Type;

export const TeamRequestKind = Schema.Literals(["handoff", "review"]).annotate({
  description: "Structured request types supported by the local M2 inbox.",
});
export type TeamRequestKind = typeof TeamRequestKind.Type;

export const TeamActivityKind = Schema.Literals([
  "member.upserted",
  "thread.assigned",
  "message.queued",
  "message.delivered",
  "message.read",
  "message.expired",
  "request.created",
  "request.responded",
  "channel.declared",
  "channel.posted",
  "task.created",
  "task.moved",
  "task.updated",
  "task.assigned",
]).annotate({
  description: "Timeline-visible activity emitted by the local team domain.",
});
export type TeamActivityKind = typeof TeamActivityKind.Type;

export const TeamCommandMetadata = preserveUnknownFields(
  Schema.Struct({
    actorMemberId: Schema.optionalKey(MemberId),
    environmentId: Schema.optionalKey(EnvironmentId),
  }).annotate({
    description: "Environment-local metadata for a team command.",
  }),
);
export type TeamCommandMetadata = typeof TeamCommandMetadata.Type;

export const TeamCommandBase = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  metadata: Schema.optionalKey(TeamCommandMetadata),
});
export type TeamCommandBase = typeof TeamCommandBase.Type;

export const TeamMemberUpsertCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.member.upsert"),
  profile: MemberProfile,
}).annotate({
  description: "Upsert a human or agent profile into the local .repokin/ tree.",
});
export type TeamMemberUpsertCommand = typeof TeamMemberUpsertCommand.Type;

export const TeamAgentAssignCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.agent.assign"),
  threadId: ThreadId,
  assigneeId: MemberId,
  assignedById: MemberId,
  note: Schema.optionalKey(
    trimmedNonEmpty({
      description: "Optional handoff or assignment note preserved in local team activity.",
    }),
  ),
}).annotate({
  description: "Assign or hand off a thread to a local team member.",
});
export type TeamAgentAssignCommand = typeof TeamAgentAssignCommand.Type;

export const TeamMessageSendCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.message.send"),
  messageId: MessageId,
  senderId: MemberId,
  recipientId: MemberId,
  body: trimmedNonEmpty(
    {
      description: "Direct message body. Lives only in the environment-local event store.",
    },
    20_000,
  ),
  threadId: Schema.optionalKey(ThreadId),
  expiresAt: Schema.optionalKey(IsoDateTime),
}).annotate({
  description: "Send a direct local team message. Busy/offline delivery remains queued.",
});
export type TeamMessageSendCommand = typeof TeamMessageSendCommand.Type;

export const TeamMessageDeliverCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.message.deliver"),
  messageId: MessageId,
}).annotate({
  description: "Internal command: mark a queued local team message delivered.",
});
export type TeamMessageDeliverCommand = typeof TeamMessageDeliverCommand.Type;

export const TeamMessageMarkReadCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.message.markRead"),
  messageId: MessageId,
  readerId: MemberId,
}).annotate({
  description: "Mark a delivered local team message read.",
});
export type TeamMessageMarkReadCommand = typeof TeamMessageMarkReadCommand.Type;

export const TeamMessageExpireCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.message.expire"),
  messageId: MessageId,
}).annotate({
  description: "Internal command: expire a queued local team message whose TTL elapsed.",
});
export type TeamMessageExpireCommand = typeof TeamMessageExpireCommand.Type;

export const TeamRequestRespondCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.request.respond"),
  requestId: MessageId,
  responderId: MemberId,
  response: TeamRequestResponse,
  message: Schema.optionalKey(
    trimmedNonEmpty({
      description: "Optional response note for the request audit trail.",
    }),
  ),
}).annotate({
  description: "Accept or decline a local team request from the inbox.",
});
export type TeamRequestRespondCommand = typeof TeamRequestRespondCommand.Type;

// ===========================================================================
// R2 — Channels, delegation, and the board (schema only; additive)
//
// These shapes are the contract review target for R2 (implementation-plan
// §3.1). They mirror the R1.7 fixture types (apps/web/src/components/team/
// fixtures/) so the client renders the real shapes before the domain lands.
//
// R2.2 folds the commands/events into the master TeamCommand / TeamEvent
// unions and wires the decider/projector/engine; these shapes are that target.
// ===========================================================================

/** Subdirectory of channel declarations under {@link REPOKIN_DIR_NAME} (T0, git-resident). */
export const TEAM_CHANNELS_DIR_NAME = "channels";
export const CHANNEL_DECLARATION_SCHEMA_URL = "https://repokin.dev/schema/channel.json";

// ---------------------------------------------------------------------------
// R2 identifiers
// ---------------------------------------------------------------------------

/** Channel slug — the file stem under .repokin/channels/<slug>.json. */
export const ChannelId = memberSlugSchema.pipe(Schema.brand("ChannelId"));
export type ChannelId = typeof ChannelId.Type;

/** Opaque per-post id. Posts fan out as signed envelopes on the relay (R2.2). */
export const PostId = TrimmedNonEmptyString.pipe(Schema.brand("PostId"));
export type PostId = typeof PostId.Type;

/** Opaque task id. */
export const TaskId = TrimmedNonEmptyString.pipe(Schema.brand("TaskId"));
export type TaskId = typeof TaskId.Type;

const isChannelIdValue = Schema.is(ChannelId);
export const isChannelId = (value: unknown): value is ChannelId => isChannelIdValue(value);

// ---------------------------------------------------------------------------
// Channel declaration — .repokin/channels/<slug>.json (T0, committed)
// ---------------------------------------------------------------------------

export const ChannelDeclaration = preserveUnknownFields(
  Schema.Struct({
    $schema: Schema.optionalKey(
      Schema.String.annotate({
        description: `URL of the JSON Schema for this file, typically "${CHANNEL_DECLARATION_SCHEMA_URL}".`,
      }),
    ),
    schemaVersion: Schema.Literal(1).annotate({
      description: "Channel schema version. Evolve additively only.",
    }),
    id: ChannelId.annotate({
      description: "Stable channel slug. Authoritative over the filename.",
    }),
    name: trimmedNonEmpty({
      description: 'Display name shown in the channel list (e.g. "#team").',
    }),
    description: Schema.optionalKey(
      trimmedNonEmpty({ description: "One-line purpose of the channel." }),
    ),
    /**
     * Explicit member allowlist. Omitted means the whole roster — channels are
     * roster-scoped, never public (PRD §6.2).
     */
    members: Schema.optionalKey(
      Schema.Array(MemberId).annotate({
        description: "Members with access. Omit for the whole roster.",
      }),
    ),
    createdAt: Schema.optionalKey(IsoDateTime),
    updatedAt: Schema.optionalKey(IsoDateTime),
  }).annotate({
    title: "Channel declaration",
    description: "Checked-in channel declaration under .repokin/channels/. No message bodies.",
  }),
);
export type ChannelDeclaration = typeof ChannelDeclaration.Type;

// ---------------------------------------------------------------------------
// Typed post union — text / thread-card / diff-card / task-card / event / digest
// ---------------------------------------------------------------------------

export const TeamPostKind = Schema.Literals([
  "text",
  "thread-card",
  "diff-card",
  "task-card",
  "event",
  "digest",
]).annotate({
  description: "Discriminator for the typed-post union (PRD §6.2). No kinds beyond this set.",
});
export type TeamPostKind = typeof TeamPostKind.Type;

export const TeamTextPost = Schema.Struct({
  kind: Schema.Literal("text"),
  body: trimmedNonEmpty({ description: "Plain post body." }, 20_000),
}).annotate({ description: "A plain text post." });
export type TeamTextPost = typeof TeamTextPost.Type;

export const TeamThreadCardPost = Schema.Struct({
  kind: Schema.Literal("thread-card"),
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  status: Schema.NullOr(Schema.String),
}).annotate({ description: "A card linking a running or settled thread." });
export type TeamThreadCardPost = typeof TeamThreadCardPost.Type;

export const TeamDiffCardPost = Schema.Struct({
  kind: Schema.Literal("diff-card"),
  title: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  changedFiles: NonNegativeInt,
  branch: Schema.NullOr(Schema.String),
}).annotate({ description: "A card summarizing a diff on a RepoKin-owned branch." });
export type TeamDiffCardPost = typeof TeamDiffCardPost.Type;

export const TeamTaskCardPost = Schema.Struct({
  kind: Schema.Literal("task-card"),
  taskId: TaskId,
  title: TrimmedNonEmptyString,
  taskState: Schema.String,
}).annotate({ description: "A card mirroring a board task's coarse state." });
export type TeamTaskCardPost = typeof TeamTaskCardPost.Type;

export const TeamEventPost = Schema.Struct({
  kind: Schema.Literal("event"),
  summary: trimmedNonEmpty({ description: "Past-tense summary of a coordination event." }),
}).annotate({ description: "A low-weight event line (assignment, move, publish)." });
export type TeamEventPost = typeof TeamEventPost.Type;

export const TeamDigestPost = Schema.Struct({
  kind: Schema.Literal("digest"),
  title: TrimmedNonEmptyString,
  bullets: Schema.Array(TrimmedNonEmptyString),
}).annotate({ description: "A generated standup/digest post (R3)." });
export type TeamDigestPost = typeof TeamDigestPost.Type;

export const TeamPostContent = Schema.Union([
  TeamTextPost,
  TeamThreadCardPost,
  TeamDiffCardPost,
  TeamTaskCardPost,
  TeamEventPost,
  TeamDigestPost,
]).annotate({
  description: "The typed content of one channel post, discriminated by `kind`.",
});
export type TeamPostContent = typeof TeamPostContent.Type;

// ---------------------------------------------------------------------------
// Task shapes — board domain
// ---------------------------------------------------------------------------

export const TeamTaskState = Schema.Literals([
  "backlog",
  "in-progress",
  "in-review",
  "done",
]).annotate({
  description: "The four board columns. No workflow states beyond these (FR-18.8).",
});
export type TeamTaskState = typeof TeamTaskState.Type;

/** Structured references a task carries: origin channel, thread, diff branch. */
export const TeamTaskRefs = preserveUnknownFields(
  Schema.Struct({
    channelId: Schema.optionalKey(ChannelId),
    threadId: Schema.optionalKey(ThreadId),
    /** RepoKin-owned branch holding the task's diff, when a report exists. */
    branch: Schema.optionalKey(trimmedNonEmpty({ description: "Diff branch ref." })),
  }).annotate({ description: "Structured references attached to a task." }),
);
export type TeamTaskRefs = typeof TeamTaskRefs.Type;

// ---------------------------------------------------------------------------
// R2 commands
// ---------------------------------------------------------------------------

export const TeamChannelDeclareCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.channel.declare"),
  declaration: ChannelDeclaration,
}).annotate({
  description: "Create or update a channel declaration in the local .repokin/ tree.",
});
export type TeamChannelDeclareCommand = typeof TeamChannelDeclareCommand.Type;

export const TeamChannelPostCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.channel.post"),
  postId: PostId,
  channelId: ChannelId,
  authorId: MemberId,
  content: TeamPostContent,
  // Carried on remote re-dispatch so a receiver preserves the origin's
  // per-sender sequence (PRD FR-12.5 / Q7). Local authors omit it; the
  // decider assigns the next value.
  senderSeq: Schema.optionalKey(NonNegativeInt),
}).annotate({
  description:
    "Post to a channel. Agents may only post when prompted (FR-12.6, enforced server-side).",
});
export type TeamChannelPostCommand = typeof TeamChannelPostCommand.Type;

export const TeamTaskCreateCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.task.create"),
  taskId: TaskId,
  title: trimmedNonEmpty({ description: "Task title." }),
  description: Schema.optionalKey(
    trimmedNonEmpty({ description: "Task description, used as the delegation prompt." }, 20_000),
  ),
  labels: Schema.optionalKey(trimmedStringList({ description: "Freeform labels." })),
  refs: Schema.optionalKey(TeamTaskRefs),
  createdById: MemberId,
  assigneeId: Schema.optionalKey(MemberId),
}).annotate({ description: "Create a board task in the backlog." });
export type TeamTaskCreateCommand = typeof TeamTaskCreateCommand.Type;

export const TeamTaskMoveCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.task.move"),
  taskId: TaskId,
  toState: TeamTaskState,
  movedById: MemberId,
}).annotate({
  description: "Move a task between columns. An agent never marks its own task done (FR-18.3).",
});
export type TeamTaskMoveCommand = typeof TeamTaskMoveCommand.Type;

export const TeamTaskUpdateCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.task.update"),
  taskId: TaskId,
  updatedById: MemberId,
  // Per-field last-writer-wins on concurrent edits (FR-18.6). Absent fields
  // are left untouched; null clears an optional field.
  title: Schema.optionalKey(trimmedNonEmpty({ description: "New title." })),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  labels: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  refs: Schema.optionalKey(TeamTaskRefs),
}).annotate({ description: "Edit task fields (last-writer-wins per field)." });
export type TeamTaskUpdateCommand = typeof TeamTaskUpdateCommand.Type;

export const TeamTaskAssignCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.task.assign"),
  taskId: TaskId,
  assigneeId: Schema.NullOr(MemberId),
  assignedById: MemberId,
}).annotate({
  description: "Assign or unassign a task. An agent never self-assigns (FR-18.2).",
});
export type TeamTaskAssignCommand = typeof TeamTaskAssignCommand.Type;

// R2.3 delegation: a request is the accept/decline gate for handing work to a
// member. A task delegation links `taskId` (no thread exists until accept); a
// thread handoff links `threadId`.
export const TeamRequestCreateCommand = Schema.Struct({
  ...TeamCommandBase.fields,
  type: Schema.Literal("team.request.create"),
  requestId: MessageId,
  kind: TeamRequestKind,
  fromMemberId: MemberId,
  toMemberId: MemberId,
  taskId: Schema.optionalKey(TaskId),
  threadId: Schema.optionalKey(ThreadId),
  message: Schema.optionalKey(
    trimmedNonEmpty({ description: "Optional note shown with the request in the inbox." }),
  ),
  expiresAt: Schema.optionalKey(IsoDateTime),
}).annotate({
  description:
    "Raise a structured handoff or review request in a member's inbox. The assignee's response is the delegation accept gate (R2.3).",
});
export type TeamRequestCreateCommand = typeof TeamRequestCreateCommand.Type;

export const TeamChannelCommand = Schema.Union([TeamChannelDeclareCommand, TeamChannelPostCommand]);
export type TeamChannelCommand = typeof TeamChannelCommand.Type;

export const TeamTaskCommand = Schema.Union([
  TeamTaskCreateCommand,
  TeamTaskMoveCommand,
  TeamTaskUpdateCommand,
  TeamTaskAssignCommand,
]);
export type TeamTaskCommand = typeof TeamTaskCommand.Type;

export const TeamCommand = Schema.Union([
  TeamMemberUpsertCommand,
  TeamAgentAssignCommand,
  TeamMessageSendCommand,
  TeamMessageDeliverCommand,
  TeamMessageMarkReadCommand,
  TeamMessageExpireCommand,
  TeamRequestCreateCommand,
  TeamRequestRespondCommand,
  TeamChannelDeclareCommand,
  TeamChannelPostCommand,
  TeamTaskCreateCommand,
  TeamTaskMoveCommand,
  TeamTaskUpdateCommand,
  TeamTaskAssignCommand,
]);
export type TeamCommand = typeof TeamCommand.Type;

export const TeamEventMetadata = preserveUnknownFields(
  Schema.Struct({
    actorMemberId: Schema.optionalKey(MemberId),
    environmentId: Schema.optionalKey(EnvironmentId),
  }).annotate({
    description: "Environment-local metadata attached to a persisted team event.",
  }),
);
export type TeamEventMetadata = typeof TeamEventMetadata.Type;

export const TeamEventType = Schema.Literals([
  "team.member.upserted",
  "team.agent.assigned",
  "team.message.queued",
  "team.message.delivered",
  "team.message.read",
  "team.message.expired",
  "team.request.created",
  "team.request.responded",
  "team.channel.declared",
  "team.channel.posted",
  "team.task.created",
  "team.task.moved",
  "team.task.updated",
  "team.task.assigned",
]).annotate({
  description: "Persisted local team-domain event type.",
});
export type TeamEventType = typeof TeamEventType.Type;

export const TeamMemberUpsertedEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  type: Schema.Literal("team.member.upserted"),
  commandId: CommandId,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  memberId: MemberId,
  memberType: MemberType,
  profile: MemberProfile,
  at: IsoDateTime,
  metadata: TeamEventMetadata,
}).annotate({
  description: "A member profile was written under .repokin/.",
});
export type TeamMemberUpsertedEvent = typeof TeamMemberUpsertedEvent.Type;

export const TeamAgentAssignedEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  type: Schema.Literal("team.agent.assigned"),
  commandId: CommandId,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  threadId: ThreadId,
  assigneeId: MemberId,
  assignedById: MemberId,
  note: Schema.NullOr(Schema.String),
  at: IsoDateTime,
  metadata: TeamEventMetadata,
}).annotate({
  description: "A thread was assigned or handed off to a team member.",
});
export type TeamAgentAssignedEvent = typeof TeamAgentAssignedEvent.Type;

export const TeamMessageQueuedEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  type: Schema.Literal("team.message.queued"),
  commandId: CommandId,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  messageId: MessageId,
  senderId: MemberId,
  recipientId: MemberId,
  body: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  sentAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
  metadata: TeamEventMetadata,
}).annotate({
  description: "A direct team message entered the durable local inbox queue.",
});
export type TeamMessageQueuedEvent = typeof TeamMessageQueuedEvent.Type;

export const TeamMessageDeliveredEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  type: Schema.Literal("team.message.delivered"),
  commandId: CommandId,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  messageId: MessageId,
  deliveredAt: IsoDateTime,
  metadata: TeamEventMetadata,
}).annotate({
  description: "A queued local team message was delivered.",
});
export type TeamMessageDeliveredEvent = typeof TeamMessageDeliveredEvent.Type;

export const TeamMessageReadEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  type: Schema.Literal("team.message.read"),
  commandId: CommandId,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  messageId: MessageId,
  readerId: MemberId,
  readAt: IsoDateTime,
  metadata: TeamEventMetadata,
}).annotate({
  description: "A delivered local team message was marked read.",
});
export type TeamMessageReadEvent = typeof TeamMessageReadEvent.Type;

export const TeamMessageExpiredEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  type: Schema.Literal("team.message.expired"),
  commandId: CommandId,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  messageId: MessageId,
  expiredAt: IsoDateTime,
  metadata: TeamEventMetadata,
}).annotate({
  description: "A queued local team message expired before delivery.",
});
export type TeamMessageExpiredEvent = typeof TeamMessageExpiredEvent.Type;

export const TeamRequestCreatedEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  type: Schema.Literal("team.request.created"),
  commandId: CommandId,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  requestId: MessageId,
  kind: TeamRequestKind,
  fromMemberId: MemberId,
  toMemberId: MemberId,
  // Nullable since R2.3: a task delegation has no thread until it is accepted.
  threadId: Schema.NullOr(ThreadId),
  taskId: Schema.NullOr(TaskId),
  message: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
  metadata: TeamEventMetadata,
}).annotate({
  description: "A structured local request was created in a member inbox.",
});
export type TeamRequestCreatedEvent = typeof TeamRequestCreatedEvent.Type;

export const TeamRequestRespondedEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  type: Schema.Literal("team.request.responded"),
  commandId: CommandId,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  requestId: MessageId,
  responderId: MemberId,
  response: TeamRequestResponse,
  message: Schema.NullOr(Schema.String),
  respondedAt: IsoDateTime,
  metadata: TeamEventMetadata,
}).annotate({
  description: "A member accepted or declined a local team request.",
});
export type TeamRequestRespondedEvent = typeof TeamRequestRespondedEvent.Type;

// ---------------------------------------------------------------------------
// R2 events
// ---------------------------------------------------------------------------

const R2EventBase = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("project"),
  aggregateId: ProjectId,
  commandId: CommandId,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  at: IsoDateTime,
  metadata: TeamEventMetadata,
} as const;

export const TeamChannelDeclaredEvent = Schema.Struct({
  ...R2EventBase,
  type: Schema.Literal("team.channel.declared"),
  channelId: ChannelId,
  declaration: ChannelDeclaration,
}).annotate({ description: "A channel declaration was written under .repokin/." });
export type TeamChannelDeclaredEvent = typeof TeamChannelDeclaredEvent.Type;

export const TeamChannelPostedEvent = Schema.Struct({
  ...R2EventBase,
  type: Schema.Literal("team.channel.posted"),
  postId: PostId,
  channelId: ChannelId,
  authorId: MemberId,
  authorEnvironmentId: Schema.NullOr(EnvironmentId),
  content: TeamPostContent,
  postedAt: IsoDateTime,
  // Per-(channel, author environment) causal sequence. Starts at 1. 0 means
  // "unknown/legacy" and is ignored by gap detection. When a receiver sees a
  // jump, it surfaces a gap marker rather than inventing posts (PRD Q7).
  senderSeq: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
}).annotate({ description: "A post landed in a channel." });
export type TeamChannelPostedEvent = typeof TeamChannelPostedEvent.Type;

export const TeamTaskCreatedEvent = Schema.Struct({
  ...R2EventBase,
  type: Schema.Literal("team.task.created"),
  taskId: TaskId,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  labels: Schema.Array(TrimmedNonEmptyString),
  refs: Schema.NullOr(TeamTaskRefs),
  createdById: MemberId,
  assigneeId: Schema.NullOr(MemberId),
}).annotate({ description: "A board task was created." });
export type TeamTaskCreatedEvent = typeof TeamTaskCreatedEvent.Type;

export const TeamTaskMovedEvent = Schema.Struct({
  ...R2EventBase,
  type: Schema.Literal("team.task.moved"),
  taskId: TaskId,
  fromState: TeamTaskState,
  toState: TeamTaskState,
  movedById: MemberId,
}).annotate({ description: "A task moved between columns." });
export type TeamTaskMovedEvent = typeof TeamTaskMovedEvent.Type;

export const TeamTaskUpdatedEvent = Schema.Struct({
  ...R2EventBase,
  type: Schema.Literal("team.task.updated"),
  taskId: TaskId,
  updatedById: MemberId,
  title: Schema.NullOr(TrimmedNonEmptyString),
  description: Schema.NullOr(Schema.String),
  labels: Schema.NullOr(Schema.Array(TrimmedNonEmptyString)),
  refs: Schema.NullOr(TeamTaskRefs),
}).annotate({ description: "Task fields were edited (last-writer-wins per field)." });
export type TeamTaskUpdatedEvent = typeof TeamTaskUpdatedEvent.Type;

export const TeamTaskAssignedEvent = Schema.Struct({
  ...R2EventBase,
  type: Schema.Literal("team.task.assigned"),
  taskId: TaskId,
  assigneeId: Schema.NullOr(MemberId),
  assignedById: MemberId,
}).annotate({ description: "A task was assigned or unassigned." });
export type TeamTaskAssignedEvent = typeof TeamTaskAssignedEvent.Type;

export const TeamChannelEvent = Schema.Union([TeamChannelDeclaredEvent, TeamChannelPostedEvent]);
export type TeamChannelEvent = typeof TeamChannelEvent.Type;

export const TeamTaskEvent = Schema.Union([
  TeamTaskCreatedEvent,
  TeamTaskMovedEvent,
  TeamTaskUpdatedEvent,
  TeamTaskAssignedEvent,
]);
export type TeamTaskEvent = typeof TeamTaskEvent.Type;

export const TeamEvent = Schema.Union([
  TeamMemberUpsertedEvent,
  TeamAgentAssignedEvent,
  TeamMessageQueuedEvent,
  TeamMessageDeliveredEvent,
  TeamMessageReadEvent,
  TeamMessageExpiredEvent,
  TeamRequestCreatedEvent,
  TeamRequestRespondedEvent,
  TeamChannelDeclaredEvent,
  TeamChannelPostedEvent,
  TeamTaskCreatedEvent,
  TeamTaskMovedEvent,
  TeamTaskUpdatedEvent,
  TeamTaskAssignedEvent,
]);
export type TeamEvent = typeof TeamEvent.Type;
export type PlannedTeamEvent = TeamEvent extends infer Event
  ? Event extends TeamEvent
    ? Omit<Event, "sequence">
    : never
  : never;

// ---------------------------------------------------------------------------
// R2 — cross-environment fan-out of channel posts and task events.
//
// Channel *declarations* ride git (`.repokin/channels/`, T0, committed); only
// posts and task events fan out over the relay. Each fan-out is a signed
// envelope addressed to one remote roster environment (bounded per-post
// fan-out), verified against the author's roster key exactly like a direct
// message, then re-dispatched as the corresponding command so every
// environment's event log stays authoritative.
// ---------------------------------------------------------------------------

export const ReplicatedTeamEvent = Schema.Union([
  TeamChannelPostedEvent,
  TeamTaskCreatedEvent,
  TeamTaskMovedEvent,
  TeamTaskUpdatedEvent,
  TeamTaskAssignedEvent,
  // R2.3 delegation across environments: the handoff request and its response
  // ride the same fan-out so a cross-environment mention → task → accept works.
  TeamRequestCreatedEvent,
  TeamRequestRespondedEvent,
]).annotate({
  description: "Team domain events replicated to other roster environments over the relay.",
});
export type ReplicatedTeamEvent = typeof ReplicatedTeamEvent.Type;

export const TeamSignedEventPayload = Schema.Struct({
  projectId: ProjectId,
  senderId: MemberId,
  senderEnvironmentId: EnvironmentId,
  recipientEnvironmentId: EnvironmentId,
  event: ReplicatedTeamEvent,
  sentAt: IsoDateTime,
  expiresAt: Schema.optionalKey(IsoDateTime),
}).annotate({
  description:
    "A replicated team domain event covered by the author environment's signature. Field layout mirrors TeamSignedMessagePayload so the relay routes it by `recipientEnvironmentId` unchanged.",
});
export type TeamSignedEventPayload = typeof TeamSignedEventPayload.Type;

export const TeamSignedEventProofPayload = Schema.Struct({
  ...TeamSignedJwtRegisteredClaims,
  senderEnvironmentId: EnvironmentId,
  recipientEnvironmentId: EnvironmentId,
  event: TeamSignedEventPayload,
}).annotate({
  description: "JWT payload signed by the author environment for a replicated team event.",
});
export type TeamSignedEventProofPayload = typeof TeamSignedEventProofPayload.Type;

export const TeamSignedEventEnvelope = Schema.Struct({
  payload: TeamSignedEventPayload,
  proof: TrimmedNonEmptyString,
}).annotate({
  description: "Relay-transported signed team domain-event envelope.",
});
export type TeamSignedEventEnvelope = typeof TeamSignedEventEnvelope.Type;

// Work-signal shape lives here (before TeamRelayEnvelope) so fan-out envelopes
// can reference it without a TDZ. The R3 read-model section re-exports usage.
export const TeamWorkSignal = Schema.Struct({
  projectId: ProjectId,
  memberId: MemberId,
  memberType: MemberType,
  environmentId: EnvironmentId,
  /** Repo-relative directories (already coarsened). */
  directories: Schema.Array(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
  source: Schema.Literals(["working-tree", "thread", "mixed"]),
}).annotate({
  description: "Coarse work-location signal for one member in one project.",
});
export type TeamWorkSignal = typeof TeamWorkSignal.Type;

/**
 * Ephemeral work-location snapshot fanned out over the relay (R3.1). Field
 * layout mirrors TeamSignedEventPayload so `deliverTeamMessage` routes by
 * `recipientEnvironmentId` unchanged. Not event-sourced — receivers cache
 * only (PRD FR-14.1).
 */
export const TeamSignedWorkSignalPayload = Schema.Struct({
  projectId: ProjectId,
  senderId: MemberId,
  senderEnvironmentId: EnvironmentId,
  recipientEnvironmentId: EnvironmentId,
  signals: Schema.Array(TeamWorkSignal),
  sentAt: IsoDateTime,
  expiresAt: Schema.optionalKey(IsoDateTime),
}).annotate({
  description: "A local environment's work-signal snapshot for one remote roster peer.",
});
export type TeamSignedWorkSignalPayload = typeof TeamSignedWorkSignalPayload.Type;

export const TeamSignedWorkSignalProofPayload = Schema.Struct({
  ...TeamSignedJwtRegisteredClaims,
  senderEnvironmentId: EnvironmentId,
  recipientEnvironmentId: EnvironmentId,
  workSignal: TeamSignedWorkSignalPayload,
}).annotate({
  description: "JWT payload signed by the author environment for a work-signal snapshot.",
});
export type TeamSignedWorkSignalProofPayload = typeof TeamSignedWorkSignalProofPayload.Type;

export const TeamSignedWorkSignalEnvelope = Schema.Struct({
  payload: TeamSignedWorkSignalPayload,
  proof: TrimmedNonEmptyString,
}).annotate({
  description: "Relay-transported signed work-signal envelope (ephemeral, R3).",
});
export type TeamSignedWorkSignalEnvelope = typeof TeamSignedWorkSignalEnvelope.Type;

export const TeamRelayEnvelope = Schema.Union([
  TeamSignedMessageEnvelope,
  TeamSignedDeliveryReceiptEnvelope,
  TeamSignedEventEnvelope,
  TeamSignedWorkSignalEnvelope,
]).annotate({
  description:
    "Signed RepoKin message, delivery receipt, replicated domain event, or work-signal snapshot transported through the relay.",
});
export type TeamRelayEnvelope = typeof TeamRelayEnvelope.Type;

export const TeamMemberReadModel = Schema.Struct({
  memberId: MemberId,
  memberType: MemberType,
  profile: MemberProfile,
  updatedAt: IsoDateTime,
});
export type TeamMemberReadModel = typeof TeamMemberReadModel.Type;

export const TeamThreadAssignment = Schema.Struct({
  threadId: ThreadId,
  assigneeId: MemberId,
  assignedById: MemberId,
  assignedAt: IsoDateTime,
  note: Schema.NullOr(Schema.String),
});
export type TeamThreadAssignment = typeof TeamThreadAssignment.Type;

export const TeamInboxMessage = Schema.Struct({
  messageId: MessageId,
  senderId: MemberId,
  recipientId: MemberId,
  senderEnvironmentId: Schema.NullOr(EnvironmentId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  body: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  sentAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
  state: TeamMessageDeliveryState,
  deliveredAt: Schema.NullOr(IsoDateTime),
  readAt: Schema.NullOr(IsoDateTime),
  expiredAt: Schema.NullOr(IsoDateTime),
});
export type TeamInboxMessage = typeof TeamInboxMessage.Type;

export const TeamRequestReadModel = Schema.Struct({
  requestId: MessageId,
  kind: TeamRequestKind,
  fromMemberId: MemberId,
  toMemberId: MemberId,
  threadId: Schema.NullOr(ThreadId),
  taskId: Schema.NullOr(TaskId),
  message: Schema.NullOr(Schema.String),
  state: TeamRequestState,
  createdAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
  respondedAt: Schema.NullOr(IsoDateTime),
  response: Schema.NullOr(TeamRequestResponse),
  responseMessage: Schema.NullOr(Schema.String),
});
export type TeamRequestReadModel = typeof TeamRequestReadModel.Type;

export const TeamActivity = Schema.Struct({
  eventId: EventId,
  kind: TeamActivityKind,
  occurredAt: IsoDateTime,
  actorMemberId: Schema.NullOr(MemberId),
  subjectMemberId: Schema.NullOr(MemberId),
  threadId: Schema.NullOr(ThreadId),
  messageId: Schema.NullOr(MessageId),
  requestId: Schema.NullOr(MessageId),
  summary: TrimmedNonEmptyString,
});
export type TeamActivity = typeof TeamActivity.Type;

// ---------------------------------------------------------------------------
// R2 read models (fixtures mirror these; flipped live in R2.4 / R3.2)
// ---------------------------------------------------------------------------

export const TeamChannelReadModel = Schema.Struct({
  channelId: ChannelId,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  memberIds: Schema.Array(MemberId),
  postCount: NonNegativeInt,
  lastPostAt: Schema.NullOr(IsoDateTime),
}).annotate({ description: "Channel-list projection." });
export type TeamChannelReadModel = typeof TeamChannelReadModel.Type;

export const TeamPostReadModel = Schema.Struct({
  postId: PostId,
  channelId: ChannelId,
  authorId: MemberId,
  authorEnvironmentId: Schema.NullOr(EnvironmentId),
  content: TeamPostContent,
  postedAt: IsoDateTime,
  // Mirrors TeamChannelPostedEvent.senderSeq; 0 = legacy / unknown.
  senderSeq: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
}).annotate({ description: "A single channel post." });
export type TeamPostReadModel = typeof TeamPostReadModel.Type;

/**
 * Gap marker for a member who was offline past the relay TTL: rather than
 * silently losing posts, the channel shows a gap (PRD Q7).
 */
export const TeamChannelGapMarker = Schema.Struct({
  channelId: ChannelId,
  afterPostId: Schema.NullOr(PostId),
  beforePostId: Schema.NullOr(PostId),
  missedCount: Schema.NullOr(NonNegativeInt),
}).annotate({ description: "A visible gap where posts were dropped past TTL." });
export type TeamChannelGapMarker = typeof TeamChannelGapMarker.Type;

export const TeamChannelViewReadModel = Schema.Struct({
  channel: TeamChannelReadModel,
  posts: Schema.Array(TeamPostReadModel),
  gaps: Schema.Array(TeamChannelGapMarker),
}).annotate({ description: "One channel's posts plus any gap markers." });
export type TeamChannelViewReadModel = typeof TeamChannelViewReadModel.Type;

export const TeamTaskReadModel = Schema.Struct({
  taskId: TaskId,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  labels: Schema.Array(TrimmedNonEmptyString),
  refs: Schema.NullOr(TeamTaskRefs),
  state: TeamTaskState,
  assigneeId: Schema.NullOr(MemberId),
  createdById: MemberId,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
}).annotate({ description: "A single board task." });
export type TeamTaskReadModel = typeof TeamTaskReadModel.Type;

export const TeamBoardReadModel = Schema.Struct({
  projectId: ProjectId,
  tasks: Schema.Array(TeamTaskReadModel),
  updatedAt: IsoDateTime,
}).annotate({ description: "All board tasks for a project; columns are derived client-side." });
export type TeamBoardReadModel = typeof TeamBoardReadModel.Type;

export const TeamProjectReadModel = Schema.Struct({
  projectId: ProjectId,
  members: Schema.Array(TeamMemberReadModel),
  assignments: Schema.Array(TeamThreadAssignment),
  inbox: Schema.Array(TeamInboxMessage),
  requests: Schema.Array(TeamRequestReadModel),
  activities: Schema.Array(TeamActivity),
  // R2 (channels + board). Decoding defaults keep older snapshots decodable.
  channels: Schema.Array(ChannelDeclaration).pipe(
    Schema.withDecodingDefault(
      Effect.succeed([] as ChannelDeclaration[] as readonly ChannelDeclaration[]),
    ),
  ),
  posts: Schema.Array(TeamPostReadModel).pipe(
    Schema.withDecodingDefault(
      Effect.succeed([] as TeamPostReadModel[] as readonly TeamPostReadModel[]),
    ),
  ),
  tasks: Schema.Array(TeamTaskReadModel).pipe(
    Schema.withDecodingDefault(
      Effect.succeed([] as TeamTaskReadModel[] as readonly TeamTaskReadModel[]),
    ),
  ),
  updatedAt: IsoDateTime,
});
export type TeamProjectReadModel = typeof TeamProjectReadModel.Type;

export const TeamDomainReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(TeamProjectReadModel),
  updatedAt: IsoDateTime,
});
export type TeamDomainReadModel = typeof TeamDomainReadModel.Type;

export const TeamLocalStateReadInput = Schema.Struct({
  projectId: ProjectId,
}).annotate({
  description: "Read the environment-local team coordination state for a project.",
});
export type TeamLocalStateReadInput = typeof TeamLocalStateReadInput.Type;

export const TeamMemberPresenceEntry = Schema.Struct({
  memberId: MemberId,
  state: Schema.NullOr(MemberPresenceState),
});
export type TeamMemberPresenceEntry = typeof TeamMemberPresenceEntry.Type;

/**
 * Per-channel post rollup, computed server-side so the channel list never has
 * to ship every post. Lives on the local-state result alongside the (now
 * posts-less) project.
 */
export const TeamChannelPostStats = Schema.Struct({
  channelId: ChannelId,
  postCount: NonNegativeInt,
  lastPostAt: Schema.NullOr(IsoDateTime),
}).annotate({ description: "Post count and last-activity for one channel." });
export type TeamChannelPostStats = typeof TeamChannelPostStats.Type;

export const TeamLocalStateReadResult = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  // The project's `posts` array is intentionally empty here — channel posts are
  // served windowed via `team.readChannelPosts` so this payload stays small for
  // busy channels (NFR-1). Use `channelStats` for list-level counts.
  project: Schema.NullOr(TeamProjectReadModel),
  channelStats: Schema.Array(TeamChannelPostStats).pipe(
    Schema.withDecodingDefault(
      Effect.succeed([] as TeamChannelPostStats[] as readonly TeamChannelPostStats[]),
    ),
  ),
  // Presence for every member of `project`, resolved locally or (for a
  // roster agent whose home environment differs from this one) via the
  // relay (M3.3). Never surfaced when `project` is null.
  presences: Schema.Array(TeamMemberPresenceEntry),
}).annotate({
  description: "Environment-local team coordination state for one project.",
});
export type TeamLocalStateReadResult = typeof TeamLocalStateReadResult.Type;

/** Default number of posts returned per `team.readChannelPosts` window. */
export const TEAM_CHANNEL_POSTS_PAGE_SIZE = 50;

export const TeamChannelPostsReadInput = Schema.Struct({
  projectId: ProjectId,
  channelId: ChannelId,
  limit: NonNegativeInt,
  // Cursor: return the newest `limit` posts strictly older than this post. Null
  // requests the newest window (channel tail).
  before: Schema.NullOr(PostId),
}).annotate({
  description: "Read one window of a channel's posts, newest-first paginated.",
});
export type TeamChannelPostsReadInput = typeof TeamChannelPostsReadInput.Type;

export const TeamChannelPostsReadResult = Schema.Struct({
  // Ascending (oldest→newest) within the window, so the client can prepend when
  // paging older.
  posts: Schema.Array(TeamPostReadModel),
  // Whether older posts exist before `posts[0]` (drives fetch-older on scroll).
  hasMoreBefore: Schema.Boolean,
  // Gaps over the whole channel history (PRD FR-12.4 / Q7). Cheap to recompute
  // and small even when the post history is large; clients merge by identity.
  gaps: Schema.Array(TeamChannelGapMarker).pipe(
    Schema.withDecodingDefault(
      Effect.succeed([] as TeamChannelGapMarker[] as readonly TeamChannelGapMarker[]),
    ),
  ),
  snapshotSequence: NonNegativeInt,
}).annotate({ description: "One newest-first window of a channel's posts." });
export type TeamChannelPostsReadResult = typeof TeamChannelPostsReadResult.Type;

export const TeamCommandDispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
}).annotate({
  description: "Committed team event sequence returned after dispatch.",
});
export type TeamCommandDispatchResult = typeof TeamCommandDispatchResult.Type;

export class TeamDispatchCommandError extends Schema.TaggedErrorClass<TeamDispatchCommandError>()(
  "TeamDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// ---------------------------------------------------------------------------
// R3 — Work map / radar (visibility)
// ---------------------------------------------------------------------------

// TeamWorkSignal is defined earlier (with the relay envelope family) so fan-out
// schemas can reference it without a temporal dead zone.

export const TeamWorkMapNode = Schema.Struct({
  path: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  weight: NonNegativeInt,
  memberIds: Schema.Array(MemberId),
}).annotate({ description: "One treemap cell of the work map." });
export type TeamWorkMapNode = typeof TeamWorkMapNode.Type;

export const TeamWorkMapOverlap = Schema.Struct({
  path: TrimmedNonEmptyString,
  memberIds: Schema.Array(MemberId),
  note: TrimmedNonEmptyString,
}).annotate({
  description: "Advisory overlap radar entry (FR-14.3 / FR-14.5).",
});
export type TeamWorkMapOverlap = typeof TeamWorkMapOverlap.Type;

export const TeamWorkMapReadInput = Schema.Struct({
  projectId: ProjectId,
}).annotate({ description: "Read the live work map for one project." });
export type TeamWorkMapReadInput = typeof TeamWorkMapReadInput.Type;

export const TeamWorkMapReadResult = Schema.Struct({
  projectId: ProjectId,
  nodes: Schema.Array(TeamWorkMapNode),
  overlaps: Schema.Array(TeamWorkMapOverlap),
  signals: Schema.Array(TeamWorkSignal),
  /** Whether this environment is publishing work-location signals (FR-14.4). */
  sharingEnabled: Schema.Boolean,
  updatedAt: IsoDateTime,
}).annotate({
  description: "Work map + radar projection for one project (R3).",
});
export type TeamWorkMapReadResult = typeof TeamWorkMapReadResult.Type;

// ---------------------------------------------------------------------------
// R3.3 — Digests + standup
// ---------------------------------------------------------------------------

export const TeamStandupDigestInput = Schema.Struct({
  projectId: ProjectId,
  /** Channel slug to post into; defaults to `team` when omitted. */
  channelId: Schema.optionalKey(ChannelId),
}).annotate({
  description: "Generate this environment's digest and post it to a channel (FR-15.3).",
});
export type TeamStandupDigestInput = typeof TeamStandupDigestInput.Type;

export const TeamStandupDigestResult = Schema.Struct({
  postId: PostId,
  channelId: ChannelId,
  title: TrimmedNonEmptyString,
  bullets: Schema.Array(TrimmedNonEmptyString),
}).annotate({
  description: "Standup digest that was posted to the channel.",
});
export type TeamStandupDigestResult = typeof TeamStandupDigestResult.Type;

export class TeamStandupDigestError extends Schema.TaggedErrorClass<TeamStandupDigestError>()(
  "TeamStandupDigestError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
