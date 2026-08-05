import { CommandId } from "@t3tools/contracts";
import {
  ChannelId,
  MemberId,
  PostId,
  TEAM_CHANNEL_POSTS_PAGE_SIZE,
  type TeamChannelGapMarker,
  type TeamPostReadModel,
} from "@t3tools/contracts/team";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
 * Channel-view data seam — LIVE. Channel metadata + members come from the team
 * read model (`teamReadLocalState`); posts are paginated separately via
 * `teamReadChannelPosts` so a busy channel never ships its whole history. The
 * reactive newest window keeps the tail live; older pages are fetched on demand
 * and accumulated (union by postId) so a live tail never opens a gap.
 *
 * Gap markers (PRD FR-12.4 / Q7) come with every posts window and are merged
 * by identity so a partial history still surfaces missed posts honestly.
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

/** Honest missed-history marker (offline past relay TTL). */
export type ChannelGap = {
  kind: "gap";
  /** Stable key for list recycling. */
  gapId: string;
  channelId: string;
  afterPostId: string | null;
  beforePostId: string | null;
  missedCount: number | null;
};

/** Posts and gap markers interleaved for the virtualized timeline. */
export type ChannelTimelineItem = ChannelPost | ChannelGap;

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
  /**
   * Posts + gap markers in display order (oldest → newest). Prefer this over
   * `posts` for the channel list so missed history is visible (NFR-5).
   */
  timeline: readonly ChannelTimelineItem[];
  /** True while the first page of posts is still loading. */
  postsPending: boolean;
  /** True when older posts exist before the oldest loaded post. */
  hasMoreBefore: boolean;
  /** Fetch and prepend the next older window (no-op when none remain). */
  loadOlder: () => void;
  memberById: ReadonlyMap<string, LiveMemberSummary>;
  /** Whether the local actor can post (a local human was resolved). */
  canPost: boolean;
  sendTextPost: (body: string) => void;
};

function gapIdentity(gap: TeamChannelGapMarker): string {
  return `gap:${gap.channelId}:${gap.afterPostId ?? "start"}:${gap.beforePostId ?? "end"}`;
}

function flattenGap(gap: TeamChannelGapMarker): ChannelGap {
  return {
    kind: "gap",
    gapId: gapIdentity(gap),
    channelId: gap.channelId,
    afterPostId: gap.afterPostId,
    beforePostId: gap.beforePostId,
    missedCount: gap.missedCount,
  };
}

/**
 * Interleave gap markers with posts. A gap whose `beforePostId` matches a
 * loaded post is placed immediately before that post; a gap with no
 * `beforePostId` (open-ended) is placed after its `afterPostId`. Gaps that
 * reference unloaded posts are still shown at the top so history loss is
 * never silent.
 */
export function interleaveTimeline(
  posts: readonly ChannelPost[],
  gaps: readonly ChannelGap[],
): ChannelTimelineItem[] {
  if (gaps.length === 0) return [...posts];

  const postIndex = new Map(posts.map((post, index) => [post.postId, index]));
  const beforeBuckets = new Map<number, ChannelGap[]>();
  const leading: ChannelGap[] = [];

  for (const gap of gaps) {
    if (gap.beforePostId !== null && postIndex.has(gap.beforePostId)) {
      const index = postIndex.get(gap.beforePostId)!;
      const bucket = beforeBuckets.get(index);
      if (bucket === undefined) beforeBuckets.set(index, [gap]);
      else bucket.push(gap);
      continue;
    }
    if (gap.afterPostId !== null && postIndex.has(gap.afterPostId)) {
      // Place after the known post = before the next index.
      const index = postIndex.get(gap.afterPostId)! + 1;
      if (index >= posts.length) {
        // After the last loaded post.
        const bucket = beforeBuckets.get(posts.length);
        if (bucket === undefined) beforeBuckets.set(posts.length, [gap]);
        else bucket.push(gap);
      } else {
        const bucket = beforeBuckets.get(index);
        if (bucket === undefined) beforeBuckets.set(index, [gap]);
        else bucket.push(gap);
      }
      continue;
    }
    leading.push(gap);
  }

  const timeline: ChannelTimelineItem[] = [...leading];
  for (let index = 0; index < posts.length; index++) {
    const before = beforeBuckets.get(index);
    if (before !== undefined) timeline.push(...before);
    timeline.push(posts[index]!);
  }
  const trailing = beforeBuckets.get(posts.length);
  if (trailing !== undefined) timeline.push(...trailing);
  return timeline;
}

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

// Total order matching the server: by time, breaking ties by id.
function comparePosts(left: TeamPostReadModel, right: TeamPostReadModel): number {
  const byTime = left.postedAt.localeCompare(right.postedAt);
  return byTime !== 0 ? byTime : left.postId.localeCompare(right.postId);
}

const EMPTY_POSTS: ReadonlyMap<string, TeamPostReadModel> = new Map();

// Add incoming posts to the accumulated set without ever dropping one; returns
// the same map when nothing is new so effects don't churn.
function mergePosts(
  previous: ReadonlyMap<string, TeamPostReadModel>,
  incoming: ReadonlyArray<TeamPostReadModel>,
): ReadonlyMap<string, TeamPostReadModel> {
  let next: Map<string, TeamPostReadModel> | null = null;
  for (const post of incoming) {
    if (!previous.has(post.postId)) {
      next ??= new Map(previous);
      next.set(post.postId, post);
    }
  }
  return next ?? previous;
}

