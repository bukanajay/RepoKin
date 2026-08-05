/**
 * Shared duty-run starter used by TeamDutyReactor (schedule) and
 * team.runDutyNow (manual smoke). Creates a board task + agent thread;
 * TeamDelegationReportReactor posts the task-card on settle.
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
  TeamRunDutyNowError,
  type AgentDuty,
  type AgentProfile,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { defaultInstanceIdForDriver } from "../provider/Layers/ProviderInstanceRegistryLive.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { chooseDelegationModelSlug } from "./Layers/TeamDelegationRunReactor.ts";
import { TeamEngineService } from "./Services/TeamEngine.ts";

export const startDutyAgentRun = Effect.fn("TeamDuty.startRun")(function* (input: {
  readonly projectId: ProjectId;
  readonly agent: AgentProfile;
  readonly duty: AgentDuty;
  /** Unique suffix for task/thread ids (e.g. timestamp or run key). */
  readonly runSuffix: string;
  readonly postStartEvent?: boolean;
}) {
  const teamEngine = yield* TeamEngineService;
  const orchestration = yield* OrchestrationEngineService;
  const registry = yield* ProviderInstanceRegistry;
  const serverEnvironment = yield* ServerEnvironment;
  const crypto = yield* Crypto.Crypto;
  const environmentId = yield* serverEnvironment.getEnvironmentId;

  if (
    input.agent.homeEnvironment !== undefined &&
    String(input.agent.homeEnvironment) !== String(environmentId)
  ) {
    return yield* new TeamRunDutyNowError({
      message: `Duty runs only on the agent home environment (this env is not home for ${input.agent.id}).`,
    });
  }

  const driver = input.agent.character.provider?.driver;
  if (driver === undefined) {
    return yield* new TeamRunDutyNowError({
      message: `Agent '${input.agent.id}' has no provider driver configured.`,
    });
  }
  const instanceId = defaultInstanceIdForDriver(driver);
  const instance = yield* registry.getInstance(instanceId);
  if (instance === undefined) {
    return yield* new TeamRunDutyNowError({
      message: `No provider instance registered for driver '${driver}'.`,
    });
  }
  const snapshot = yield* instance.snapshot.getSnapshot;
  const chosenSlug = chooseDelegationModelSlug({
    preferredModel: input.agent.character.provider?.model,
    models: snapshot.models,
  });
  const chosenModel = snapshot.models.find((model) => model.slug === chosenSlug);
  if (chosenModel === undefined) {
    return yield* new TeamRunDutyNowError({
      message: `Provider instance for '${driver}' exposes no usable model.`,
    });
  }

  const modelSelection = { instanceId: instance.instanceId, model: chosenModel.slug };
  const runtimeMode = input.agent.character.runtimeMode ?? DEFAULT_CHARACTER_RUNTIME_MODE;
  const repokinAgentId = String(AgentId.make(String(input.agent.id)));
  const safeSuffix = input.runSuffix.replaceAll(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
  const taskId = TaskId.make(`task-duty-${input.duty.id}-${safeSuffix}`);
  const threadId = ThreadId.make(`thread-duty-${taskId}`);
  const now = DateTime.formatIso(yield* DateTime.now);
  const ownerId = MemberId.make(String(input.agent.owner));
  const agentMemberId = MemberId.make(String(input.agent.id));
  const channelId = ChannelId.make(input.duty.reportChannelId);
  const title = `Duty: ${input.duty.id}`;

  yield* teamEngine
    .dispatch({
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
        environmentId,
      },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamRunDutyNowError({
            message: "Failed to create duty task.",
            cause,
          }),
      ),
    );

  yield* teamEngine
    .dispatch({
      type: "team.task.move",
      commandId: CommandId.make(`server:team-duty-move:${yield* crypto.randomUUIDv4}`),
      projectId: input.projectId,
      taskId,
      toState: "in-progress",
      movedById: agentMemberId,
      metadata: { actorMemberId: agentMemberId, environmentId },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamRunDutyNowError({
            message: "Failed to move duty task to in-progress.",
            cause,
          }),
      ),
    );

  yield* orchestration
    .dispatch({
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
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamRunDutyNowError({
            message: "Failed to create duty thread.",
            cause,
          }),
      ),
    );

  const messageId = OrchestrationMessageId.make(`msg-duty-${taskId}`);
  yield* orchestration
    .dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`server:team-duty-turn:${yield* crypto.randomUUIDv4}`),
      threadId,
      message: { messageId, role: "user", text: input.duty.goal, attachments: [] },
      modelSelection,
      repokinAgentId,
      runtimeMode,
      interactionMode: "default",
      createdAt: now,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamRunDutyNowError({
            message: "Failed to start duty turn (check trust / provider).",
            cause,
          }),
      ),
    );

  yield* teamEngine
    .dispatch({
      type: "team.task.update",
      commandId: CommandId.make(`server:team-duty-link:${yield* crypto.randomUUIDv4}`),
      projectId: input.projectId,
      taskId,
      updatedById: agentMemberId,
      refs: { channelId, threadId },
      metadata: { actorMemberId: agentMemberId, environmentId },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamRunDutyNowError({
            message: "Failed to link duty thread to task.",
            cause,
          }),
      ),
    );

  if (input.postStartEvent !== false) {
    const postId = PostId.make(`duty-start-${input.duty.id}-${yield* crypto.randomUUIDv4}`);
    yield* teamEngine
      .dispatch({
        type: "team.channel.post",
        commandId: CommandId.make(`team:duty:${postId}`),
        projectId: input.projectId,
        postId,
        channelId,
        authorId: agentMemberId,
        content: {
          kind: "event",
          summary: `Duty \`${input.duty.id}\` started a run.`,
        },
        metadata: { actorMemberId: agentMemberId, environmentId },
      })
      .pipe(Effect.ignoreCause({ log: true }));
  }

  return { taskId, threadId, dutyId: input.duty.id } as const;
});
