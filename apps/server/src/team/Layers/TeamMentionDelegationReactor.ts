import { CommandId, MessageId } from "@t3tools/contracts";
import {
  MemberId,
  TaskId,
  type TeamChannelPostedEvent,
  type TeamProjectReadModel,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";

const MENTION_PATTERN = /@([a-zA-Z][a-zA-Z0-9_-]*)/g;
const TASK_TITLE_MAX = 80;

/**
 * Agent member ids `@mentioned` in free text, de-duplicated and restricted to
 * ids the caller says are agents. Pure so the mention grammar is tested without
 * the engine.
 */
export function extractMentionedAgentIds(input: {
  readonly text: string;
  readonly agentIds: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  const known = new Set(input.agentIds);
  const found = new Set<string>();
  for (const match of input.text.matchAll(MENTION_PATTERN)) {
    const token = match[1];
    if (token !== undefined && known.has(token)) {
      found.add(token);
    }
  }
  return [...found];
}

/** A board title from the delegating post: first line, mentions stripped. */
export function deriveTaskTitle(body: string): string {
  const firstLine = body.split("\n")[0] ?? "";
  const cleaned = firstLine.replace(MENTION_PATTERN, "").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return "Delegated task";
  }
  return cleaned.length > TASK_TITLE_MAX ? `${cleaned.slice(0, TASK_TITLE_MAX - 1)}…` : cleaned;
}

/**
 * R2.3 mention trigger. When a human `@mentions` an agent in a channel post,
 * raise a delegated task (the post body becomes the prompt) and a handoff
 * request in that agent's inbox. The request is the accept gate — nothing runs
 * until the agent's environment accepts it (NFR-3).
 *
 * Ids are derived from the post id so re-processing is idempotent, and only the
 * authoring environment raises the delegation (guarded on the event's origin
 * environment) so a replicated post does not create the task twice — the task
 * and request then fan out on their own.
 */
const makeTeamMentionDelegationReactor = Effect.gen(function* () {
  const teamEngine = yield* TeamEngineService;
  const serverEnvironment = yield* ServerEnvironment;
  const crypto = yield* Crypto.Crypto;

  const raiseDelegation = (input: {
    readonly project: TeamProjectReadModel;
    readonly event: TeamChannelPostedEvent;
    readonly agentId: string;
    readonly body: string;
  }): Effect.Effect<void> =>
    Effect.gen(function* () {
      const taskId = TaskId.make(`task-deleg-${input.event.postId}-${input.agentId}`);
      // Idempotent: the deterministic id means a re-processed post is a no-op.
      if (input.project.tasks.some((task) => task.taskId === taskId)) {
        return;
      }
      const uuidTask = yield* crypto.randomUUIDv4;
      yield* teamEngine.dispatch({
        type: "team.task.create",
        commandId: CommandId.make(`server:team-mention-task:${uuidTask}`),
        projectId: input.event.aggregateId,
        taskId,
        title: deriveTaskTitle(input.body),
        description: input.body,
        // Record which channel delegated the task, so a report can find its way
        // back to the origin conversation.
        refs: { channelId: input.event.channelId },
        createdById: input.event.authorId,
        assigneeId: MemberId.make(input.agentId),
        metadata: { actorMemberId: input.event.authorId },
      });
      const uuidRequest = yield* crypto.randomUUIDv4;
      yield* teamEngine.dispatch({
        type: "team.request.create",
        commandId: CommandId.make(`server:team-mention-request:${uuidRequest}`),
        projectId: input.event.aggregateId,
        requestId: MessageId.make(`req-deleg-${input.event.postId}-${input.agentId}`),
        kind: "handoff",
        fromMemberId: input.event.authorId,
        toMemberId: MemberId.make(input.agentId),
        taskId,
        message: `Delegated from #${input.event.channelId}`,
        metadata: { actorMemberId: input.event.authorId },
      });
    }).pipe(Effect.ignoreCause({ log: true }));

  const onChannelPosted = (event: TeamChannelPostedEvent): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (event.content.kind !== "text") {
        return;
      }
      const localEnvironmentId = yield* serverEnvironment.getEnvironmentId;
      const origin = event.metadata.environmentId;
      if (origin !== undefined && String(origin) !== String(localEnvironmentId)) {
        return;
      }
      const readModel = yield* teamEngine.getReadModel;
      const project = readModel.projects.find(
        (candidate) => candidate.projectId === event.aggregateId,
      );
      if (project === undefined) {
        return;
      }
      const agentIds = project.members
        .filter((member) => member.memberType === "agent")
        .map((member) => String(member.memberId));
      const mentioned = extractMentionedAgentIds({ text: event.content.body, agentIds }).filter(
        (agentId) => agentId !== String(event.authorId),
      );
      const body = event.content.body;
      yield* Effect.forEach(
        mentioned,
        (agentId) => raiseDelegation({ project, event, agentId, body }),
        { discard: true },
      );
    }).pipe(Effect.ignoreCause({ log: true }));

  yield* teamEngine.streamDomainEvents.pipe(
    Stream.runForEach((event) =>
      event.type === "team.channel.posted" ? onChannelPosted(event) : Effect.void,
    ),
    Effect.forkScoped,
  );
});

export const TeamMentionDelegationReactorLive = Layer.effectDiscard(
  makeTeamMentionDelegationReactor,
);