export function useChannelData(channelSlug: string): ChannelData {
  const { environmentId, project } = useTeamScope();
  const dispatchCommand = useAtomCommand(teamEnvironment.dispatchCommand, "post to team channel");
  const readOlder = useAtomCommand(teamEnvironment.readChannelPosts, "read older channel posts");

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

  // Reactive newest window (before=null) — refreshes as posts land.
  const newestAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.channelPosts({
          environmentId,
          input: {
            projectId: project.id,
            channelId: ChannelId.make(channelSlug),
            limit: TEAM_CHANNEL_POSTS_PAGE_SIZE,
            before: null,
          },
        });
  const newest = useEnvironmentQuery(newestAtom);

  // Accumulated posts across the live tail + any fetched older pages.
  const [postsById, setPostsById] = useState<ReadonlyMap<string, TeamPostReadModel>>(EMPTY_POSTS);
  const [gapsById, setGapsById] = useState<ReadonlyMap<string, ChannelGap>>(new Map());
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const seededHasMore = useRef(false);
  const loadingOlder = useRef(false);

  const localHumanId =
    roster.data === null ? null : resolveLocalHumanId(roster.data.humans, environmentId);

  // Reset accumulation when the target channel/project/environment changes.
  useEffect(() => {
    setPostsById(EMPTY_POSTS);
    setGapsById(new Map());
    setHasMoreBefore(false);
    seededHasMore.current = false;
  }, [channelSlug, project?.id, environmentId]);

  const mergeGaps = useCallback((incoming: ReadonlyArray<TeamChannelGapMarker>) => {
    if (incoming.length === 0) return;
    setGapsById((previous) => {
      let next: Map<string, ChannelGap> | null = null;
      for (const raw of incoming) {
        const gap = flattenGap(raw);
        if (!previous.has(gap.gapId)) {
          next ??= new Map(previous);
          next.set(gap.gapId, gap);
        }
      }
      return next ?? previous;
    });
  }, []);

  // Merge each newest-window snapshot; seed hasMoreBefore from the first one.
  useEffect(() => {
    const data = newest.data;
    if (data === null) return;
    if (data.posts.length > 0) {
      setPostsById((previous) => mergePosts(previous, data.posts));
    }
    mergeGaps(data.gaps ?? []);
    if (!seededHasMore.current) {
      seededHasMore.current = true;
      setHasMoreBefore(data.hasMoreBefore);
    }
  }, [mergeGaps, newest.data]);

  const posts = useMemo(
    () => Array.from(postsById.values()).sort(comparePosts).map(flattenPost),
    [postsById],
  );

  const timeline = useMemo(
    () => interleaveTimeline(posts, Array.from(gapsById.values())),
    [gapsById, posts],
  );

  const loadOlder = useCallback(() => {
    if (
      environmentId === null ||
      project === null ||
      loadingOlder.current ||
      !hasMoreBefore ||
      posts.length === 0
    ) {
      return;
    }
    loadingOlder.current = true;
    void readOlder({
      environmentId,
      input: {
        projectId: project.id,
        channelId: ChannelId.make(channelSlug),
        limit: TEAM_CHANNEL_POSTS_PAGE_SIZE,
        before: PostId.make(posts[0]!.postId),
      },
    })
      .then((result) => {
        if (result._tag === "Success") {
          setPostsById((previous) => mergePosts(previous, result.value.posts));
          setHasMoreBefore(result.value.hasMoreBefore);
          mergeGaps(result.value.gaps ?? []);
        }
      })
      .finally(() => {
        loadingOlder.current = false;
      });
  }, [channelSlug, environmentId, hasMoreBefore, mergeGaps, posts, project, readOlder]);

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
        // Refresh the live tail so the just-sent post shows without a reload.
        if (result._tag === "Success") newest.refresh();
      });
    },
    [channelSlug, dispatchCommand, environmentId, localHumanId, newest, project],
  );

  return useMemo<ChannelData>(() => {
    const base = {
      channel: null,
      posts: [] as readonly ChannelPost[],
      timeline: [] as readonly ChannelTimelineItem[],
      postsPending: false,
      hasMoreBefore: false,
      loadOlder,
      memberById: new Map(),
      canPost: false,
      sendTextPost,
    };
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

    return {
      status: "ready",
      channel,
      posts: channel === null ? [] : posts,
      timeline: channel === null ? [] : timeline,
      postsPending: channel !== null && posts.length === 0 && newest.isPending,
      hasMoreBefore,
      loadOlder,
      memberById: buildMemberSummaryMap(roster.data, localState.data.project?.members ?? []),
      canPost: localHumanId !== null,
      sendTextPost,
    };
  }, [
    channelSlug,
    environmentId,
    hasMoreBefore,
    loadOlder,
    localHumanId,
    localState.data,
    newest.isPending,
    timeline,
    posts,
    project,
    roster.data,
    sendTextPost,
  ]);
}
