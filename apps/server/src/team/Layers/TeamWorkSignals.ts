/**
 * R3.1 work-location signals + R3.2 work-map projection + cross-env fan-out.
 *
 * Collects coarse directory activity from:
 *   - the human's working tree (git status files)
 *   - running agent threads (git status of the thread worktree/workspace)
 *
 * When work-location sharing is on (FR-14.4), a coalesced snapshot is signed
 * and fanned out to remote roster environments over the team relay (same
 * deliverTeamMessage path as domain events). Receivers cache via
 * `ingestRemoteSignals` — never event-sourced.
 *
 * Kill switch: `settings.repokin.workLocationSharing` (default on).
 */
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  MemberId,
  type TeamWorkMapReadResult,
  type TeamWorkSignal,
  type TeamRosterReadModel,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { GitManager } from "../../git/GitManager.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { makeTeamRelayClient, readTeamRelayConfig } from "../relayClient.ts";
import { signTeamWorkSignalEnvelope } from "../SignedMessaging.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import { TeamWorkSignals, type TeamWorkSignalsShape } from "../Services/TeamWorkSignals.ts";
import {
  detectOverlaps,
  detectPublishedBranchOverlaps,
  directoriesFromDiffPaths,
  directoriesFromPaths,
  projectWorkMapNodes,
  type PublishedBranchTouch,
} from "../workMap.ts";
import { collectRemoteEnvironments } from "../remoteEnvironments.ts";

/** How long a remote signal stays on the map without a refresh. */
const REMOTE_SIGNAL_STALENESS_MS = 60_000;
/** Publish cadence — matches presence poll; no new steady-state traffic class. */
const WORK_SIGNAL_PUBLISH_INTERVAL = "15 seconds";
/** Cap published-branch scans so a huge remote ref list never pegs the work map. */
const MAX_PUBLISHED_BRANCH_REFS = 24;

function isThreadActivelyWorking(thread: {
  readonly latestTurn: { readonly state: string } | null;
  readonly session: { readonly status: string } | null;
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
}): boolean {
  if (thread.session?.status === "running") return true;
  if (thread.latestTurn?.state === "running") return true;
  if (thread.hasPendingApprovals === true || thread.hasPendingUserInput === true) return true;
  return false;
}

function resolveLocalHumanId(
  roster: TeamRosterReadModel,
  environmentId: EnvironmentId,
): string | null {
  const linked = roster.humans.find((human) =>
    (human.environments ?? []).some(
      (entry) => String(entry.environmentId) === String(environmentId),
    ),
  );
  if (linked !== undefined) return linked.id;
  return roster.humans.length === 1 ? (roster.humans[0]?.id ?? null) : null;
}

function fingerprintSignals(signals: ReadonlyArray<TeamWorkSignal>): string {
  return signals
    .map((signal) => `${signal.memberId}:${signal.directories.join(",")}:${signal.source}`)
    .sort()
    .join("|");
}

