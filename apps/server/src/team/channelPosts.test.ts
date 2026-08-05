import { EnvironmentId } from "@t3tools/contracts";
import { ChannelId, MemberId, PostId, type TeamPostReadModel } from "@t3tools/contracts/team";
import { assert, describe, it } from "@effect/vitest";

import {
  detectChannelGaps,
  selectChannelPostWindow,
  summarizeChannelPosts,
} from "./channelPosts.ts";

const author = MemberId.make("alice");
const envA = EnvironmentId.make("env_a");
const envB = EnvironmentId.make("env_b");

function post(
  channel: string,
  index: number,
  overrides: Partial<TeamPostReadModel> = {},
): TeamPostReadModel {
  return {
    postId: PostId.make(`${channel}-post-${index}`),
    channelId: ChannelId.make(channel),
    authorId: author,
    authorEnvironmentId: null,
    content: { kind: "text", body: `Message ${index}` },
    // Zero-padded so lexical order matches numeric order.
    postedAt: `2026-08-05T09:${String(index).padStart(2, "0")}:00.000Z`,
    senderSeq: 0,
    ...overrides,
  };
}

describe("selectChannelPostWindow", () => {
  const posts = [
    ...Array.from({ length: 10 }, (_, index) => post("team", index)),
    ...Array.from({ length: 3 }, (_, index) => post("other", index)),
  ];

  it("returns the newest `limit` posts (ascending) when before is null", () => {
    const window = selectChannelPostWindow(posts, ChannelId.make("team"), 3, null);
    assert.deepEqual(
      window.posts.map((p) => p.postId),
      ["team-post-7", "team-post-8", "team-post-9"],
    );
    assert.equal(window.hasMoreBefore, true);
  });

  it("pages older posts strictly before the cursor", () => {
    const window = selectChannelPostWindow(
      posts,
      ChannelId.make("team"),
      3,
      PostId.make("team-post-7"),
    );
    assert.deepEqual(
      window.posts.map((p) => p.postId),
      ["team-post-4", "team-post-5", "team-post-6"],
    );
    assert.equal(window.hasMoreBefore, true);
  });

  it("reports no more history once the oldest post is included", () => {
    const window = selectChannelPostWindow(
      posts,
      ChannelId.make("team"),
      3,
      PostId.make("team-post-2"),
    );
    assert.deepEqual(
      window.posts.map((p) => p.postId),
      ["team-post-0", "team-post-1"],
    );
    assert.equal(window.hasMoreBefore, false);
  });

  it("filters to the requested channel and caps at its length", () => {
    const window = selectChannelPostWindow(posts, ChannelId.make("other"), 50, null);
    assert.equal(window.posts.length, 3);
    assert.equal(
      window.posts.every((p) => p.channelId === "other"),
      true,
    );
    assert.equal(window.hasMoreBefore, false);
  });

  it("returns the tail when the cursor is unknown", () => {
    const window = selectChannelPostWindow(
      posts,
      ChannelId.make("team"),
      2,
      PostId.make("does-not-exist"),
    );
    assert.deepEqual(
      window.posts.map((p) => p.postId),
      ["team-post-8", "team-post-9"],
    );
  });
});

describe("summarizeChannelPosts", () => {
  it("rolls posts up into per-channel counts and last-activity", () => {
    const posts = [
      ...Array.from({ length: 10 }, (_, index) => post("team", index)),
      ...Array.from({ length: 3 }, (_, index) => post("other", index)),
    ];
    const stats = summarizeChannelPosts(posts);
    const byChannel = new Map(stats.map((entry) => [entry.channelId, entry]));

    assert.equal(byChannel.get(ChannelId.make("team"))?.postCount, 10);
    assert.equal(byChannel.get(ChannelId.make("team"))?.lastPostAt, "2026-08-05T09:09:00.000Z");
    assert.equal(byChannel.get(ChannelId.make("other"))?.postCount, 3);
    assert.equal(byChannel.get(ChannelId.make("other"))?.lastPostAt, "2026-08-05T09:02:00.000Z");
  });
});

describe("detectChannelGaps (R2.5 / PRD Q7)", () => {
  it("returns no gaps for contiguous per-sender sequences", () => {
    const other = MemberId.make("bob");
    const posts = [
      post("team", 0, { authorEnvironmentId: envA, senderSeq: 1 }),
      post("team", 1, { authorEnvironmentId: envA, senderSeq: 2 }),
      // Different author on another env — own stream starts at 1.
      post("team", 2, {
        authorId: other,
        authorEnvironmentId: envB,
        senderSeq: 1,
      }),
    ];
    assert.deepEqual(detectChannelGaps(posts, ChannelId.make("team")), []);
  });

  it("emits a gap when a per-sender sequence jumps (offline past TTL)", () => {
    const posts = [
      post("team", 0, {
        postId: PostId.make("p1"),
        authorEnvironmentId: envA,
        senderSeq: 1,
      }),
      // seq 2 and 3 never arrived
      post("team", 1, {
        postId: PostId.make("p4"),
        authorEnvironmentId: envA,
        senderSeq: 4,
      }),
    ];
    assert.deepEqual(detectChannelGaps(posts, ChannelId.make("team")), [
      {
        channelId: ChannelId.make("team"),
        afterPostId: PostId.make("p1"),
        beforePostId: PostId.make("p4"),
        missedCount: 2,
      },
    ]);
  });

  it("emits a leading gap when the first received post is not seq 1", () => {
    const posts = [
      post("team", 0, {
        postId: PostId.make("p5"),
        authorEnvironmentId: envA,
        senderSeq: 5,
      }),
    ];
    assert.deepEqual(detectChannelGaps(posts, ChannelId.make("team")), [
      {
        channelId: ChannelId.make("team"),
        afterPostId: null,
        beforePostId: PostId.make("p5"),
        missedCount: 4,
      },
    ]);
  });

  it("ignores legacy posts (senderSeq 0) and pure-local posts (no environment)", () => {
    const posts = [
      post("team", 0, { authorEnvironmentId: null, senderSeq: 0 }),
      post("team", 1, { authorEnvironmentId: null, senderSeq: 1 }),
      post("team", 2, { authorEnvironmentId: null, senderSeq: 99 }),
    ];
    assert.deepEqual(detectChannelGaps(posts, ChannelId.make("team")), []);
  });

  it("scopes gaps to the requested channel and includes them on the window", () => {
    const posts = [
      post("team", 0, {
        postId: PostId.make("t1"),
        authorEnvironmentId: envA,
        senderSeq: 1,
      }),
      post("team", 1, {
        postId: PostId.make("t3"),
        authorEnvironmentId: envA,
        senderSeq: 3,
      }),
      post("other", 0, {
        postId: PostId.make("o1"),
        authorEnvironmentId: envA,
        senderSeq: 1,
      }),
      post("other", 1, {
        postId: PostId.make("o9"),
        authorEnvironmentId: envA,
        senderSeq: 9,
      }),
    ];
    const window = selectChannelPostWindow(posts, ChannelId.make("team"), 50, null);
    assert.equal(window.posts.length, 2);
    assert.deepEqual(window.gaps, [
      {
        channelId: ChannelId.make("team"),
        afterPostId: PostId.make("t1"),
        beforePostId: PostId.make("t3"),
        missedCount: 1,
      },
    ]);
  });
});
