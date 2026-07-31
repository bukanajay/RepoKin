import * as NodeCrypto from "node:crypto";

import type { TeamRosterSyncResult } from "@t3tools/contracts/team";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import {
  RosterSync,
  TeamRosterSyncOperationError,
  type RosterSyncShape,
  type TeamRosterRemoteSelection,
} from "../Services/RosterSync.ts";

const AGENTFORGE_ROSTER_REF_PREFIX = "refs/agentforge/rosters";
const DEFAULT_ROSTER_SYNC_INTERVAL = Duration.seconds(30);
type RosterSyncOperation = TeamRosterSyncOperationError["operation"];

interface ActiveRosterSyncPoller {
  readonly fiber: Fiber.Fiber<void, never>;
  readonly subscriberCount: number;
}

export function suggestTeamRemote(
  remotes: ReadonlyArray<{ readonly name: string }>,
): TeamRosterRemoteSelection | null {
  const upstream = remotes.find((remote) => remote.name === "upstream");
  if (upstream !== undefined) {
    return {
      remote: upstream.name,
      source: "suggested-default",
      requiresConfirmation: true,
    };
  }

  const origin = remotes.find((remote) => remote.name === "origin");
  if (origin !== undefined) {
    return {
      remote: origin.name,
      source: "suggested-default",
      requiresConfirmation: true,
    };
  }

  return null;
}

export function parseDefaultBranchFromLsRemote(stdout: string): string | null {
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    const match = /^ref:\s+refs\/heads\/(.+)\s+HEAD$/.exec(line);
    if (match?.[1] !== undefined && match[1].length > 0) {
      return match[1];
    }
  }
  return null;
}

export function rosterRefForRemote(input: {
  readonly remote: string;
  readonly branch: string;
}): string {
  const hash = NodeCrypto.createHash("sha256")
    .update(input.remote)
    .update("\0")
    .update(input.branch)
    .digest("hex")
    .slice(0, 24);
  return `${AGENTFORGE_ROSTER_REF_PREFIX}/${hash}`;
}

const rosterSyncError = (input: {
  readonly operation: RosterSyncOperation;
  readonly cwd: string;
  readonly remote?: string;
  readonly branch?: string;
  readonly message: string;
  readonly cause?: unknown;
}) =>
  new TeamRosterSyncOperationError({
    operation: input.operation,
    cwd: input.cwd,
    ...(input.remote === undefined ? {} : { remote: input.remote }),
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    message: input.message,
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });

const runGit = (input: {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly operation: RosterSyncOperation;
  readonly remote?: string;
  readonly branch?: string;
}) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    return yield* processRunner
      .run({
        command: "git",
        args: ["-C", input.cwd, ...input.args],
        timeoutBehavior: "timedOutResult",
      })
      .pipe(
        Effect.mapError((cause) =>
          rosterSyncError({
            operation: input.operation,
            cwd: input.cwd,
            ...(input.remote === undefined ? {} : { remote: input.remote }),
            ...(input.branch === undefined ? {} : { branch: input.branch }),
            message: "Git command failed while syncing the AgentForge roster.",
            cause,
          }),
        ),
      );
  });

const resolveRemoteDefaultBranch = Effect.fn("RosterSync.resolveRemoteDefaultBranch")(function* (
  cwd: string,
  remote: string,
) {
  const symrefResult = yield* runGit({
    cwd,
    remote,
    operation: "resolve-default-branch",
    args: ["ls-remote", "--symref", remote, "HEAD"],
  });
  if (symrefResult.code === 0) {
    const branch = parseDefaultBranchFromLsRemote(symrefResult.stdout);
    if (branch !== null) {
      return branch;
    }
  }

  const headsResult = yield* runGit({
    cwd,
    remote,
    operation: "resolve-default-branch",
    args: ["ls-remote", "--heads", remote, "main", "master"],
  });
  if (headsResult.code === 0) {
    const heads = headsResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (heads.some((line) => line.endsWith("refs/heads/main"))) {
      return "main";
    }
    if (heads.some((line) => line.endsWith("refs/heads/master"))) {
      return "master";
    }
  }

  return yield* rosterSyncError({
    operation: "resolve-default-branch",
    cwd,
    remote,
    message: `Could not resolve default branch for AgentForge team remote '${remote}'.`,
  });
});

const fetchRosterRef = Effect.fn("RosterSync.fetchRosterRef")(function* (input: {
  readonly cwd: string;
  readonly remote: string;
  readonly branch: string;
}) {
  const ref = rosterRefForRemote(input);
  const result = yield* runGit({
    cwd: input.cwd,
    remote: input.remote,
    branch: input.branch,
    operation: "fetch-remote-roster",
    args: ["fetch", "--quiet", "--no-tags", input.remote, `+refs/heads/${input.branch}:${ref}`],
  });
  if (result.code !== 0) {
    return yield* rosterSyncError({
      operation: "fetch-remote-roster",
      cwd: input.cwd,
      remote: input.remote,
      branch: input.branch,
      message:
        result.stderr.trim() ||
        `Could not fetch AgentForge roster from '${input.remote}/${input.branch}'.`,
    });
  }
  return ref;
});

