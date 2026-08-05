import type {
  ChannelId,
  PostId,
  TeamChannelGapMarker,
  TeamChannelPostStats,
  TeamPostReadModel,
} from "@t3tools/contracts/team";

/**
 * Pure helpers for serving channel posts without shipping a whole channel's
 * history. The read model already holds every post in memory (see the boot
 * replay), so these just slice/aggregate it cheaply per request.
 */

// Total order over posts: by time, breaking ties by id for determinism.
function comparePosts(left: TeamPostReadModel, right: TeamPostReadModel): number {
  const byTime = left.postedAt.localeCompare(right.postedAt);
  return byTime !== 0 ? byTime : left.postId.localeCompare(right.postId);
}

export interface ChannelPostWindow {
  readonly posts: TeamPostReadModel[];
  readonly hasMoreBefore: boolean;
  readonly gaps: TeamChannelGapMarker[];
}

/**
 * Detect honest history gaps from per-sender causal sequences (PRD FR-12.4 /
 * FR-12.5 / Q7). A jump in `senderSeq` for the same author means intermediate
 * posts never arrived (typically offline past relay TTL).
 *
 * - `senderSeq === 0` is legacy/unknown and is ignored.
 * - Only posts with a known `authorEnvironmentId` participate (cross-env
 *   fan-out is what can drop); pure local history has no TTL loss.
 * - Grouped by authorId (the causal sender), not environment, so two members
 *   on one environment don't create false gaps in each other's streams.
 */
export function detectChannelGaps(
  posts: ReadonlyArray<TeamPostReadModel>,
  channelId: ChannelId,
): TeamChannelGapMarker[] {
  const channelPosts = posts
    .filter(
      (post) =>
        post.channelId === channelId && post.authorEnvironmentId !== null && post.senderSeq > 0,
    )
    .sort(comparePosts);

  // Group by author — the causal "sender" of FR-12.5.
  const bySender = new Map<string, TeamPostReadModel[]>();
  for (const post of channelPosts) {
    const key = String(post.authorId);
    const list = bySender.get(key);
    if (list === undefined) bySender.set(key, [post]);
    else list.push(post);
  }

  const gaps: TeamChannelGapMarker[] = [];
  for (const stream of bySender.values()) {
    // Re-order by senderSeq so a late-arriving older post still reveals the
    // right gap (arrival order is not causal order — FR-12.5).
    const ordered = [...stream].sort((left, right) => {
      const bySeq = left.senderSeq - right.senderSeq;
      return bySeq !== 0 ? bySeq : comparePosts(left, right);
    });

    const first = ordered[0];
    if (first !== undefined && first.senderSeq > 1) {
      gaps.push({
        channelId,
        afterPostId: null,
        beforePostId: first.postId,
        missedCount: first.senderSeq - 1,
      });
    }

    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      const jump = current.senderSeq - previous.senderSeq;
      if (jump > 1) {
        gaps.push({
          channelId,
          afterPostId: previous.postId,
          beforePostId: current.postId,
          missedCount: jump - 1,
        });
      }
    }
  }

  // Stable presentation order: by the post the gap precedes (or after-post
  // when the gap is open-ended — not currently emitted).
  gaps.sort((left, right) => {
    const leftKey = left.beforePostId ?? left.afterPostId ?? "";
    const rightKey = right.beforePostId ?? right.afterPostId ?? "";
    return String(leftKey).localeCompare(String(rightKey));
  });
  return gaps;
}

/**
 * Return the newest `limit` posts of `channelId` strictly older than the
 * `before` cursor (or the channel tail when `before` is null), ascending
 * (oldest→newest) so the client can prepend when paging older. `hasMoreBefore`
 * reports whether any older post precedes the returned window. `gaps` covers
 * the whole channel so a windowed client still sees missed history.
 */
export function selectChannelPostWindow(
  posts: ReadonlyArray<TeamPostReadModel>,
  channelId: ChannelId,
  limit: number,
  before: PostId | null,
): ChannelPostWindow {
  const channelPosts = posts.filter((post) => post.channelId === channelId).sort(comparePosts);
  const normalizedLimit = Math.max(0, Math.floor(limit));

  // Cursor not found (e.g. a stale id) falls back to the tail rather than erroring.
  const end =
    before === null
      ? channelPosts.length
      : (() => {
          const index = channelPosts.findIndex((post) => post.postId === before);
          return index === -1 ? channelPosts.length : index;
        })();

  const start = Math.max(0, end - normalizedLimit);
  return {
    posts: channelPosts.slice(start, end),
    hasMoreBefore: start > 0,
    gaps: detectChannelGaps(posts, channelId),
  };
}

/**
 * Roll every post up into per-channel counts + last-activity, so the channel
 * list never needs the posts themselves. Channels with no posts are absent;
 * callers default them to zero.
 */
export function summarizeChannelPosts(
  posts: ReadonlyArray<TeamPostReadModel>,
): TeamChannelPostStats[] {
  const byChannel = new Map<ChannelId, { postCount: number; lastPostAt: string | null }>();
  for (const post of posts) {
    const current = byChannel.get(post.channelId) ?? { postCount: 0, lastPostAt: null };
    current.postCount += 1;
    if (current.lastPostAt === null || post.postedAt > current.lastPostAt) {
      current.lastPostAt = post.postedAt;
    }
    byChannel.set(post.channelId, current);
  }
  return Array.from(byChannel, ([channelId, stats]) => ({
    channelId,
    postCount: stats.postCount,
    lastPostAt: stats.lastPostAt,
  }));
}
