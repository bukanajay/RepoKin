/**
 * TeamFileStore live layer — filesystem + git show/ls-tree roster IO.
 *
 * @module TeamFileStoreLayer
 */
import {
  AgentProfile,
  HumanProfile,
  TeamFile,
  type TeamRosterReadModel,
} from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { writeFileStringAtomically } from "../../atomicWrite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import {
  TeamFileStore,
  TeamFileStoreError,
  type TeamFileStoreShape,
  type TeamWriteResult,
} from "../Services/TeamFileStore.ts";
import * as TeamPaths from "../TeamPaths.ts";

const decodeTeamFileJson = Schema.decodeUnknownEffect(Schema.fromJsonString(TeamFile));
const encodeTeamFileJson = Schema.encodeEffect(Schema.fromJsonString(TeamFile));
const decodeHumanProfileJson = Schema.decodeUnknownEffect(Schema.fromJsonString(HumanProfile));
const encodeHumanProfileJson = Schema.encodeEffect(Schema.fromJsonString(HumanProfile));
const decodeAgentProfileJson = Schema.decodeUnknownEffect(Schema.fromJsonString(AgentProfile));
const encodeAgentProfileJson = Schema.encodeEffect(Schema.fromJsonString(AgentProfile));

const emptyRoster = (): TeamRosterReadModel => ({
  humans: [],
  agents: [],
  warnings: [],
});

type DecodeJsonEffect<A> = (text: string) => Effect.Effect<A, Schema.SchemaError>;

const resolveGitTopLevel = Effect.fn("TeamFileStore.resolveGitTopLevel")(function* (cwd: string) {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const result = yield* processRunner
    .run({
      command: "git",
      args: ["-C", cwd, "rev-parse", "--show-toplevel"],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);

  if (result._tag === "None" || result.value.code !== 0) {
    return Option.none<string>();
  }

  const topLevel = result.value.stdout.trim();
  return topLevel.length > 0 ? Option.some(topLevel) : Option.none<string>();
});

const listJsonFilesInDirectory = Effect.fn("TeamFileStore.listJsonFilesInDirectory")(function* (
  directory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const exists = yield* fileSystem.exists(directory).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return [] as ReadonlyArray<string>;
  }

  const entries = yield* fileSystem.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(directory, name))
    .toSorted((left, right) => left.localeCompare(right));
});

const readAndDecodeFile = <A>(input: {
  readonly filePath: string;
  readonly label: string;
  readonly decodeJson: DecodeJsonEffect<A>;
}): Effect.Effect<
  { readonly ok: true; readonly value: A } | { readonly ok: false; readonly warning: string },
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(input.filePath).pipe(Effect.option);
    if (Option.isNone(raw)) {
      return {
        ok: false as const,
        warning: `Missing ${input.label} at ${input.filePath}`,
      };
    }

    const decoded = yield* input.decodeJson(raw.value).pipe(Effect.option);
    if (Option.isNone(decoded)) {
      return {
        ok: false as const,
        warning: `Skipped malformed ${input.label} at ${input.filePath}`,
      };
    }
    return { ok: true as const, value: decoded.value };
  });

const readRosterFromWorkingTree = Effect.fn("TeamFileStore.readRosterFromWorkingTree")(function* (
  workspaceRoot: string,
) {
  const warnings: string[] = [];
  const teamPath = TeamPaths.teamFilePath(workspaceRoot);
  const teamResult = yield* readAndDecodeFile({
    filePath: teamPath,
    label: "team.json",
    decodeJson: decodeTeamFileJson,
  });

  let team: TeamFile | undefined;
  if (teamResult.ok) {
    team = teamResult.value;
  } else {
    const fileSystem = yield* FileSystem.FileSystem;
    const exists = yield* fileSystem.exists(teamPath).pipe(Effect.orElseSucceed(() => false));
    if (exists) {
      warnings.push(teamResult.warning);
    }
  }

  const humans: Array<HumanProfile> = [];
  for (const filePath of yield* listJsonFilesInDirectory(TeamPaths.humansDir(workspaceRoot))) {
    const result = yield* readAndDecodeFile({
      filePath,
      label: "human profile",
      decodeJson: decodeHumanProfileJson,
    });
    if (result.ok) {
      humans.push(result.value);
    } else {
      warnings.push(result.warning);
    }
  }

  const agents: Array<AgentProfile> = [];
  for (const filePath of yield* listJsonFilesInDirectory(TeamPaths.agentsDir(workspaceRoot))) {
    const result = yield* readAndDecodeFile({
      filePath,
      label: "agent profile",
      decodeJson: decodeAgentProfileJson,
    });
    if (result.ok) {
      agents.push(result.value);
    } else {
      warnings.push(result.warning);
    }
  }

  return {
    ...(team === undefined ? {} : { team }),
    humans,
    agents,
    warnings,
  } satisfies TeamRosterReadModel;
});

