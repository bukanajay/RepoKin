import { CommandId } from "@t3tools/contracts";
import { ChannelId, MemberId, PostId, type TeamPostReadModel } from "@t3tools/contracts/team";
import { useCallback, useMemo } from "react";

import { randomUUID } from "../../lib/utils";
import { teamEnvironment } from "../../state/team";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import {
  buildMemberSummaryMap,
  resolveLocalHumanId,
  type LiveMemberSummary,
} from "./liveTeamMembers";
import { useTeamScope } from "./teamScope";

/**
 * Channel-view data seam — LIVE (R2.4 flip). Posts come from the team read
 * model; the composer dispatches `team.channel.post`. The post shape is
 * flattened from the contract's nested `content` so the view component is
 * unchanged. Fixture file deleted; Preview badge dropped.
 */

type PostBase = {
  postId: string;
  channelId: string;
  authorId: string;
  postedAt: string;
};

export type ChannelPost = PostBase &
  (
    | { kind: "text"; body: string }
    | { kind: "thread-card"; title: string; status: string; threadId: string }
    | {
        kind: "diff-card";
        title: string;
        additions: number;
        deletions: number;
        changedFiles: number;
        branch: string;
      }
    | { kind: "task-card"; title: string; taskState: string; taskId: string }
    | { kind: "event"; summary: string }
    | { kind: "digest"; title: string; bullets: readonly string[] }
  );

export type ChannelInfo = {
  channelId: string;
  slug: string;
  name: string;
  description: string;
};

export type ChannelData = {
  status: "no-environment" | "no-project" | "loading" | "ready";
  channel: ChannelInfo | null;
  posts: readonly ChannelPost[];
  memberById: ReadonlyMap<string, LiveMemberSummary>;
  /** Whether the local actor can post (a local human was resolved). */
  canPost: boolean;
  sendTextPost: (body: string) => void;
};

function flattenPost(post: TeamPostReadModel): ChannelPost {
  const base: PostBase = {
    postId: post.postId,
    channelId: post.channelId,
    authorId: post.authorId,
    postedAt: post.postedAt,
  };
  const content = post.content;
  switch (content.kind) {
    case "text":
      return { ...base, kind: "text", body: content.body };
    case "thread-card":
      return {
        ...base,
        kind: "thread-card",
        title: content.title,
        status: content.status ?? "",
        threadId: content.threadId,
      };
    case "diff-card":
      return {
        ...base,
        kind: "diff-card",
        title: content.title,
        additions: content.additions,
        deletions: content.deletions,
        changedFiles: content.changedFiles,
        branch: content.branch ?? "",
      };
    case "task-card":
      return {
        ...base,
        kind: "task-card",
        title: content.title,
        taskState: content.taskState,
        taskId: content.taskId,
      };
    case "event":
      return { ...base, kind: "event", summary: content.summary };
    case "digest":
      return { ...base, kind: "digest", title: content.title, bullets: content.bullets };
  }
}

export function useChannelData(channelSlug: string): ChannelData {
  const { environmentId, project } = useTeamScope();
  const dispatchCommand = useAtomCommand(teamEnvironment.dispatchCommand, "post to team channel");

  const rosterAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.roster({ environmentId, input: { cwd: project.workspaceRoot } });
  const roster = useEnvironmentQuery(rosterAtom);

  const localStateAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.localState({ environmentId, input: { projectId: project.id } });
  const localState = useEnvironmentQuery(localStateAtom);

  const localHumanId =
    roster.data === null ? null : resolveLocalHumanId(roster.data.humans, environmentId);

  const sendTextPost = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      if (
        trimmed.length === 0 ||
        environmentId === null ||
        project === null ||
        localHumanId === null
      ) {
        return;
      }
      void dispatchCommand({
        environmentId,
        input: {
          type: "team.channel.post",
          commandId: CommandId.make(`client:team-channel-post:${randomUUID()}`),
          projectId: project.id,
          postId: PostId.make(`post-${randomUUID()}`),
          channelId: ChannelId.make(channelSlug),
          authorId: MemberId.make(localHumanId),
          content: { kind: "text", body: trimmed },
          metadata: { actorMemberId: MemberId.make(localHumanId) },
        },
      }).then((result) => {
        if (result._tag === "Success") localState.refresh();
      });
    },
    [channelSlug, dispatchCommand, environmentId, localHumanId, localState, project],
  );

  return useMemo<ChannelData>(() => {
    const base = { channel: null, posts: [], memberById: new Map(), canPost: false, sendTextPost };
    if (environmentId === null) return { status: "no-environment", ...base };
    if (project === null) return { status: "no-project", ...base };
    if (roster.data === null || localState.data === null) return { status: "loading", ...base };

    const declaration = (localState.data.project?.channels ?? []).find(
      (candidate) => candidate.id === channelSlug,
    );
    const channel: ChannelInfo | null =
      declaration === undefined
        ? null
        : {
            channelId: declaration.id,
            slug: declaration.id,
            name: declaration.name,
            description: declaration.description ?? "",
          };

    const posts =
      channel === null
        ? []
        : (localState.data.project?.posts ?? [])
            .filter((post) => post.channelId === channel.channelId)
            .sort((left, right) => left.postedAt.localeCompare(right.postedAt))
            .map(flattenPost);

    return {
      status: "ready",
      channel,
      posts,
      memberById: buildMemberSummaryMap(roster.data, localState.data.project?.members ?? []),
      canPost: localHumanId !== null,
      sendTextPost,
    };
  }, [
    channelSlug,
    environmentId,
    localHumanId,
    localState.data,
    project,
    roster.data,
    sendTextPost,
  ]);
}
