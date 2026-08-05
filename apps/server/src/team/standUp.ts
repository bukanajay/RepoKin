/**
 * R3.3 standup: generate a deterministic digest for this environment and post
 * it to a channel (default `#team`) as a typed `digest` post (FR-15.3).
 */
import { CommandId, type ProjectId } from "@t3tools/contracts";
import {
  ChannelId,
  MemberId,
  PostId,
  TeamStandupDigestError,
  type TeamStandupDigestResult,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { buildEnvironmentDigest, type DigestMember } from "./digests.ts";
import { TeamEngineService } from "./Services/TeamEngine.ts";
import { TeamFileStore } from "./Services/TeamFileStore.ts";

function resolveLocalHumanId(
  humans: ReadonlyArray<{
    readonly id: string;
    readonly environments?: ReadonlyArray<{ readonly environmentId: string }> | undefined;
  }>,
  environmentId: string,
): string | null {
  const linked = humans.find((human) =>
    (human.environments ?? []).some((entry) => String(entry.environmentId) === environmentId),
  );
  if (linked !== undefined) return linked.id;
  return humans.length === 1 ? (humans[0]?.id ?? null) : null;
}

export const postStandupDigest = Effect.fn("TeamStandup.post")(function* (input: {
  readonly projectId: ProjectId;
  readonly channelId?: string;
}) {
  const teamEngine = yield* TeamEngineService;
  const teamFileStore = yield* TeamFileStore;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverEnvironment = yield* ServerEnvironment;
  const crypto = yield* Crypto.Crypto;

  const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
  const project = snapshot.projects.find((candidate) => candidate.id === input.projectId);
  if (project === undefined) {
    return yield* new TeamStandupDigestError({
      message: `Project '${input.projectId}' is not open on this environment.`,
    });
  }

  const environmentId = yield* serverEnvironment.getEnvironmentId;
  const roster = yield* teamFileStore.readRoster(project.workspaceRoot).pipe(
    Effect.mapError(
      (cause) =>
        new TeamStandupDigestError({
          message: "Failed to read the RepoKin roster for standup.",
          cause,
        }),
    ),
  );

  const localHumanId = resolveLocalHumanId(roster.humans, environmentId);
  if (localHumanId === null) {
    return yield* new TeamStandupDigestError({
      message: "No local human identity is linked to this environment; cannot attribute a standup.",
    });
  }

  const localMemberIds = [
    localHumanId,
    ...roster.agents
      .filter(
        (agent) =>
          agent.homeEnvironment === undefined ||
          String(agent.homeEnvironment) === String(environmentId),
      )
      .map((agent) => agent.id as string),
  ];

  const membersById = new Map<string, DigestMember>();
  for (const human of roster.humans) {
    membersById.set(human.id, {
      memberId: human.id,
      displayName: human.displayName,
      memberType: "human",
    });
  }
  for (const agent of roster.agents) {
    membersById.set(agent.id, {
      memberId: agent.id,
      displayName: agent.name,
      memberType: "agent",
    });
  }

  const readModel = yield* teamEngine.getReadModel;
  const domainProject =
    readModel.projects.find((candidate) => candidate.projectId === input.projectId) ?? null;

  const channelId = ChannelId.make(input.channelId ?? "team");
  const declared = (domainProject?.channels ?? []).some(
    (channel) => String(channel.id) === String(channelId),
  );
  if (!declared) {
    return yield* new TeamStandupDigestError({
      message: `Channel '#${channelId}' does not exist. Declare it before posting a standup.`,
    });
  }

  const now = yield* DateTime.now;
  const digest = buildEnvironmentDigest({
    environmentLabel: String(environmentId).slice(0, 12),
    localMemberIds,
    membersById,
    activities: (domainProject?.activities ?? []).map((activity) => ({
      kind: activity.kind,
      occurredAt: activity.occurredAt,
      actorMemberId: activity.actorMemberId,
      summary: activity.summary,
    })),
    tasks: (domainProject?.tasks ?? []).map((task) => ({
      taskId: task.taskId,
      title: task.title,
      state: task.state,
      assigneeId: task.assigneeId,
      updatedAt: task.updatedAt,
    })),
    nowMs: now.epochMilliseconds,
  });

  const postId = PostId.make(`standup-${yield* crypto.randomUUIDv4}`);
  const commandId = CommandId.make(`client:team-standup:${postId}`);

  yield* teamEngine
    .dispatch({
      type: "team.channel.post",
      commandId,
      projectId: input.projectId,
      postId,
      channelId,
      authorId: MemberId.make(localHumanId),
      content: {
        kind: "digest",
        title: digest.title,
        bullets: [...digest.bullets],
      },
      metadata: {
        actorMemberId: MemberId.make(localHumanId),
        environmentId,
      },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TeamStandupDigestError({
            message: "Failed to post the standup digest to the channel.",
            cause,
          }),
      ),
    );

  return {
    postId,
    channelId,
    title: digest.title,
    bullets: digest.bullets,
  } satisfies TeamStandupDigestResult;
});