const gitShow = Effect.fn("TeamFileStore.gitShow")(function* (
  repoRoot: string,
  ref: string,
  relativePath: string,
) {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const result = yield* processRunner
    .run({
      command: "git",
      args: ["-C", repoRoot, "show", `${ref}:${relativePath}`],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);

  if (result._tag === "None" || result.value.code !== 0) {
    return Option.none<string>();
  }
  return Option.some(result.value.stdout);
});

const gitListTree = Effect.fn("TeamFileStore.gitListTree")(function* (
  repoRoot: string,
  ref: string,
  relativeDir: string,
) {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const result = yield* processRunner
    .run({
      command: "git",
      args: ["-C", repoRoot, "ls-tree", "-r", "--name-only", ref, "--", relativeDir],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);

  if (result._tag === "None" || result.value.code !== 0) {
    return [] as ReadonlyArray<string>;
  }

  return result.value.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".json"))
    .toSorted((left, right) => left.localeCompare(right));
});

const decodeJsonText = <A>(input: {
  readonly text: string;
  readonly label: string;
  readonly path: string;
  readonly decodeJson: DecodeJsonEffect<A>;
}): Effect.Effect<
  { readonly ok: true; readonly value: A } | { readonly ok: false; readonly warning: string }
> =>
  input.decodeJson(input.text).pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.orElseSucceed(() => ({
      ok: false as const,
      warning: `Skipped malformed ${input.label} at ${input.path}`,
    })),
  );

const readRosterFromRef = Effect.fn("TeamFileStore.readRosterFromRef")(function* (
  workspaceRoot: string,
  ref: string,
) {
  const repoRootOption = yield* resolveGitTopLevel(workspaceRoot);
  if (Option.isNone(repoRootOption)) {
    return {
      ...emptyRoster(),
      warnings: [`Not a git repository: ${workspaceRoot}`],
    } satisfies TeamRosterReadModel;
  }

  const repoRoot = repoRootOption.value;
  const warnings: string[] = [];

  const teamText = yield* gitShow(repoRoot, ref, TeamPaths.teamFilePathRelative());
  let team: TeamFile | undefined;
  if (Option.isSome(teamText)) {
    const decoded = yield* decodeJsonText({
      text: teamText.value,
      label: "team.json",
      path: `${ref}:${TeamPaths.teamFilePathRelative()}`,
      decodeJson: decodeTeamFileJson,
    });
    if (decoded.ok) {
      team = decoded.value;
    } else {
      warnings.push(decoded.warning);
    }
  }

  const humans: Array<HumanProfile> = [];
  for (const relativePath of yield* gitListTree(
    repoRoot,
    ref,
    TeamPaths.joinPosix(TeamPaths.repokinDirRelative(), "humans"),
  )) {
    const text = yield* gitShow(repoRoot, ref, relativePath);
    if (Option.isNone(text)) {
      warnings.push(`Missing human profile at ${ref}:${relativePath}`);
      continue;
    }
    const decoded = yield* decodeJsonText({
      text: text.value,
      label: "human profile",
      path: `${ref}:${relativePath}`,
      decodeJson: decodeHumanProfileJson,
    });
    if (decoded.ok) {
      humans.push(decoded.value);
    } else {
      warnings.push(decoded.warning);
    }
  }

  const agents: Array<AgentProfile> = [];
  for (const relativePath of yield* gitListTree(
    repoRoot,
    ref,
    TeamPaths.joinPosix(TeamPaths.repokinDirRelative(), "agents"),
  )) {
    const text = yield* gitShow(repoRoot, ref, relativePath);
    if (Option.isNone(text)) {
      warnings.push(`Missing agent profile at ${ref}:${relativePath}`);
      continue;
    }
    const decoded = yield* decodeJsonText({
      text: text.value,
      label: "agent profile",
      path: `${ref}:${relativePath}`,
      decodeJson: decodeAgentProfileJson,
    });
    if (decoded.ok) {
      agents.push(decoded.value);
    } else {
      warnings.push(decoded.warning);
    }
  }

  return {
    ...(team === undefined ? {} : { team }),
    humans,
    agents,
    warnings,
  } satisfies TeamRosterReadModel;
});

