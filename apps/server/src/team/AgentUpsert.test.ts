import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AgentId, type AgentProfile, HumanId } from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { upsertTeamAgent } from "./AgentUpsert.ts";
import * as TeamFileStoreLayer from "./Layers/TeamFileStore.ts";

const aria: AgentProfile = {
  schemaVersion: 1,
  id: AgentId.make("agent_aria"),
  type: "agent",
  name: "Aria",
  owner: HumanId.make("human_julius"),
  character: {
    characterVersion: 1,
    persona: "Direct reviewer",
  },
};

const TestLayer = TeamFileStoreLayer.layer.pipe(Layer.provideMerge(NodeServices.layer));

it.layer(TestLayer)("upsertTeamAgent", (it) => {
  it.effect("writes an agent profile and returns the refreshed roster", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-agent-upsert-",
      });

      const result = yield* upsertTeamAgent({ cwd, profile: aria, commit: false });

      expect(result.write.committed).toBe(false);
      expect(result.write.path.endsWith(".repokin/agents/agent_aria.json")).toBe(true);
      expect(result.roster.agents).toHaveLength(1);
      expect(result.roster.agents[0]?.id).toBe("agent_aria");
      expect(result.roster.warnings).toEqual([]);
    }),
  );
});
