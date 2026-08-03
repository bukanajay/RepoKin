import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AgentId, type AgentProfile, HumanId } from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as TeamFileStoreLayer from "./Layers/TeamFileStore.ts";
import { readTeamRoster } from "./RosterRead.ts";
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
  },
};

const TestLayer = TeamFileStoreLayer.layer.pipe(Layer.provideMerge(NodeServices.layer));

it.layer(TestLayer)("readTeamRoster", (it) => {
  it.effect("returns agents from the working-tree roster", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-roster-read-",
      });
      const store = yield* TeamFileStore;
      yield* store.writeAgentProfile(cwd, aria, { commit: false });

      const roster = yield* readTeamRoster({ cwd });

      expect(roster.agents).toHaveLength(1);
      expect(roster.agents[0]?.id).toBe("agent_aria");
      expect(roster.warnings).toEqual([]);
    }),
  );
});