const makeTeamWorkSignals = Effect.gen(function* () {
  const gitManager = yield* GitManager;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const teamFileStore = yield* TeamFileStore;
  const serverEnvironment = yield* ServerEnvironment;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const crypto = yield* Crypto.Crypto;
  const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets);
  const readRelayConfig = readTeamRelayConfig(secrets);
  // Remote signals keyed by `${projectId}:${memberId}`.
  const remoteSignalsRef = yield* Ref.make(new Map<string, TeamWorkSignal>());
  // Last published fingerprint per project — skip no-op fan-outs.
  const lastPublishedRef = yield* Ref.make(new Map<string, string>());

  const isSharingEnabled = serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.repokin.workLocationSharing !== false),
    Effect.orElseSucceed(() => true),
  );

  const collectWorkingTreeDirectories = (cwd: string) =>
    gitManager.localStatus({ cwd }).pipe(
      Effect.map((status) =>
        directoriesFromPaths(status.workingTree.files.map((file) => file.path)),
      ),
      Effect.orElseSucceed(() => [] as string[]),
    );

  /**
   * FR-14.3 published-branch touch sets: list remote-tracking refs (no checkout),
   * then `git diff --name-only` against HEAD to see which directories they change.
   * Best-effort; failures yield an empty list so the work map still loads.
   */
  const collectPublishedBranchTouches = (cwd: string) =>
    Effect.gen(function* () {
      const refsResult = yield* processRunner
        .run({
          command: "git",
          args: [
            "-C",
            cwd,
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "--count",
            String(MAX_PUBLISHED_BRANCH_REFS),
            "refs/remotes",
          ],
          timeoutBehavior: "timedOutResult",
        })
        .pipe(Effect.option);
      if (refsResult._tag === "None" || refsResult.value.code !== 0) {
        return [] as PublishedBranchTouch[];
      }
      const branches = refsResult.value.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.length > 0 &&
            !line.endsWith("/HEAD") &&
            !line.endsWith("/main") &&
            !line.endsWith("/master"),
        )
        .slice(0, MAX_PUBLISHED_BRANCH_REFS);

      const touches: PublishedBranchTouch[] = [];
      for (const branch of branches) {
        const diffResult = yield* processRunner
          .run({
            command: "git",
            args: ["-C", cwd, "diff", "--name-only", `HEAD...${branch}`],
            timeoutBehavior: "timedOutResult",
          })
          .pipe(Effect.option);
        if (diffResult._tag === "None" || diffResult.value.code !== 0) continue;
        const directories = directoriesFromDiffPaths(diffResult.value.stdout);
        if (directories.length === 0) continue;
        // Best-effort member attribution from branch slug (agent_*/human_*).
        const slug = branch.split("/").at(-1) ?? branch;
        const memberId = /^(agent_|human_)/.test(slug) ? slug : undefined;
        touches.push({
          branch,
          directories,
          ...(memberId !== undefined ? { memberId } : {}),
        });
      }
      return touches;
    }).pipe(Effect.orElseSucceed(() => [] as PublishedBranchTouch[]));

  const collectLocalSignals = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const sharingEnabled = yield* isSharingEnabled;
      if (!sharingEnabled) {
        return [] as TeamWorkSignal[];
      }

      const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
      const project = snapshot.projects.find((candidate) => candidate.id === projectId);
      if (project === undefined) {
        return [] as TeamWorkSignal[];
      }

      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const roster = yield* teamFileStore.readRoster(project.workspaceRoot).pipe(
        Effect.orElseSucceed(
          (): TeamRosterReadModel => ({
            humans: [],
            agents: [],
            warnings: [],
          }),
        ),
      );
      const now = yield* DateTime.now;
      const updatedAt = DateTime.formatIso(now);
      const signals: TeamWorkSignal[] = [];

      const humanId = resolveLocalHumanId(roster, environmentId);
      if (humanId !== null) {
        const directories = yield* collectWorkingTreeDirectories(project.workspaceRoot);
        if (directories.length > 0) {
          signals.push({
            projectId,
            memberId: MemberId.make(humanId),
            memberType: "human",
            environmentId,
            directories,
            updatedAt,
            source: "working-tree",
          });
        }
      }

      const agentDirs = new Map<string, { directories: Set<string>; weight: number }>();
      for (const thread of snapshot.threads) {
        if (thread.projectId !== projectId) continue;
        const agentId = thread.repokinAgentId;
        if (agentId === null || agentId === undefined || agentId.length === 0) continue;
        if (!isThreadActivelyWorking(thread)) continue;

        const cwd = thread.worktreePath ?? project.workspaceRoot;
        const directories = yield* collectWorkingTreeDirectories(cwd);
        if (directories.length === 0) continue;

        const entry = agentDirs.get(agentId) ?? {
          directories: new Set<string>(),
          weight: 0,
        };
        for (const directory of directories) entry.directories.add(directory);
        entry.weight += directories.length;
        agentDirs.set(agentId, entry);
      }

      for (const [agentId, entry] of agentDirs) {
        if (entry.directories.size === 0) continue;
        signals.push({
          projectId,
          memberId: MemberId.make(agentId),
          memberType: "agent",
          environmentId,
          directories: [...entry.directories].sort((left, right) => left.localeCompare(right)),
          updatedAt,
          source: "thread",
        });
      }

      return signals;
    });

  const pruneAndListRemote = (projectId: ProjectId, nowMs: number) =>
    Ref.modify(remoteSignalsRef, (cache) => {
      const next = new Map<string, TeamWorkSignal>();
      const live: TeamWorkSignal[] = [];
      for (const [key, signal] of cache) {
        if (String(signal.projectId) !== String(projectId)) {
          next.set(key, signal);
          continue;
        }
        const updatedMs = Date.parse(signal.updatedAt);
        if (Number.isFinite(updatedMs) && nowMs - updatedMs <= REMOTE_SIGNAL_STALENESS_MS) {
          next.set(key, signal);
          live.push(signal);
        }
      }
      return [live, next] as const;
    });

  const publishLocalSignals = Effect.gen(function* () {
    const sharingEnabled = yield* isSharingEnabled;
    if (!sharingEnabled) return;

    const relayConfig = yield* readRelayConfig.pipe(Effect.orElseSucceed(() => null));
    if (relayConfig === null) return;

    const localEnvironmentId = yield* serverEnvironment.getEnvironmentId;
    const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
    const relayClient = yield* makeTeamRelayClient(relayConfig);

    yield* Effect.forEach(
      snapshot.projects,
      (project) =>
        Effect.gen(function* () {
          const signals = yield* collectLocalSignals(project.id).pipe(
            Effect.catch(() => Effect.succeed([] as TeamWorkSignal[])),
          );
          const fingerprint = fingerprintSignals(signals);
          const lastPublished = yield* Ref.get(lastPublishedRef);
          if (lastPublished.get(project.id) === fingerprint) {
            return;
          }

          const roster = yield* teamFileStore
            .readRoster(project.workspaceRoot)
            .pipe(
              Effect.orElseSucceed(
                (): TeamRosterReadModel => ({ humans: [], agents: [], warnings: [] }),
              ),
            );
          const senderId = resolveLocalHumanId(roster, localEnvironmentId);
          if (senderId === null) {
            // Need a roster human with this env's key to sign.
            return;
          }
          const remoteEnvironments = collectRemoteEnvironments({
            roster,
            localEnvironmentId,
          });
          if (remoteEnvironments.length === 0) {
            yield* Ref.update(lastPublishedRef, (map) => {
              const next = new Map(map);
              next.set(project.id, fingerprint);
              return next;
            });
            return;
          }

          const now = yield* DateTime.now;
          const sentAt = DateTime.formatIso(now);
          yield* Effect.forEach(
            remoteEnvironments,
            (recipientEnvironmentId) =>
              Effect.gen(function* () {
                const jti = yield* crypto.randomUUIDv4;
                const payload = {
                  projectId: project.id,
                  senderId: MemberId.make(senderId),
                  senderEnvironmentId: localEnvironmentId,
                  recipientEnvironmentId,
                  signals,
                  sentAt,
                };
                const envelope = yield* signTeamWorkSignalEnvelope({
                  privateKey: keyPair.privateKey,
                  relayIssuer: relayConfig.issuer,
                  payload,
                  jti,
                  now,
                });
                yield* relayClient.server.deliverTeamMessage({ payload: { envelope } });
              }).pipe(Effect.ignoreCause({ log: true })),
            { discard: true, concurrency: "unbounded" },
          );

          yield* Ref.update(lastPublishedRef, (map) => {
            const next = new Map(map);
            next.set(project.id, fingerprint);
            return next;
          });
        }).pipe(Effect.ignoreCause({ log: true })),
      { discard: true, concurrency: 1 },
    );
  }).pipe(Effect.catch((error) => Effect.logWarning("work-signal publish failed", { error })));

  yield* publishLocalSignals.pipe(
    Effect.andThen(Effect.sleep(WORK_SIGNAL_PUBLISH_INTERVAL)),
    Effect.forever,
    Effect.forkScoped,
  );

  const readWorkMap: TeamWorkSignalsShape["readWorkMap"] = (projectId) =>
    Effect.gen(function* () {
      const sharingEnabled = yield* isSharingEnabled;
      const local = yield* collectLocalSignals(projectId).pipe(
        Effect.catch(() => Effect.succeed([] as TeamWorkSignal[])),
      );
      const now = yield* DateTime.now;
      const nowMs = now.epochMilliseconds;
      const remote = yield* pruneAndListRemote(projectId, nowMs);

      const byMember = new Map<string, TeamWorkSignal>();
      for (const signal of remote) byMember.set(String(signal.memberId), signal);
      for (const signal of local) byMember.set(String(signal.memberId), signal);
      const signals: TeamWorkSignal[] = [...byMember.values()];

      const projectionInput = signals.map((signal) => ({
        memberId: String(signal.memberId),
        directories: [...signal.directories],
        weight: signal.directories.length,
      }));
      const nodes = projectWorkMapNodes(projectionInput).map((node) => ({
        path: node.path,
        label: node.label,
        weight: node.weight,
        memberIds: node.memberIds.map((id) => MemberId.make(id)),
      }));
      const memberOverlaps = detectOverlaps(projectionInput);

      // Local working-tree dirs for published-branch intersection (FR-14.3).
      const localHumanSignal = local.find((signal) => signal.memberType === "human");
      const localDirectories =
        localHumanSignal?.directories ?? local.flatMap((signal) => signal.directories);
      const snapshot = yield* projectionSnapshotQuery
        .getShellSnapshot()
        .pipe(
          Effect.orElseSucceed(() => ({
            projects: [] as Array<{ id: string; workspaceRoot: string }>,
          })),
        );
      const project = snapshot.projects.find((candidate) => candidate.id === projectId);
      const branchTouches =
        project === undefined ? [] : yield* collectPublishedBranchTouches(project.workspaceRoot);
      const branchOverlaps = detectPublishedBranchOverlaps({
        localDirectories: [...localDirectories],
        branches: branchTouches,
        ...(localHumanSignal !== undefined
          ? { localMemberId: String(localHumanSignal.memberId) }
          : {}),
      });

      // Merge member-signal and published-branch overlaps; prefer richer notes.
      const overlapByPath = new Map<string, { path: string; memberIds: string[]; note: string }>();
      for (const overlap of [...memberOverlaps, ...branchOverlaps]) {
        const existing = overlapByPath.get(overlap.path);
        if (existing === undefined) {
          overlapByPath.set(overlap.path, {
            path: overlap.path,
            memberIds: [...overlap.memberIds],
            note: overlap.note,
          });
        } else {
          const members = new Set([...existing.memberIds, ...overlap.memberIds]);
          existing.memberIds = [...members];
          // Keep the more specific note (branch notes mention "Published branch").
          if (
            overlap.note.includes("Published branch") ||
            existing.note.length < overlap.note.length
          ) {
            existing.note = overlap.note;
          }
        }
      }

      const overlaps = [...overlapByPath.values()]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((overlap) => ({
          path: overlap.path,
          memberIds: overlap.memberIds
            .filter((id) => id !== "local" && !id.includes("/"))
            .map((id) => MemberId.make(id)),
          note: overlap.note,
        }));

      const result: TeamWorkMapReadResult = {
        projectId,
        nodes,
        overlaps,
        signals,
        sharingEnabled,
        updatedAt: DateTime.formatIso(now),
      };
      return result;
    });

  const ingestRemoteSignals: TeamWorkSignalsShape["ingestRemoteSignals"] = (signals) =>
    Effect.gen(function* () {
      if (signals.length === 0) return;
      yield* Ref.update(remoteSignalsRef, (cache) => {
        const next = new Map(cache);
        for (const signal of signals) {
          next.set(`${signal.projectId}:${signal.memberId}`, signal);
        }
        return next;
      });
    });

  return {
    readWorkMap,
    ingestRemoteSignals,
  } satisfies TeamWorkSignalsShape;
});

export const TeamWorkSignalsLive = Layer.effect(TeamWorkSignals, makeTeamWorkSignals);
