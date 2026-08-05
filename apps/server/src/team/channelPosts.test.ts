import { ChannelId, MemberId, PostId, type TeamPostReadModel } from "@t3tools/contracts/team";
import { assert, describe, it } from "@effect/vitest";

import { selectChannelPostWindow, summarizeChannelPosts } from "./channelPosts.ts";

const author = MemberId.make("alice");

function post(channel: string, index: number): TeamPostReadModel {
  return {
    postId: PostId.make(`${channel}-post-${index}`),
    channelId: ChannelId.make(channel),
    authorId: author,
    authorEnvironmentId: null,
    content: { kind: "text", body: `Message ${index}` },
    // Zero-padded so lexical order matches numeric order.
    postedAt: `2026-08-05T09:${String(index).padStart(2, "0")}:00.000Z`,
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