const commitRepokinPath = Effect.fn("TeamFileStore.commitRepokinPath")(function* (input: {
  readonly repoRoot: string;
  readonly relativePath: string;
  readonly message: string;
}) {
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const addResult = yield* processRunner
    .run({
      command: "git",
      args: ["-C", input.repoRoot, "add", "--", input.relativePath],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamFileStoreError({
            operation: "commit",
            workspaceRoot: input.repoRoot,
            path: input.relativePath,
            cause,
          }),
      ),
    );
  if (addResult.code !== 0) {
    return yield* new TeamFileStoreError({
      operation: "commit",
      workspaceRoot: input.repoRoot,
      path: input.relativePath,
      cause: addResult.stderr || `git add exited ${String(addResult.code)}`,
    });
  }

  const commitResult = yield* processRunner
    .run({
      command: "git",
      args: ["-C", input.repoRoot, "commit", "-m", input.message, "--", input.relativePath],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamFileStoreError({
            operation: "commit",
            workspaceRoot: input.repoRoot,
            path: input.relativePath,
            cause,
          }),
      ),
    );

  if (commitResult.code === 0) {
    return true;
  }

  const combined = `${commitResult.stdout}\n${commitResult.stderr}`.toLowerCase();
  if (combined.includes("nothing to commit") || combined.includes("no changes added")) {
    return false;
  }

  return yield* new TeamFileStoreError({
    operation: "commit",
    workspaceRoot: input.repoRoot,
    path: input.relativePath,
    cause: commitResult.stderr || `git commit exited ${String(commitResult.code)}`,
  });
});

const writeJsonAndMaybeCommit = Effect.fn("TeamFileStore.writeJsonAndMaybeCommit")(
  function* (input: {
    readonly workspaceRoot: string;
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly contents: string;
    readonly commit: boolean;
    readonly commitMessage: string;
  }) {
    yield* writeFileStringAtomically({
      filePath: input.absolutePath,
      contents: input.contents,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TeamFileStoreError({
            operation: "write",
            workspaceRoot: input.workspaceRoot,
            path: input.absolutePath,
            cause,
          }),
      ),
    );

    if (!input.commit) {
      return {
        path: input.absolutePath,
        committed: false,
      } satisfies TeamWriteResult;
    }

    const repoRoot = yield* resolveGitTopLevel(input.workspaceRoot).pipe(
      Effect.mapError(
        (cause) =>
          new TeamFileStoreError({
            operation: "resolve-root",
            workspaceRoot: input.workspaceRoot,
            path: input.relativePath,
            cause,
          }),
      ),
    );
    if (Option.isNone(repoRoot)) {
      yield* Effect.logWarning("TeamFileStore write skipped commit: not a git repository").pipe(
        Effect.annotateLogs({ workspaceRoot: input.workspaceRoot, path: input.relativePath }),
      );
      return {
        path: input.absolutePath,
        committed: false,
      } satisfies TeamWriteResult;
    }

    const committed = yield* commitRepokinPath({
      repoRoot: repoRoot.value,
      relativePath: input.relativePath,
      message: input.commitMessage,
    });

    return {
      path: input.absolutePath,
      committed,
    } satisfies TeamWriteResult;
  },
);

