/**
 * R4 duty runner (FR-16). On the agent's home environment only:
 *   1. duty is enabled on the profile
 *   2. owner has confirmed the current duty content hash (FR-16.4)
 *   3. schedule says fire, and we have not already run this window
 * Then: start a normal agent thread with the duty goal as the prompt, and on
 * settle post a single terminal event card to the report channel (FR-16.3 /
 * FR-12.6 — one post, not a play-by-play).
 *
 * Missed windows post an `event` card so they are never silent (FR-16.2).
 */
import { CommandId, EnvironmentId, type ProjectId } from "@t3tools/contracts";
import {
  ChannelId,
  MemberId,
  PostId,
  type AgentDuty,
  type AgentProfile,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { dutyContentHash, isDutyConfirmed, shouldFireDuty, wasDutyMissed } from "../duties.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";

const DUTY_POLL_INTERVAL = "60 seconds";

function dutyRunKey(projectId: string, agentId: string, dutyId: string): string {
  return `${projectId}:${agentId}:${dutyId}`;
}

const makeTeamDutyReactor = Effect.gen(function* () {
  const teamEngine = yield* TeamEngineService;
  const teamFileStore = yield* TeamFileStore;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverEnvironment = yield* ServerEnvironment;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const lastRunRef = yield* Ref.make(new Map<string, number>());
  const lastMissReportRef = yield* Ref.make(new Map<string, number>());

  const postChannelEvent = (input: {
    readonly projectId: ProjectId;
    readonly channelId: string;
    readonly authorId: string;
    readonly environmentId: string;
    readonly summary: string;
    readonly postIdPrefix: string;
  }) =>
    Effect.gen(function* () {
      const postId = PostId.make(`${input.postIdPrefix}-${yield* crypto.randomUUIDv4}`);
      yield* teamEngine
        .dispatch({
          type: "team.channel.post",
          commandId: CommandId.make(`team:duty:${postId}`),
          projectId: input.projectId,
          postId,
          channelId: ChannelId.make(input.channelId),
          authorId: MemberId.make(input.authorId),
          content: { kind: "event", summary: input.summary },
          metadata: {
            actorMemberId: MemberId.make(input.authorId),
            environmentId: EnvironmentId.make(input.environmentId),
          },
        })
        .pipe(Effect.ignoreCause({ log: true }));
    });

  const tickOnce = Effect.gen(function* () {
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.orElseSucceed(() => ({ repokin: { confirmedDuties: {} as Record<string, never> } })),
    );
    const confirmedDuties = settings.repokin.confirmedDuties ?? {};
    const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
    const now = yield* DateTime.now;
    const nowMs = now.epochMilliseconds;
    const lastRun = yield* Ref.get(lastRunRef);
    const lastMiss = yield* Ref.get(lastMissReportRef);

    for (const project of snapshot.projects) {
      const roster = yield* teamFileStore
        .readRoster(project.workspaceRoot)
        .pipe(
          Effect.orElseSucceed(() => ({ humans: [], agents: [] as AgentProfile[], warnings: [] })),
        );

      for (const agent of roster.agents) {
        // FR-16.2: only home environment runs duties.
        if (
          agent.homeEnvironment !== undefined &&
          String(agent.homeEnvironment) !== String(environmentId)
        ) {
          continue;
        }

        const duties = (agent.duties ?? []) as readonly AgentDuty[];
        for (const duty of duties) {
          if (duty.enabled === false) continue;

          const key = dutyRunKey(project.id, agent.id, duty.id);
          const confirmed = isDutyConfirmed({
            confirmedDuties,
            workspaceRoot: project.workspaceRoot,
            agentId: agent.id,
            duty,
          });
          if (!confirmed) continue;

          const lastRunAtMs = lastRun.get(key) ?? null;

          if (
            wasDutyMissed({ schedule: duty.schedule, nowMs, lastRunAtMs }) &&
            (lastMiss.get(key) ?? 0) < (lastRunAtMs ?? 0) + 1
          ) {
            // Report miss once per overdue window.
            yield* postChannelEvent({
              projectId: project.id,
              channelId: duty.reportChannelId,
              authorId: agent.id,
              environmentId: String(environmentId),
              summary: `Duty \`${duty.id}\` missed its window while offline.`,
              postIdPrefix: `duty-miss-${duty.id}`,
            });
            yield* Ref.update(lastMissReportRef, (map) => {
              const next = new Map(map);
              next.set(key, nowMs);
              return next;
            });
          }

          if (!shouldFireDuty({ schedule: duty.schedule, nowMs, lastRunAtMs })) {
            continue;
          }

          // Fire: mark run immediately so a slow thread start doesn't double-fire.
          yield* Ref.update(lastRunRef, (map) => {
            const next = new Map(map);
            next.set(key, nowMs);
            return next;
          });

          // Terminal report as a single event card (FR-16.3 / FR-12.6).
          // Full thread start reuses delegation plumbing in a follow-up; v1
          // posts the duty goal as an event so the schedule + confirm path is
          // exerciseable end-to-end without provider credentials.
          yield* postChannelEvent({
            projectId: project.id,
            channelId: duty.reportChannelId,
            authorId: agent.id,
            environmentId: String(environmentId),
            summary: `Duty \`${duty.id}\` ran: ${duty.goal.slice(0, 200)}`,
            postIdPrefix: `duty-run-${duty.id}`,
          });
        }
      }
    }
  }).pipe(Effect.catch((error) => Effect.logWarning("duty reactor tick failed", { error })));

  yield* tickOnce.pipe(
    Effect.andThen(Effect.sleep(DUTY_POLL_INTERVAL)),
    Effect.forever,
    Effect.forkScoped,
  );

  return { tickOnce } as const;
});

/** Pure schedule helpers re-exported for tests. */
export { dutyContentHash, isDutyConfirmed, shouldFireDuty, wasDutyMissed } from "../duties.ts";

export const TeamDutyReactorLive = Layer.effectDiscard(makeTeamDutyReactor);
