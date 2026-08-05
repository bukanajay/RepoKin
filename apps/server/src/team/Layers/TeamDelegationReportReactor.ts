import { CommandId, ThreadId, type ProjectId } from "@t3tools/contracts";
import {
  MemberId,
  PostId,
  type TeamPostContent,
  type TeamTaskReadModel,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";

export type DelegationReportStats = {
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly branch: string | null;
  readonly summary: string | null;
};

/**
 * Aggregate checkpoint file stats + last assistant paragraph for FR-13.5
 * terminal reports. Pure so tests can cover the card shape without the reactor.
 */
export function summarizeDelegationThread(input: {
  readonly branch: string | null;
  readonly checkpoints: ReadonlyArray<{
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly additions: number;
      readonly deletions: number;
    }>;
  }>;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
}): DelegationReportStats {
  const pathStats = new Map<string, { additions: number; deletions: number }>();
  for (const checkpoint of input.checkpoints) {
    for (const file of checkpoint.files) {
      const existing = pathStats.get(file.path) ?? { additions: 0, deletions: 0 };
      pathStats.set(file.path, {
        additions: existing.additions + file.additions,
        deletions: existing.deletions + file.deletions,
      });
    }
  }
  let additions = 0;
  let deletions = 0;
  for (const stats of pathStats.values()) {
    additions += stats.additions;
    deletions += stats.deletions;
  }

  let summary: string | null = null;
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i];
    if (message === undefined || message.role !== "assistant") continue;
    const trimmed = message.text.trim();
    if (trimmed.length === 0) continue;
    // One short paragraph for the channel card — not a transcript dump (FR-12.6).
    const paragraph =
      trimmed
        .split(/\n\s*\n/)[0]
        ?.replaceAll(/\s+/g, " ")
        .trim() ?? trimmed;
    summary = paragraph.slice(0, 280);
    break;
  }

  return {
    additions,
    deletions,
    changedFiles: pathStats.size,
    branch: input.branch,
    summary,
  };
}

/**
 * Prefer a `diff-card` when the agent actually touched files; otherwise a
 * `task-card` with the board state (usually `in-review`). FR-13.5.
 */
export function buildDelegationReportContent(input: {
  readonly task: TeamTaskReadModel;
  readonly stats: DelegationReportStats | null;
}): TeamPostContent {
  const stats = input.stats;
  if (stats !== null && stats.changedFiles > 0) {
    const summarySuffix =
      stats.summary !== null && stats.summary.length > 0 ? ` — ${stats.summary}` : "";
    const title = `${input.task.title}${summarySuffix}`.slice(0, 200);
    return {
      kind: "diff-card",
      title: title.length > 0 ? title : input.task.title,
      additions: stats.additions,
      deletions: stats.deletions,
      changedFiles: stats.changedFiles,
      branch: stats.branch,
    };
  }
  return {
    kind: "task-card",
    taskId: input.task.taskId,
    title: input.task.title,
    taskState: input.task.state,
  };
}

/** @deprecated Prefer buildDelegationReportContent — kept for existing tests. */
export function buildTaskReportCardContent(task: TeamTaskReadModel): TeamPostContent {
  return buildDelegationReportContent({ task, stats: null });
}

/**
 * R2.3 / FR-13.5 terminal report. When a delegated agent thread settles:
 *   1. move the task to `in-review` (agent may not mark own task done — FR-18.3)
 *   2. post one structured card (diff-card when files changed, else task-card)
 *
 * Matched by `refs.threadId`. Idempotent via deterministic post id.
 */
const makeTeamDelegationReportReactor = Effect.gen(function* () {
  const teamEngine = yield* TeamEngineService;
  const orchestration = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
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

        // FR-13.2/18.3: agent work ends in review, never self-done.
        if (task.state === "in-progress" || task.state === "backlog") {
          yield* teamEngine
            .dispatch({
              type: "team.task.move",
              commandId: CommandId.make(`server:team-deleg-review:${yield* crypto.randomUUIDv4}`),
              projectId: project.projectId as ProjectId,
              taskId: task.taskId,
              toState: "in-review",
              movedById: MemberId.make(String(task.assigneeId)),
              metadata: { actorMemberId: MemberId.make(String(task.assigneeId)) },
            })
            .pipe(Effect.ignoreCause({ log: true }));
        }

        const postId = PostId.make(`post-deleg-report-${task.taskId}`);
        if (project.posts.some((post) => String(post.postId) === String(postId))) {
          return;
        }

        // Fresh task state after possible move.
        const latestReadModel = yield* teamEngine.getReadModel;
        const latestProject = latestReadModel.projects.find(
          (candidate) => candidate.projectId === project.projectId,
        );
        const latestTask =
          latestProject?.tasks.find((candidate) => candidate.taskId === task.taskId) ?? task;

        const threadDetail = yield* projectionSnapshotQuery
          .getThreadDetailById(ThreadId.make(threadId))
          .pipe(Effect.orElseSucceed(() => Option.none()));

        let stats: DelegationReportStats | null = null;
        if (Option.isSome(threadDetail)) {
          const thread = threadDetail.value;
          stats = summarizeDelegationThread({
            branch: thread.branch,
            checkpoints: thread.checkpoints,
            messages: thread.messages.map((message) => ({
              role: message.role,
              text: message.text,
            })),
          });
        }

        const commandId = CommandId.make(`server:team-deleg-report:${yield* crypto.randomUUIDv4}`);
        yield* teamEngine.dispatch({
          type: "team.channel.post",
          commandId,
          projectId: project.projectId,
          postId,
          channelId,
          authorId: task.assigneeId,
          content: buildDelegationReportContent({ task: latestTask, stats }),
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
