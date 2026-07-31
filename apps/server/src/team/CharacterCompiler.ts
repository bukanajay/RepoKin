/**
 * Pure AgentForge character compiler.
 *
 * Keep provider-specific wording decisions here so adapters only splice the
 * compiled instruction text into their native launch path.
 *
 * @module CharacterCompiler
 */
import {
  DEFAULT_CHARACTER_RUNTIME_MODE,
  type AgentProfile,
  type Character,
  type CharacterProviderPreference,
  type CharacterToolPolicy,
  type CompiledCharacter,
  type CompiledCharacterMechanics,
} from "@t3tools/contracts/team";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProviderDriverKind,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { createHash } from "node:crypto";

export const CODEX_DRIVER = ProviderDriverKind.make("codex");
export const CLAUDE_AGENT_DRIVER = ProviderDriverKind.make("claudeAgent");
export const CURSOR_DRIVER = ProviderDriverKind.make("cursor");
export const GROK_DRIVER = ProviderDriverKind.make("grok");
export const OPENCODE_DRIVER = ProviderDriverKind.make("opencode");

export const CHARACTER_INSTRUCTION_DRIVERS = [
  CODEX_DRIVER,
  CLAUDE_AGENT_DRIVER,
  CURSOR_DRIVER,
  GROK_DRIVER,
  OPENCODE_DRIVER,
] as const;

export interface CompileCharacterOptions {
  readonly agent: AgentProfile;
}

export interface PreviewCharacterInstructionsOptions {
  readonly compiled: CompiledCharacter;
  readonly driver: ProviderDriverKind;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const driverLabels = new Map<ProviderDriverKind, string>([
  [CODEX_DRIVER, "Codex"],
  [CLAUDE_AGENT_DRIVER, "Claude Code"],
  [CURSOR_DRIVER, "Cursor"],
  [GROK_DRIVER, "Grok"],
  [OPENCODE_DRIVER, "OpenCode"],
]);

const toJsonValue = (value: unknown): JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, toJsonValue(entryValue)]));
  }
  return String(value);
};

const stableStringify = (value: unknown): string => JSON.stringify(toJsonValue(value));

const sha256Hex = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

const asReadonlyStringArray = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;

const fieldLines = (label: string, values: readonly string[] | undefined): readonly string[] => {
  if (values === undefined || values.length === 0) {
    return [];
  }
  return [`${label}:`, ...values.map((value) => `- ${value}`)];
};

const optionalLine = (label: string, value: string | undefined): readonly string[] =>
  value === undefined || value.trim().length === 0 ? [] : [`${label}: ${value.trim()}`];

const buildMechanics = (character: Character): CompiledCharacterMechanics => ({
  ...(character.provider ? { provider: character.provider as CharacterProviderPreference } : {}),
  runtimeMode: (character.runtimeMode ?? DEFAULT_CHARACTER_RUNTIME_MODE) as RuntimeMode,
  interactionMode: (character.interactionMode ??
    DEFAULT_PROVIDER_INTERACTION_MODE) as ProviderInteractionMode,
  ...(character.toolPolicy ? { toolPolicy: character.toolPolicy as CharacterToolPolicy } : {}),
  ...(character.pathScope ? { pathScope: character.pathScope } : {}),
});

const buildMechanicalHashInput = (mechanics: CompiledCharacterMechanics) => ({
  provider: mechanics.provider,
  runtimeMode: mechanics.runtimeMode,
  interactionMode: mechanics.interactionMode,
  toolPolicy: mechanics.toolPolicy,
  pathScope: mechanics.pathScope,
});

const buildExpressiveInstructions = (agent: AgentProfile): readonly string[] => {
  const character = agent.character;
  const communication = character.communication as
    | { readonly verbosity?: string; readonly reportsWith?: string }
    | undefined;

  return [
    `Agent identity: ${agent.name} (${agent.id}).`,
    `Owner: ${agent.owner}.`,
    ...optionalLine("Persona", character.persona),
    ...fieldLines("Expertise", asReadonlyStringArray(character.expertise)),
    ...fieldLines("Conventions", asReadonlyStringArray(character.conventions)),
    ...optionalLine("Communication verbosity", communication?.verbosity),
    ...optionalLine("Preferred report shape", communication?.reportsWith),
  ];
};

const buildMechanicalSummary = (mechanics: CompiledCharacterMechanics): readonly string[] => [
  "Mechanical settings enforced by the harness:",
  `- Runtime mode: ${mechanics.runtimeMode}`,
  `- Interaction mode: ${mechanics.interactionMode}`,
  ...(mechanics.provider
    ? [
        `- Preferred provider: ${mechanics.provider.driver}`,
        ...(mechanics.provider.model ? [`- Preferred model: ${mechanics.provider.model}`] : []),
      ]
    : []),
  ...(mechanics.pathScope && mechanics.pathScope.length > 0
    ? ["- Path scope:", ...mechanics.pathScope.map((scope) => `  - ${scope}`)]
    : []),
  ...(mechanics.toolPolicy?.allow && mechanics.toolPolicy.allow.length > 0
    ? ["- Allowed tools:", ...mechanics.toolPolicy.allow.map((tool) => `  - ${tool}`)]
    : []),
  ...(mechanics.toolPolicy?.deny && mechanics.toolPolicy.deny.length > 0
    ? ["- Denied tools:", ...mechanics.toolPolicy.deny.map((tool) => `  - ${tool}`)]
    : []),
];

const buildInstructionsForDriver = (
  agent: AgentProfile,
  mechanics: CompiledCharacterMechanics,
  driver: ProviderDriverKind,
): string => {
  const label = driverLabels.get(driver) ?? String(driver);
  return [
    "<agentforge_character>",
    `You are running this turn as the AgentForge agent ${agent.name}.`,
    `Provider driver: ${label}.`,
    "",
    ...buildExpressiveInstructions(agent),
    "",
    ...buildMechanicalSummary(mechanics),
    "",
    "Treat expressive character as behavioral guidance. Mechanical settings are enforced outside the model; do not claim to override them.",
    "</agentforge_character>",
  ].join("\n");
};

export function compileCharacter(options: CompileCharacterOptions): CompiledCharacter {
  const mechanics = buildMechanics(options.agent.character);
  const instructionsByDriver = Object.fromEntries(
    CHARACTER_INSTRUCTION_DRIVERS.map((driver) => [
      driver,
      buildInstructionsForDriver(options.agent, mechanics, driver),
    ]),
  ) as Record<ProviderDriverKind, string>;

  return {
    agentId: options.agent.id,
    characterVersion: options.agent.character.characterVersion,
    instructionsByDriver,
    mechanics,
    mechanicalHash: sha256Hex(buildMechanicalHashInput(mechanics)),
  };
}

export function previewCharacterInstructions(
  options: PreviewCharacterInstructionsOptions,
): string | undefined {
  return options.compiled.instructionsByDriver[options.driver];
}
