import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import { AgentId, type AgentProfile, HumanId } from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { previewTeamInstructions } from "./InstructionPreview.ts";
import * as CharacterCompilerLayer from "./Layers/CharacterCompiler.ts";
import * as TeamFileStoreLayer from "./Layers/TeamFileStore.ts";
import { TeamFileStore } from "./Services/TeamFileStore.ts";

const aria: AgentProfile = {
  schemaVersion: 1,
  id: AgentId.make("agent_aria"),
  type: "agent",
  name: "Aria",
  owner: HumanId.make("human_julius"),
  character: {
    characterVersion: 1,
    persona: "Direct reviewer",
    runtimeMode: "approval-required",
    interactionMode: "plan",
  },
};

const TestLayer = Layer.merge(TeamFileStoreLayer.layer, CharacterCompilerLayer.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("previewTeamInstructions", (it) => {
  it.effect("returns provider-specific instructions and mechanical metadata", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "agentforge-preview-",
      });
      const store = yield* TeamFileStore;
      yield* store.writeAgentProfile(cwd, aria, { commit: false });

      const preview = yield* previewTeamInstructions({
        cwd,
        agentId: aria.id,
        driver: ProviderDriverKind.make("codex"),
      });

      expect(preview.agentId).toBe(aria.id);
      expect(preview.driver).toBe("codex");
      expect(preview.instructions).toContain("Direct reviewer");
      expect(preview.mechanics.runtimeMode).toBe("approval-required");
      expect(preview.mechanics.interactionMode).toBe("plan");
      expect(preview.mechanicalHash).toMatch(/^[a-f0-9]{64}$/);
    }),
  );

  it.effect("fails when the requested agent is not in the roster", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "agentforge-preview-missing-",
      });

      const error = yield* previewTeamInstructions({
        cwd,
        agentId: AgentId.make("agent_missing"),
        driver: ProviderDriverKind.make("codex"),
      }).pipe(Effect.flip);

      expect(error.reason).toBe("agent-not-found");
      expect(error.agentId).toBe("agent_missing");
    }),
  );
});
