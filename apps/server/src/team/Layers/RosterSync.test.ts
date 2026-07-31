import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { BackgroundScope } from "@t3tools/contracts";
import {
  AgentId,
  type AgentProfile,
  HumanId,
  type HumanProfile,
  type TeamFile,
} from "@t3tools/contracts/team";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import { RosterSync, TeamRosterSyncOperationError } from "../Services/RosterSync.ts";
import * as TeamFileStoreLayer from "./TeamFileStore.ts";
import * as RosterSyncLayer from "./RosterSync.ts";

const encodeUnknownJson = Schema.encodeSync(Schema.UnknownFromJsonString);
const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    return yield* processRunner.run({
      command: "git",
      args: ["-C", cwd, ...args],
    });
  }).pipe(Effect.provide(ProcessRunner.layer));

const initRepo = (cwd: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* git(cwd, ["init", "--initial-branch=main"]);
    yield* git(cwd, ["config", "user.email", "test@example.com"]);
    yield* git(cwd, ["config", "user.name", "Test User"]);
    yield* fileSystem.writeFileString(path.join(cwd, "README.md"), "hello\n");
    yield* git(cwd, ["add", "README.md"]);
    yield* git(cwd, ["commit", "-m", "Initial commit"]);
  });

const teamFile: TeamFile = {
  schemaVersion: 1,
  teamRemote: "origin",
  displayName: "AgentForge",
};

const teamFileWithoutRemote: TeamFile = {
  schemaVersion: 1,
  displayName: "AgentForge",
};

const julius: HumanProfile = {
  schemaVersion: 1,
  id: HumanId.make("human_julius"),
  type: "human",
  displayName: "Julius",
  gitEmails: ["julius@example.com"],
};

const aria: AgentProfile = {
  schemaVersion: 1,
  id: AgentId.make("agent_aria"),
  type: "agent",
  name: "Remote Aria",
  owner: HumanId.make("human_julius"),
  character: {
    characterVersion: 1,
    persona: "Remote implementation agent",
    runtimeMode: "approval-required",
  },
};

function makeBackgroundPolicyLayer(shouldRunScopeWork: (scope: BackgroundScope) => boolean) {
  return Layer.mock(BackgroundPolicy.BackgroundPolicy)({
    reportClientActivity: () => Effect.void,
    removeRpcClient: () => Effect.void,
    reportHostPowerState: () => Effect.void,
    snapshot: Effect.succeed({
      hostPower: {
        source: "unknown",
        idle: "unknown",
        idleSeconds: null,
        locked: "unknown",
        suspended: false,
        onBattery: "unknown",
        lowPowerMode: "unknown",
        thermalState: "unknown",
        stale: true,
        updatedAt: TEST_EPOCH,
      },
      leases: [],
      activeForegroundLeaseCount: 0,
      activeScopeKeys: [],
      shouldRunOpportunisticWork: false,
      updatedAt: TEST_EPOCH,
    }),
    streamChanges: Stream.empty,
    hasDemand: () => Effect.succeed(true),
    shouldRunScopeWork: (scope) => Effect.sync(() => shouldRunScopeWork(scope)),
    shouldRunOpportunisticWork: Effect.succeed(true),
  });
}

const TestLayer = RosterSyncLayer.layer.pipe(
  Layer.provideMerge(TeamFileStoreLayer.layer),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(makeBackgroundPolicyLayer(() => true)),
  Layer.provideMerge(NodeServices.layer),
);

const HiddenProjectTestLayer = RosterSyncLayer.layer.pipe(
  Layer.provideMerge(TeamFileStoreLayer.layer),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(makeBackgroundPolicyLayer(() => false)),
  Layer.provideMerge(NodeServices.layer),
);

it("suggests upstream before origin without treating the suggestion as confirmed", () => {
  expect(
    RosterSyncLayer.suggestTeamRemote([{ name: "origin" }, { name: "upstream" }, { name: "fork" }]),
  ).toEqual({
    remote: "upstream",
    source: "suggested-default",
    requiresConfirmation: true,
  });
  expect(RosterSyncLayer.suggestTeamRemote([{ name: "fork" }])).toBeNull();
});

it.layer(TestLayer)("RosterSync", (it) => {
  it.effect(
    "fetches the configured team remote into an AgentForge ref and reads it without checkout",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const store = yield* TeamFileStore;
        const sync = yield* RosterSync;

        const remote = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "agentforge-roster-remote-",
        });
        const author = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "agentforge-roster-author-",
        });
        const cloneParent = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "agentforge-roster-clone-parent-",
        });
        const consumer = path.join(cloneParent, "consumer");

        yield* git(remote, ["init", "--bare", "--initial-branch=main"]);
        yield* initRepo(author);
        yield* git(author, ["remote", "add", "origin", remote]);
        yield* store.writeTeamFile(author, teamFile);
        yield* store.writeHumanProfile(author, julius);
        yield* store.writeAgentProfile(author, aria, { fileSlug: "aria" });
        yield* git(author, ["push", "-u", "origin", "main"]);

        yield* git(cloneParent, ["clone", remote, consumer]);
        yield* git(consumer, ["config", "user.email", "consumer@example.com"]);
        yield* git(consumer, ["config", "user.name", "Consumer"]);
        const headBefore = (yield* git(consumer, ["rev-parse", "HEAD"])).stdout.trim();

        yield* fileSystem.writeFileString(
          path.join(consumer, ".agentforge", "agents", "aria.json"),
          `${encodeUnknownJson({
            ...aria,
            name: "Dirty Local Aria",
          })}\n`,
        );

        yield* store.writeAgentProfile(
          author,
          {
            ...aria,
            name: "Remote Aria v2",
          },
          { fileSlug: "aria" },
        );
        yield* git(author, ["push", "origin", "main"]);

        const result = yield* sync.syncProjectRoster(consumer);
        expect(result.remote).toBe("origin");
        expect(result.branch).toBe("main");
        expect(result.ref).toMatch(/^refs\/agentforge\/rosters\/[0-9a-f]{24}$/);
        expect(result.roster.agents[0]?.name).toBe("Remote Aria v2");

        const dirtyAgent = yield* fileSystem.readFileString(
          path.join(consumer, ".agentforge", "agents", "aria.json"),
        );
        expect(dirtyAgent).toContain("Dirty Local Aria");
        expect((yield* git(consumer, ["rev-parse", "HEAD"])).stdout.trim()).toBe(headBefore);
        expect((yield* git(consumer, ["status", "--short"])).stdout).toContain(
          "M .agentforge/agents/aria.json",
        );
      }),
  );

  it.effect("requires an explicit teamRemote before syncing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const store = yield* TeamFileStore;
      const sync = yield* RosterSync;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "agentforge-roster-no-remote-",
      });
      yield* initRepo(cwd);
      yield* store.writeTeamFile(cwd, teamFileWithoutRemote);

      const error = yield* sync.syncProjectRoster(cwd).pipe(Effect.flip);
      expect(error).toBeInstanceOf(TeamRosterSyncOperationError);
      expect(error.operation).toBe("read-local-roster");
      expect(error.message).toContain("team remote is not configured");
    }),
  );
});

it.layer(HiddenProjectTestLayer)("RosterSync visibility gate", (it) => {
  it.effect("skips background roster sync when scoped work is not allowed", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const sync = yield* RosterSync;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "agentforge-roster-hidden-",
      });

      const result = yield* sync.syncProjectRosterIfVisible(cwd);
      expect(result).toBeNull();
    }),
  );
});
