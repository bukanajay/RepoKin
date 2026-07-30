/**
 * AgentForge team contracts — roster, character, and compiled character shapes.
 *
 * Lives on the `./team` subpath export so it never touches the main contracts
 * barrel (fork-policy: additive only). Schema only; no runtime logic.
 *
 * Repository layout (see PRD §7):
 *   .agentforge/team.json
 *   .agentforge/humans/<slug>.json
 *   .agentforge/agents/<slug>.json
 *
 * @module team
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { EnvironmentId, IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
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
export const AGENTFORGE_DIR_NAME = ".agentforge";

/** Team-level config file name under {@link AGENTFORGE_DIR_NAME}. */
export const TEAM_FILE_NAME = "team.json";

/** Subdirectory of human member profiles. */
export const TEAM_HUMANS_DIR_NAME = "humans";

/** Subdirectory of agent member profiles. */
export const TEAM_AGENTS_DIR_NAME = "agents";

export const TEAM_FILE_SCHEMA_URL = "https://agentforge.dev/schema/team.json";
export const HUMAN_PROFILE_SCHEMA_URL = "https://agentforge.dev/schema/human.json";
export const AGENT_PROFILE_SCHEMA_URL = "https://agentforge.dev/schema/agent.json";

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
      "Checked-in human member profile under .agentforge/humans/. No secrets, tokens, or private keys.",
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
      "Checked-in agent profile under .agentforge/agents/. Character only — never provider credentials or sensitive env vars.",
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
    title: "AgentForge team file",
    description:
      "Team-level config at .agentforge/team.json. Roster members live as separate files under humans/ and agents/.",
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
  description: "In-memory roster snapshot projected from .agentforge/.",
});
export type TeamRosterReadModel = typeof TeamRosterReadModel.Type;

/** Presence states for M2+; defined early so the UI can soft-depend. */
export const MemberPresenceState = Schema.Literals(["online", "busy", "away", "offline"]).annotate({
  description: "Presence state for a member in an environment. Never committed to Git.",
});
export type MemberPresenceState = typeof MemberPresenceState.Type;

export const TeamMemberUpsertCommand = Schema.Struct({
  type: Schema.Literal("team.member.upsert"),
  profile: MemberProfile,
}).annotate({
  description: "Upsert a human or agent profile into the local .agentforge/ tree.",
});
export type TeamMemberUpsertCommand = typeof TeamMemberUpsertCommand.Type;

export const TeamAgentAssignCommand = Schema.Struct({
  type: Schema.Literal("team.agent.assign"),
  agentId: AgentId,
  providerInstanceId: ProviderInstanceId,
}).annotate({
  description: "Bind an agent to a local provider instance (environment-local).",
});
export type TeamAgentAssignCommand = typeof TeamAgentAssignCommand.Type;

export const TeamCommand = Schema.Union([TeamMemberUpsertCommand, TeamAgentAssignCommand]);
export type TeamCommand = typeof TeamCommand.Type;

export const TeamMemberUpsertedEvent = Schema.Struct({
  type: Schema.Literal("team.member.upserted"),
  memberId: MemberId,
  memberType: MemberType,
  at: IsoDateTime,
}).annotate({
  description: "A member profile was written under .agentforge/.",
});
export type TeamMemberUpsertedEvent = typeof TeamMemberUpsertedEvent.Type;

export const TeamAgentAssignedEvent = Schema.Struct({
  type: Schema.Literal("team.agent.assigned"),
  agentId: AgentId,
  providerInstanceId: ProviderInstanceId,
  at: IsoDateTime,
}).annotate({
  description: "An agent was bound to a local provider instance.",
});
export type TeamAgentAssignedEvent = typeof TeamAgentAssignedEvent.Type;

export const TeamEvent = Schema.Union([TeamMemberUpsertedEvent, TeamAgentAssignedEvent]);
export type TeamEvent = typeof TeamEvent.Type;