const withStoreServices = <A, E>(
  processRunner: ProcessRunner.ProcessRunner["Service"],
  effect: Effect.Effect<A, E, ProcessRunner.ProcessRunner | FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E, FileSystem.FileSystem | Path.Path> =>
  effect.pipe(Effect.provideService(ProcessRunner.ProcessRunner, processRunner));

export const make = Effect.fn("TeamFileStore.make")(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const provideAll = <A, E>(
    effect: Effect.Effect<A, E, ProcessRunner.ProcessRunner | FileSystem.FileSystem | Path.Path>,
  ): Effect.Effect<A, E> =>
    withStoreServices(processRunner, effect).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, pathService),
    );

  const readRoster: TeamFileStoreShape["readRoster"] = Effect.fn("TeamFileStore.readRoster")(
    function* (workspaceRoot) {
      return yield* provideAll(
        Effect.gen(function* () {
          const repoRoot = yield* resolveGitTopLevel(workspaceRoot);
          const root = Option.getOrElse(repoRoot, () => workspaceRoot);
          return yield* readRosterFromWorkingTree(root);
        }),
      );
    },
  );

  const readRosterFromRefFn: TeamFileStoreShape["readRosterFromRef"] = Effect.fn(
    "TeamFileStore.readRosterFromRef",
  )(function* (workspaceRoot, ref) {
    return yield* provideAll(readRosterFromRef(workspaceRoot, ref));
  });

  const writeTeamFile: TeamFileStoreShape["writeTeamFile"] = Effect.fn(
    "TeamFileStore.writeTeamFile",
  )(function* (workspaceRoot, team, options) {
    const contents = yield* encodeTeamFileJson(team).pipe(
      Effect.mapError(
        (cause) =>
          new TeamFileStoreError({
            operation: "encode",
            workspaceRoot,
            path: TeamPaths.teamFilePath(workspaceRoot),
            cause,
          }),
      ),
    );

    return yield* provideAll(
      Effect.gen(function* () {
        const repoRoot = yield* resolveGitTopLevel(workspaceRoot);
        const root = Option.getOrElse(repoRoot, () => workspaceRoot);
        return yield* writeJsonAndMaybeCommit({
          workspaceRoot: root,
          absolutePath: TeamPaths.teamFilePath(root),
          relativePath: TeamPaths.teamFilePathRelative(),
          contents: `${contents}\n`,
          commit: options?.commit ?? true,
          commitMessage: options?.commitMessage ?? "chore(team): update team.json",
        });
      }),
    );
  });

  const writeHumanProfile: TeamFileStoreShape["writeHumanProfile"] = Effect.fn(
    "TeamFileStore.writeHumanProfile",
  )(function* (workspaceRoot, profile, options) {
    const contents = yield* encodeHumanProfileJson(profile).pipe(
      Effect.mapError(
        (cause) =>
          new TeamFileStoreError({
            operation: "encode",
            workspaceRoot,
            cause,
          }),
      ),
    );

    const slug =
      options?.fileSlug ??
      TeamPaths.slugFromGitEmail(profile.gitEmails[0] ?? profile.id) ??
      profile.id;

    if (!TeamPaths.isValidMemberSlug(slug)) {
      return yield* new TeamFileStoreError({
        operation: "write",
        workspaceRoot,
        path: slug,
        cause: `Invalid human profile slug: ${slug}`,
      });
    }

    return yield* provideAll(
      Effect.gen(function* () {
        const repoRoot = yield* resolveGitTopLevel(workspaceRoot);
        const root = Option.getOrElse(repoRoot, () => workspaceRoot);
        return yield* writeJsonAndMaybeCommit({
          workspaceRoot: root,
          absolutePath: TeamPaths.humanProfilePath(root, slug),
          relativePath: TeamPaths.humanProfilePathRelative(slug),
          contents: `${contents}\n`,
          commit: options?.commit ?? true,
          commitMessage: options?.commitMessage ?? `chore(team): upsert human ${profile.id}`,
        });
      }),
    );
  });

  const writeAgentProfile: TeamFileStoreShape["writeAgentProfile"] = Effect.fn(
    "TeamFileStore.writeAgentProfile",
  )(function* (workspaceRoot, profile, options) {
    const contents = yield* encodeAgentProfileJson(profile).pipe(
      Effect.mapError(
        (cause) =>
          new TeamFileStoreError({
            operation: "encode",
            workspaceRoot,
            cause,
          }),
      ),
    );

    const slug = options?.fileSlug ?? TeamPaths.slugFromAgentName(profile.name) ?? profile.id;

    if (!TeamPaths.isValidMemberSlug(slug)) {
      return yield* new TeamFileStoreError({
        operation: "write",
        workspaceRoot,
        path: slug,
        cause: `Invalid agent profile slug: ${slug}`,
      });
    }

    return yield* provideAll(
      Effect.gen(function* () {
        const repoRoot = yield* resolveGitTopLevel(workspaceRoot);
        const root = Option.getOrElse(repoRoot, () => workspaceRoot);
        return yield* writeJsonAndMaybeCommit({
          workspaceRoot: root,
          absolutePath: TeamPaths.agentProfilePath(root, slug),
          relativePath: TeamPaths.agentProfilePathRelative(slug),
          contents: `${contents}\n`,
          commit: options?.commit ?? true,
          commitMessage: options?.commitMessage ?? `chore(team): upsert agent ${profile.id}`,
        });
      }),
    );
  });

  return TeamFileStore.of({
    readRoster,
    readRosterFromRef: readRosterFromRefFn,
    writeTeamFile,
    writeHumanProfile,
    writeAgentProfile,
  });
});

export const layer = Layer.effect(TeamFileStore, make()).pipe(Layer.provide(ProcessRunner.layer));
