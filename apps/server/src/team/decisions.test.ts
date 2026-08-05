import { assert, describe, it } from "@effect/vitest";

import {
  formatDecisionMarkdown,
  parseDecisionMarkdown,
  slugifyDecisionTitle,
} from "./decisions.ts";

describe("slugifyDecisionTitle", () => {
  it("produces a filesystem-safe slug", () => {
    assert.equal(
      slugifyDecisionTitle("Use channel posts for duties"),
      "use-channel-posts-for-duties",
    );
    assert.equal(slugifyDecisionTitle("!!!"), "decision");
  });
});

describe("format/parse decision markdown", () => {
  it("round-trips frontmatter fields", () => {
    const markdown = formatDecisionMarkdown({
      id: "use-channel-posts-for-duties",
      title: "Use channel posts for duties",
      body: "We will report duty runs as task cards.\n\n## Context\nR4.",
      origin: { kind: "post", postId: "post_1" as never, channelId: "team" as never },
      promotedById: "human_ajay",
      promotedAt: "2026-08-05T12:00:00.000Z",
    });
    const parsed = parseDecisionMarkdown(
      markdown,
      ".repokin/decisions/use-channel-posts-for-duties.md",
    );
    assert.isNotNull(parsed);
    assert.equal(parsed?.id, "use-channel-posts-for-duties");
    assert.equal(parsed?.title, "Use channel posts for duties");
    assert.ok(parsed?.body.includes("task cards"));
    assert.equal(parsed?.origin.kind, "post");
    assert.equal(parsed?.promotedById, "human_ajay");
  });
});
