import { CommandId, MessageId as OrchestrationMessageId, ThreadId } from "@t3tools/contracts";
import {
  AgentId,
  DEFAULT_CHARACTER_RUNTIME_MODE,
  type AgentProfile,
  type TeamRequestRespondedEvent,
  type TeamTaskReadModel,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { defaultInstanceIdForDriver } from "../../provider/Layers/ProviderInstanceRegistryLive.ts";
import { ProviderInstanceRegistry } from "../../provider/Services/ProviderInstanceRegistry.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";

/**
 * Pick the model slug a delegated agent thread should run with: the agent's
 * declared preference when the instance offers it, otherwise the instance's
 * default (non-legacy) model, otherwise the first available. `null` when the
 * instance exposes no models. Pure so the choice is tested without the registry.
 */
export function chooseDelegationModelSlug(input: {
  readonly preferredModel: string | undefined;
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly isDefault?: boolean | undefined;
    readonly isLegacy?: boolean | undefined;
  }>;
}): string | null {
  const slugs = new Set(input.models.map((model) => model.slug));
  if (input.preferredModel !== undefined && slugs.has(input.preferredModel)) {
    return input.preferredModel;
  }
  return (
    input.models.find((model) => model.isDefault === true && model.isLegacy !== true)?.slug ??
    input.models.find((model) => model.isLegacy !== true)?.slug ??
    input.models[0]?.slug ??
    null
  );
}

/**
 * R2.3 delegation run. When a task-linked handoff is accepted, start a normal
 * agent thread on the assignee agent's home environment: the task description
 * is the prompt, the agent is bound via `repokinAgentId`, and the created
 * thread is recorded on the task's refs so a completion report can find it.
 *
 * The turn still passes through the provider's runtime-mode / tool-policy /
 * trust gate — this reactor only *initiates* the thread; it grants no extra
 * authority (NFR-3). Only the home environment starts the run (so a replicated
 * accept does not double-start), and the deterministic thread id keeps it
 * idempotent.
 */
const makeTeamDelegationRunReactor = Effect.gen(function* () {
  const teamEngine = yield* TeamEngineService;
  const orchestration = yield* OrchestrationEngineService;
  const registry = yield* ProviderInstanceRegistry;
  const serverEnvironment = yield* ServerEnvironment;
  const crypto = yield* Crypto.Crypto;

  const startRun = (input: {
    readonly projectId: TeamRequestRespondedEvent["aggregateId"];
    readonly task: TeamTaskReadModel;
    readonly agent: AgentProfile;
    readonly responderId: TeamRequestRespondedEvent["responderId"];
  }): Effect.Effect<void> =>
    Effect.gen(function* () {
      const localEnvironmentId = yield* serverEnvironment.getEnvironmentId;
      // Only the agent's home environment runs the delegated work.
      if (
        input.agent.homeEnvironment !== undefined &&
        String(input.agent.homeEnvironment) !== String(localEnvironmentId)
      ) {
        return;
      }
      // Idempotent: the run already started for this task.
      if (input.task.refs?.threadId != null) {
        return;
      }
      const driver = input.agent.character.provider?.driver;
      if (driver === undefined) {
        yield* Effect.logWarning("delegation run skipped: agent has no provider driver", {
          agentId: input.agent.id,
        });
        return;
      }
      const instanceId = defaultInstanceIdForDriver(driver);
      const instance = yield* registry.getInstance(instanceId);
      if (instance === undefined) {
        yield* Effect.logWarning("delegation run skipped: no provider instance for driver", {
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
        yield* Effect.logWarning("delegation run skipped: provider instance exposes no model", {
          agentId: input.agent.id,
          instanceId: String(instanceId),
        });
        return;
      }
      const modelSelection = { instanceId: instance.instanceId, model: chosenModel.slug };
      const runtimeMode = input.agent.character.runtimeMode ?? DEFAULT_CHARACTER_RUNTIME_MODE;
      const repokinAgentId = String(AgentId.make(String(input.agent.id)));
      const threadId = ThreadId.make(`thread-deleg-${input.task.taskId}`);
      const prompt = input.task.description ?? input.task.title;
      const now = DateTime.formatIso(yield* DateTime.now);

      const createCommandId = CommandId.make(
        `server:team-deleg-thread:${yield* crypto.randomUUIDv4}`,
      );
      yield* orchestration.dispatch({
        type: "thread.create",
        commandId: createCommandId,
        threadId,
        projectId: input.projectId,
        title: input.task.title,
        modelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });

      const turnCommandId = CommandId.make(`server:team-deleg-turn:${yield* crypto.randomUUIDv4}`);
      const messageId = OrchestrationMessageId.make(`msg-deleg-${input.task.taskId}`);
      yield* orchestration.dispatch({
        type: "thread.turn.start",
        commandId: turnCommandId,
        threadId,
        message: { messageId, role: "user", text: prompt, attachments: [] },
        modelSelection,
        repokinAgentId,
        runtimeMode,
        interactionMode: "default",
        createdAt: now,
      });

      // Link the thread back to the task so the completion report can find it.
      const updateCommandId = CommandId.make(
        `server:team-deleg-link:${yield* crypto.randomUUIDv4}`,
      );
      yield* teamEngine.dispatch({
        type: "team.task.update",
        commandId: updateCommandId,
        projectId: input.projectId,
        taskId: input.task.taskId,
        updatedById: input.responderId,
        refs: {
          ...(input.task.refs?.channelId != null ? { channelId: input.task.refs.channelId } : {}),
          threadId,
        },
        metadata: { actorMemberId: input.responderId },
      });
    }).pipe(Effect.ignoreCause({ log: true }));

  const onRequestAccepted = (event: TeamRequestRespondedEvent): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (event.response !== "accepted") {
        return;
      }
      const readModel = yield* teamEngine.getReadModel;
      const project = readModel.projects.find(
        (candidate) => candidate.projectId === event.aggregateId,
      );
      const request = project?.requests.find(
        (candidate) => candidate.requestId === event.requestId,
      );
      if (project === undefined || request === undefined || request.taskId === null) {
        return;
      }
      const task = project.tasks.find((candidate) => candidate.taskId === request.taskId);
      if (task === undefined || task.assigneeId === null) {
        return;
      }
      const member = project.members.find((candidate) => candidate.memberId === task.assigneeId);
      if (member === undefined || member.profile.type !== "agent") {
        return;
      }
      yield* startRun({
        projectId: event.aggregateId,
        task,
        agent: member.profile,
        responderId: event.responderId,
      });
    }).pipe(Effect.ignoreCause({ log: true }));

  yield* teamEngine.streamDomainEvents.pipe(
    Stream.runForEach((event) =>
      event.type === "team.request.responded" ? onRequestAccepted(event) : Effect.void,
    ),
    Effect.forkScoped,
  );
});

export const TeamDelegationRunReactorLive = Layer.effectDiscard(makeTeamDelegationRunReactor);