const syncProjectRoster = Effect.fn("RosterSync.syncProjectRoster")(function* (
  cwd: string,
): Effect.fn.Return<
  TeamRosterSyncResult,
  TeamRosterSyncOperationError,
  TeamFileStore | ProcessRunner.ProcessRunner
> {
  const store = yield* TeamFileStore;
  const localRoster = yield* store.readRoster(cwd).pipe(
    Effect.mapError((cause) =>
      rosterSyncError({
        operation: "read-local-roster",
        cwd,
        message: "Could not read the local AgentForge roster before sync.",
        cause,
      }),
    ),
  );

  const remote = localRoster.team?.teamRemote;
  if (remote === undefined) {
    return yield* rosterSyncError({
      operation: "read-local-roster",
      cwd,
      message:
        "AgentForge team remote is not configured. Set .agentforge/team.json teamRemote before syncing.",
    });
  }

  const branch = yield* resolveRemoteDefaultBranch(cwd, remote);
  const ref = yield* fetchRosterRef({ cwd, remote, branch });
  const roster = yield* store.readRosterFromRef(cwd, ref).pipe(
    Effect.mapError((cause) =>
      rosterSyncError({
        operation: "read-remote-roster",
        cwd,
        remote,
        branch,
        message: "Could not read AgentForge roster from the fetched remote ref.",
        cause,
      }),
    ),
  );

  return { remote, branch, ref, roster };
});

export const make = Effect.gen(function* () {
  const store = yield* TeamFileStore;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const pollerScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const pollersRef = yield* SynchronizedRef.make(new Map<string, ActiveRosterSyncPoller>());

  const sync: RosterSyncShape["syncProjectRoster"] = (cwd) =>
    syncProjectRoster(cwd).pipe(
      Effect.provideService(TeamFileStore, store),
      Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
    );

  const syncIfVisible: RosterSyncShape["syncProjectRosterIfVisible"] = (cwd) =>
    backgroundPolicy
      .shouldRunScopeWork({ type: "vcs-status", cwd })
      .pipe(Effect.flatMap((shouldRun) => (shouldRun ? sync(cwd) : Effect.succeed(null))));

  const makeProjectSyncLoop = (
    cwd: string,
    automaticRosterSyncInterval: Effect.Effect<Duration.Duration, never>,
  ) =>
    Effect.forever(
      Effect.gen(function* () {
        const configuredInterval = yield* automaticRosterSyncInterval;
        const activeInterval = Duration.isZero(configuredInterval)
          ? DEFAULT_ROSTER_SYNC_INTERVAL
          : configuredInterval;

        yield* Effect.sleep(activeInterval);
        if (Duration.isZero(configuredInterval)) {
          return;
        }

        const exit = yield* syncIfVisible(cwd).pipe(Effect.exit);
        if (Exit.isSuccess(exit)) {
          return;
        }

        const interruptionReasons = exit.cause.reasons.filter(Cause.isInterruptReason);
        if (interruptionReasons.length > 0) {
          return yield* Effect.failCause(Cause.fromReasons<never>(interruptionReasons));
        }

        yield* Effect.logWarning("AgentForge roster sync failed", {
          cwdLength: cwd.length,
          reasonCount: exit.cause.reasons.length,
        });
      }),
    );

  const releaseProjectSync = Effect.fn("RosterSync.releaseProjectSync")(function* (cwd: string) {
    const pollerToInterrupt = yield* SynchronizedRef.modifyEffect(pollersRef, (activePollers) => {
      const existing = activePollers.get(cwd);
      if (!existing) {
        return Effect.succeed([null, activePollers] as const);
      }

      if (existing.subscriberCount > 1) {
        return Effect.succeed([
          null,
          new Map(activePollers).set(cwd, {
            ...existing,
            subscriberCount: existing.subscriberCount - 1,
          }),
        ] as const);
      }

      return Effect.succeed([
        existing.fiber,
        new Map([...activePollers].filter(([activeCwd]) => activeCwd !== cwd)),
      ] as const);
    });

    if (pollerToInterrupt) {
      yield* Effect.ignore(Fiber.interrupt(pollerToInterrupt));
    }
  });

  const retainProjectSync: RosterSyncShape["retainProjectSync"] = (input) =>
    SynchronizedRef.modifyEffect(pollersRef, (activePollers) => {
      const existing = activePollers.get(input.cwd);
      if (existing) {
        return Effect.succeed([
          releaseProjectSync(input.cwd),
          new Map(activePollers).set(input.cwd, {
            ...existing,
            subscriberCount: existing.subscriberCount + 1,
          }),
        ] as const);
      }

      const interval =
        input.automaticRosterSyncInterval ?? Effect.succeed(DEFAULT_ROSTER_SYNC_INTERVAL);
      return makeProjectSyncLoop(input.cwd, interval).pipe(
        Effect.forkIn(pollerScope),
        Effect.map(
          (fiber) =>
            [
              releaseProjectSync(input.cwd),
              new Map(activePollers).set(input.cwd, { fiber, subscriberCount: 1 }),
            ] as const,
        ),
      );
    });

  return RosterSync.of({
    suggestTeamRemote,
    syncProjectRoster: sync,
    syncProjectRosterIfVisible: syncIfVisible,
    retainProjectSync,
  });
});

export const layer = Layer.effect(RosterSync, make);
