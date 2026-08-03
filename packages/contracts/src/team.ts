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

export const TeamRelayEnvelope = Schema.Union([
  TeamSignedMessageEnvelope,
  TeamSignedDeliveryReceiptEnvelope,
]).annotate({
  description: "Signed RepoKin message or delivery receipt transported through the relay.",
});
export type TeamRelayEnvelope = typeof TeamRelayEnvelope.Type;

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

export const TeamCommand = Schema.Union([
  TeamMemberUpsertCommand,
  TeamAgentAssignCommand,
  TeamMessageSendCommand,
  TeamMessageDeliverCommand,
  TeamMessageMarkReadCommand,
  TeamMessageExpireCommand,
  TeamRequestRespondCommand,
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
  threadId: ThreadId,
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

export const TeamEvent = Schema.Union([
  TeamMemberUpsertedEvent,
  TeamAgentAssignedEvent,
  TeamMessageQueuedEvent,
  TeamMessageDeliveredEvent,
  TeamMessageReadEvent,
  TeamMessageExpiredEvent,
  TeamRequestCreatedEvent,
  TeamRequestRespondedEvent,
]);
export type TeamEvent = typeof TeamEvent.Type;
export type PlannedTeamEvent = TeamEvent extends infer Event
  ? Event extends TeamEvent
    ? Omit<Event, "sequence">
    : never
  : never;

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
  threadId: ThreadId,
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

export const TeamProjectReadModel = Schema.Struct({
  projectId: ProjectId,
  members: Schema.Array(TeamMemberReadModel),
  assignments: Schema.Array(TeamThreadAssignment),
  inbox: Schema.Array(TeamInboxMessage),
  requests: Schema.Array(TeamRequestReadModel),
  activities: Schema.Array(TeamActivity),
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

export const TeamLocalStateReadResult = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  project: Schema.NullOr(TeamProjectReadModel),
  // Presence for every member of `project`, resolved locally or (for a
  // roster agent whose home environment differs from this one) via the
  // relay (M3.3). Never surfaced when `project` is null.
  presences: Schema.Array(TeamMemberPresenceEntry),
}).annotate({
  description: "Environment-local team coordination state for one project.",
});
export type TeamLocalStateReadResult = typeof TeamLocalStateReadResult.Type;

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
