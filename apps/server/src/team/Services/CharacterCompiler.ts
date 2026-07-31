/**
 * CharacterCompiler service — pure compiler behind a service tag for adapters
 * and future preview routes.
 *
 * @module CharacterCompilerService
 */
import type { AgentProfile, CompiledCharacter } from "@t3tools/contracts/team";
import type { ProviderDriverKind } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface CharacterCompilerShape {
  readonly compile: (agent: AgentProfile) => Effect.Effect<CompiledCharacter>;
  readonly previewInstructions: (
    input: Readonly<{
      readonly agent: AgentProfile;
      readonly driver: ProviderDriverKind;
    }>,
  ) => Effect.Effect<string | undefined>;
}

export class CharacterCompiler extends Context.Service<CharacterCompiler, CharacterCompilerShape>()(
  "t3/team/Services/CharacterCompiler",
) {}
