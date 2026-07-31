import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { updateTeamFile } from "./TeamFileUpdate.ts";
import * as TeamFileStoreLayer from "./Layers/TeamFileStore.ts";

const TestLayer = TeamFileStoreLayer.layer.pipe(Layer.provideMerge(NodeServices.layer));

it.layer(TestLayer)("updateTeamFile", (it) => {
  it.effect("writes team.json and returns the refreshed roster", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "agentforge-team-file-update-",
      });

      const result = yield* updateTeamFile({
        cwd,
        team: {
          schemaVersion: 1,
          teamRemote: "upstream",
          displayName: "AgentForge",
        },
        commit: false,
      });

      expect(result.write.committed).toBe(false);
      expect(result.write.path.endsWith(".agentforge/team.json")).toBe(true);
      expect(result.roster.team?.teamRemote).toBe("upstream");
      expect(result.roster.team?.displayName).toBe("AgentForge");
      expect(result.roster.warnings).toEqual([]);
    }),
  );
});
