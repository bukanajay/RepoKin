import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AgentId,
  type AgentProfile,
  HumanId,
  type HumanProfile,
  type TeamFile,
} from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../../processRunner.ts";
import { TeamFileStore as TeamFileStoreTag } from "../Services/TeamFileStore.ts";
import * as TeamFileStore from "./TeamFileStore.ts";

const encodeUnknownJson = Schema.encodeSync(Schema.UnknownFromJsonString);

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
  displayName: "RepoKin",
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
  name: "Aria",
  owner: HumanId.make("human_julius"),
  character: {
    characterVersion: 1,
    persona: "Direct reviewer",
    runtimeMode: "approval-required",
  },
};

const TestLayer = TeamFileStore.layer.pipe(Layer.provideMerge(NodeServices.layer));

it.layer(TestLayer)("TeamFileStore", (it) => {
  it.effect("returns an empty roster when .repokin is missing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-store-empty-",
      });
      yield* initRepo(cwd);

      const store = yield* TeamFileStoreTag;
      const roster = yield* store.readRoster(cwd);

      expect(roster.team).toBeUndefined();
      expect(roster.humans).toEqual([]);
      expect(roster.agents).toEqual([]);
      expect(roster.warnings).toEqual([]);
    }),
  );

  it.effect("writes profiles, commits only under .repokin, and reads them back", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-store-write-",
      });
      yield* initRepo(cwd);

      const store = yield* TeamFileStoreTag;

      const teamWrite = yield* store.writeTeamFile(cwd, teamFile);
      const humanWrite = yield* store.writeHumanProfile(cwd, julius);
      const agentWrite = yield* store.writeAgentProfile(cwd, aria);

      expect(teamWrite.committed).toBe(true);
      expect(humanWrite.committed).toBe(true);
      expect(agentWrite.committed).toBe(true);

      const roster = yield* store.readRoster(cwd);
      expect(roster.team).toMatchObject({ schemaVersion: 1, displayName: "RepoKin" });
      expect(roster.humans).toHaveLength(1);
      expect(roster.humans[0]?.id).toBe("human_julius");
      expect(roster.agents).toHaveLength(1);
      expect(roster.agents[0]?.name).toBe("Aria");
      expect(roster.warnings).toEqual([]);

      // Outside .repokin must not appear in the latest team commits as accidental staging.
      const log = yield* git(cwd, ["log", "--oneline"]);
      expect(log.stdout).toContain("chore(team):");

      // Working tree should contain the files at expected paths.
      const ariaPath = path.join(cwd, ".repokin", "agents", "aria.json");
      const ariaRaw = yield* fileSystem.readFileString(ariaPath);
      expect(ariaRaw).toContain("agent_aria");
      expect(ariaRaw).not.toContain("OPENAI_API_KEY");
    }),
  );

  it.effect("preserves a committed roster across independent clones", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-store-clones-",
      });
      const remote = path.join(root, "team.git");
      const firstClone = path.join(root, "first");
      const secondClone = path.join(root, "second");

      yield* git(root, ["init", "--bare", "--initial-branch=main", remote]);
      yield* git(root, ["clone", remote, firstClone]);
      yield* git(firstClone, ["config", "user.email", "test@example.com"]);
      yield* git(firstClone, ["config", "user.name", "Test User"]);
      yield* fileSystem.writeFileString(path.join(firstClone, "README.md"), "hello\n");
      yield* git(firstClone, ["add", "README.md"]);
      yield* git(firstClone, ["commit", "-m", "Initial commit"]);
      yield* git(firstClone, ["push", "-u", "origin", "main"]);

      const store = yield* TeamFileStoreTag;
      yield* store.writeTeamFile(firstClone, teamFile);
      yield* store.writeHumanProfile(firstClone, julius);
      yield* store.writeAgentProfile(firstClone, aria);
      yield* git(firstClone, ["push"]);

      yield* git(root, ["clone", remote, secondClone]);
      const clonedRoster = yield* store.readRoster(secondClone);

      expect(clonedRoster.team?.displayName).toBe("RepoKin");
      expect(clonedRoster.humans.map((human) => human.id)).toEqual(["human_julius"]);
      expect(clonedRoster.agents.map((agent) => agent.id)).toEqual(["agent_aria"]);
      expect(clonedRoster.warnings).toEqual([]);
    }),
  );

  it.effect("skips malformed profiles with warnings instead of failing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-store-malformed-",
      });
      yield* initRepo(cwd);

      const store = yield* TeamFileStoreTag;
      yield* store.writeAgentProfile(cwd, aria, { commit: false });

      const badPath = path.join(cwd, ".repokin", "agents", "broken.json");
      yield* fileSystem.writeFileString(badPath, "{ not json");

      const roster = yield* store.readRoster(cwd);
      expect(roster.agents).toHaveLength(1);
      expect(roster.agents[0]?.id).toBe("agent_aria");
      expect(roster.warnings.some((warning) => warning.includes("broken.json"))).toBe(true);
    }),
  );

  it.effect("reads roster from a git ref without requiring a clean working tree", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-store-ref-",
      });
      yield* initRepo(cwd);

      const store = yield* TeamFileStoreTag;
      yield* store.writeHumanProfile(cwd, julius);
      yield* store.writeAgentProfile(cwd, aria);

      // Dirty the working tree after commit — ref read must not depend on it.
      yield* fileSystem.writeFileString(
        path.join(cwd, ".repokin", "agents", "aria.json"),
        encodeUnknownJson({
          ...aria,
          name: "Dirty Working Tree Aria",
        }),
      );

      const fromRef = yield* store.readRosterFromRef(cwd, "HEAD");
      expect(fromRef.agents).toHaveLength(1);
      expect(fromRef.agents[0]?.name).toBe("Aria");
      expect(fromRef.humans[0]?.id).toBe("human_julius");

      const fromWorktree = yield* store.readRoster(cwd);
      expect(fromWorktree.agents[0]?.name).toBe("Dirty Working Tree Aria");
    }),
  );

  it.effect("preserves unknown profile fields on write → read", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-store-unknown-",
      });
      yield* initRepo(cwd);

      const store = yield* TeamFileStoreTag;
      const futureAgent = {
        ...aria,
        futureField: "keep-me",
        character: {
          ...aria.character,
          futureChar: 1,
        },
      } as AgentProfile;

      yield* store.writeAgentProfile(cwd, futureAgent, { commit: false });
      const roster = yield* store.readRoster(cwd);
      const encoded = roster.agents[0] as AgentProfile & {
        futureField?: string;
        character: { futureChar?: number };
      };
      expect(encoded.futureField).toBe("keep-me");
      expect(encoded.character.futureChar).toBe(1);
    }),
  );
});
