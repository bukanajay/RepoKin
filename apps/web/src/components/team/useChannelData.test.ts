import { describe, expect, it } from "@effect/vitest";

import { interleaveTimeline, type ChannelGap, type ChannelPost } from "./useChannelData";

function textPost(id: string, body: string): ChannelPost {
  return {
    postId: id,
    channelId: "team",
    authorId: "human_ajay",
    postedAt: `2026-08-05T10:00:0${id.slice(-1)}.000Z`,
    kind: "text",
    body,
  };
}

function gap(after: string | null, before: string | null, missed: number): ChannelGap {
  return {
    kind: "gap",
    gapId: `gap:team:${after ?? "start"}:${before ?? "end"}`,
    channelId: "team",
    afterPostId: after,
    beforePostId: before,
    missedCount: missed,
  };
}

describe("interleaveTimeline", () => {
  it("returns posts unchanged when there are no gaps", () => {
    const posts = [textPost("p1", "a"), textPost("p2", "b")];
    expect(interleaveTimeline(posts, [])).toEqual(posts);
  });

  it("places a gap immediately before its beforePostId", () => {
    const posts = [textPost("p1", "a"), textPost("p4", "b")];
    const gaps = [gap("p1", "p4", 2)];
    const timeline = interleaveTimeline(posts, gaps);
    expect(timeline.map((item) => (item.kind === "gap" ? item.gapId : item.postId))).toEqual([
      "p1",
      "gap:team:p1:p4",
      "p4",
    ]);
  });

  it("surfaces a leading gap when history starts mid-sequence", () => {
    const posts = [textPost("p5", "late")];
    const gaps = [gap(null, "p5", 4)];
    const timeline = interleaveTimeline(posts, gaps);
    expect(timeline[0]).toMatchObject({ kind: "gap", missedCount: 4 });
    expect(timeline[1]).toMatchObject({ postId: "p5" });
  });

  it("keeps gaps that reference unloaded posts at the top (never silent)", () => {
    const posts = [textPost("p9", "newest")];
    const gaps = [gap("p1", "p3", 1)];
    const timeline = interleaveTimeline(posts, gaps);
    expect(timeline[0]).toMatchObject({ kind: "gap", afterPostId: "p1" });
    expect(timeline[1]).toMatchObject({ postId: "p9" });
  });
});
