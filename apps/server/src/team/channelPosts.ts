import type {
  ChannelId,
  PostId,
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
}

/**
 * Return the newest `limit` posts of `channelId` strictly older than the
 * `before` cursor (or the channel tail when `before` is null), ascending
 * (oldest→newest) so the client can prepend when paging older. `hasMoreBefore`
 * reports whether any older post precedes the returned window.
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
  return { posts: channelPosts.slice(start, end), hasMoreBefore: start > 0 };
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
