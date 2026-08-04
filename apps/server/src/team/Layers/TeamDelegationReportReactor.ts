import { CommandId } from "@t3tools/contracts";
import { PostId, type TeamPostContent, type TeamTaskReadModel } from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";

/** The `task-card` a completed delegation posts back to its origin channel. */
export function buildTaskReportCardContent(task: TeamTaskReadModel): TeamPostContent {
  return {
    kind: "task-card",
    taskId: task.taskId,
    title: task.title,
    taskState: task.state,
  };
}

/**
 * R2.3 terminal report. When a delegated agent thread settles, post a
 * `task-card` back to the channel that delegated it, authored by the assignee
 * agent (a structured card, which agents may post — FR-12.6). The task is
 * matched by its recorded `refs.threadId`; the card fans out like any post.
 *
 * Idempotent: the deterministic post id means a re-settle does not double-post.
 */
const makeTeamDelegationReportReactor = Effect.gen(function* () {
  const teamEngine = yield* TeamEngineService;
  const orchestration = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const onThreadSettled = (threadId: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const readModel = yield* teamEngine.getReadModel;
      for (const project of readModel.projects) {
        const task = project.tasks.find(
          (candidate) =>
            candidate.refs?.threadId != null && String(candidate.refs.threadId) === threadId,
        );
        if (task === undefined) {
          continue;
        }
        const channelId = task.refs?.channelId ?? null;
        if (channelId === null || task.assigneeId === null) {
          return;
        }
        const postId = PostId.make(`post-deleg-report-${task.taskId}`);
        // Idempotent: skip if this task's report was already posted.
        if (project.posts.some((post) => String(post.postId) === String(postId))) {
          return;
        }
        const commandId = CommandId.make(`server:team-deleg-report:${yield* crypto.randomUUIDv4}`);
        yield* teamEngine.dispatch({
          type: "team.channel.post",
          commandId,
          projectId: project.projectId,
          postId,
          channelId,
          authorId: task.assigneeId,
          content: buildTaskReportCardContent(task),
          metadata: { actorMemberId: task.assigneeId },
        });
        return;
      }
    }).pipe(Effect.ignoreCause({ log: true }));

  yield* orchestration.streamDomainEvents.pipe(
    Stream.runForEach((event) =>
      event.type === "thread.settled"
        ? onThreadSettled(String(event.payload.threadId))
        : Effect.void,
    ),
    Effect.forkScoped,
  );
});

export const TeamDelegationReportReactorLive = Layer.effectDiscard(makeTeamDelegationReportReactor);
