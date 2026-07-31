/**
 * CharacterCompiler live layer.
 *
 * @module CharacterCompilerLayer
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { compileCharacter, previewCharacterInstructions } from "../CharacterCompiler.ts";
import { CharacterCompiler, type CharacterCompilerShape } from "../Services/CharacterCompiler.ts";

export const make = Effect.sync(() => {
  const compile: CharacterCompilerShape["compile"] = (agent) =>
    Effect.sync(() => compileCharacter({ agent }));

  const previewInstructions: CharacterCompilerShape["previewInstructions"] = (input) =>
    Effect.sync(() =>
      previewCharacterInstructions({
        compiled: compileCharacter({ agent: input.agent }),
        driver: input.driver,
      }),
    );

  return CharacterCompiler.of({ compile, previewInstructions });
});

export const layer = Layer.effect(CharacterCompiler, make);
