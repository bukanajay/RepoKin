import { expect, it } from "@effect/vitest";
import { AgentId, type AgentProfile, HumanId } from "@t3tools/contracts/team";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { CharacterCompiler as CharacterCompilerTag } from "../Services/CharacterCompiler.ts";
import * as CharacterCompiler from "./CharacterCompiler.ts";

const agent: AgentProfile = {
  schemaVersion: 1,
  id: AgentId.make("agent_docs"),
  type: "agent",
  name: "Docs",
  owner: HumanId.make("human_julius"),
  character: {
    characterVersion: 1,
    persona: "Explains code clearly.",
    interactionMode: "plan",
  },
};

it.layer(CharacterCompiler.layer)("CharacterCompiler service", (it) => {
  it.effect("compiles and previews instructions", () =>
    Effect.gen(function* () {
      const compiler = yield* CharacterCompilerTag;
      const compiled = yield* compiler.compile(agent);
      const preview = yield* compiler.previewInstructions({
        agent,
        driver: ProviderDriverKind.make("codex"),
      });

      expect(compiled.agentId).toBe("agent_docs");
      expect(compiled.mechanics.interactionMode).toBe("plan");
      expect(preview).toContain("Explains code clearly.");
    }),
  );
});
