/**
 * R4 duty runner (FR-16). On the agent's home environment only:
 *   1. duty is enabled on the profile
 *   2. owner has confirmed the current duty content hash (FR-16.4)
 *   3. schedule says fire, and we have not already run this window
 * Then: create a board task + start a normal agent thread (same path as
 * R2.3 delegation) with the duty goal as the prompt. On settle,
 * TeamDelegationReportReactor posts a task-card to the report channel
 * (FR-16.3 / FR-12.6 — one terminal card).
 *
 * Missed windows post an `event` card so they are never silent (FR-16.2).
 */
import {
  CommandId,
  EnvironmentId,
  MessageId as OrchestrationMessageId,
  ThreadId,
  type ProjectId,
} from "@t3tools/contracts";
import {
  AgentId,
  ChannelId,
  DEFAULT_CHARACTER_RUNTIME_MODE,
  MemberId,
  PostId,
  TaskId,
  type AgentDuty,
  type AgentProfile,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { defaultInstanceIdForDriver } from "../../provider/Layers/ProviderInstanceRegistryLive.ts";
import { ProviderInstanceRegistry } from "../../provider/Services/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { isDutyConfirmed, shouldFireDuty, wasDutyMissed } from "../duties.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";
import { TeamFileStore } from "../Services/TeamFileStore.ts";
import { chooseDelegationModelSlug } from "./TeamDelegationRunReactor.ts";

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
  const orchestration = yield* OrchestrationEngineService;
  const registry = yield* ProviderInstanceRegistry;
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

  /**
   * Create a task + start an agent thread (mirrors TeamDelegationRunReactor).
   * Report card is posted by TeamDelegationReportReactor when the thread settles.
   */
  const startDutyRun = (input: {
    readonly projectId: ProjectId;
    readonly agent: AgentProfile;
    readonly duty: AgentDuty;
    readonly runKey: string;
    readonly environmentId: string;
  }): Effect.Effect<void> =>
    Effect.gen(function* () {
      const driver = input.agent.character.provider?.driver;
      if (driver === undefined) {
        yield* Effect.logWarning("duty run skipped: agent has no provider driver", {
          agentId: input.agent.id,
          dutyId: input.duty.id,
        });
        yield* postChannelEvent({
          projectId: input.projectId,
          channelId: input.duty.reportChannelId,
          authorId: input.agent.id,
          environmentId: input.environmentId,
          summary: `Duty \`${input.duty.id}\` skipped: no provider driver configured.`,
          postIdPrefix: `duty-skip-${input.duty.id}`,
        });
        return;
      }
      const instanceId = defaultInstanceIdForDriver(driver);
      const instance = yield* registry.getInstance(instanceId);
      if (instance === undefined) {
        yield* Effect.logWarning("duty run skipped: no provider instance", {
          agentId: input.agent.id,
          driver,
        });
        return;
      }
      const snapshot = yield* instance.snapshot.getSnapshot;
      const chosenSlug = chooseDelegationModelSlug({
        preferredModel: input.agent.character.provider?.model,
        models: snapshot.models,
      });
      const chosenModel = snapshot.models.find((model) => model.slug === chosenSlug);
      if (chosenModel === undefined) {
        yield* Effect.logWarning("duty run skipped: no model", {
          agentId: input.agent.id,
        });
        return;
      }

      const modelSelection = { instanceId: instance.instanceId, model: chosenModel.slug };
      const runtimeMode = input.agent.character.runtimeMode ?? DEFAULT_CHARACTER_RUNTIME_MODE;
      const repokinAgentId = String(AgentId.make(String(input.agent.id)));
      // Deterministic per window so a double-tick does not create two threads.
      const windowId = input.runKey.replaceAll(":", "-");
      const taskId = TaskId.make(`task-duty-${windowId}-${Date.now()}`);
      const threadId = ThreadId.make(`thread-duty-${taskId}`);
      const now = DateTime.formatIso(yield* DateTime.now);
      const ownerId = MemberId.make(String(input.agent.owner));
      const agentMemberId = MemberId.make(String(input.agent.id));
      const channelId = ChannelId.make(input.duty.reportChannelId);
      const title = `Duty: ${input.duty.id}`;

      // Task on the board so the report reactor can find channel + assignee.
      yield* teamEngine.dispatch({
        type: "team.task.create",
        commandId: CommandId.make(`server:team-duty-task:${yield* crypto.randomUUIDv4}`),
        projectId: input.projectId,
        taskId,
        title,
        description: input.duty.goal,
        createdById: ownerId,
        assigneeId: agentMemberId,
        refs: { channelId },
        metadata: {
          actorMemberId: ownerId,
          environmentId: EnvironmentId.make(input.environmentId),
        },
      });

      // Move to in-progress (duty is accepted by schedule + confirm, not inbox).
      yield* teamEngine.dispatch({
        type: "team.task.move",
        commandId: CommandId.make(`server:team-duty-move:${yield* crypto.randomUUIDv4}`),
        projectId: input.projectId,
        taskId,
        toState: "in-progress",
        movedById: agentMemberId,
        metadata: {
          actorMemberId: agentMemberId,
          environmentId: EnvironmentId.make(input.environmentId),
        },
      });

      yield* orchestration.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`server:team-duty-thread:${yield* crypto.randomUUIDv4}`),
        threadId,
        projectId: input.projectId,
        title,
        modelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });

      const messageId = OrchestrationMessageId.make(`msg-duty-${taskId}`);
      yield* orchestration.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`server:team-duty-turn:${yield* crypto.randomUUIDv4}`),
        threadId,
        message: { messageId, role: "user", text: input.duty.goal, attachments: [] },
        modelSelection,
        repokinAgentId,
        runtimeMode,
        interactionMode: "default",
        createdAt: now,
      });

      // Link thread for TeamDelegationReportReactor (task-card on settle).
      yield* teamEngine.dispatch({
        type: "team.task.update",
        commandId: CommandId.make(`server:team-duty-link:${yield* crypto.randomUUIDv4}`),
        projectId: input.projectId,
        taskId,
        updatedById: agentMemberId,
        refs: { channelId, threadId },
        metadata: {
          actorMemberId: agentMemberId,
          environmentId: EnvironmentId.make(input.environmentId),
        },
      });

      // Opaque start event so the channel shows the duty fired (card comes later).
      yield* postChannelEvent({
        projectId: input.projectId,
        channelId: input.duty.reportChannelId,
        authorId: input.agent.id,
        environmentId: input.environmentId,
        summary: `Duty \`${input.duty.id}\` started a run.`,
        postIdPrefix: `duty-start-${input.duty.id}`,
      });
    }).pipe(Effect.ignoreCause({ log: true }));

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

          yield* Ref.update(lastRunRef, (map) => {
            const next = new Map(map);
            next.set(key, nowMs);
            return next;
          });

          yield* startDutyRun({
            projectId: project.id,
            agent,
            duty,
            runKey: `${key}:${nowMs}`,
            environmentId: String(environmentId),
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

export { dutyContentHash, isDutyConfirmed, shouldFireDuty, wasDutyMissed } from "../duties.ts";

export const TeamDutyReactorLive = Layer.effectDiscard(makeTeamDutyReactor);
