import { assert, describe, it } from "@effect/vitest";

import { buildEnvironmentDigest, refineDigestFromModelText } from "./digests.ts";

const members = new Map([
  ["human_ajay", { memberId: "human_ajay", displayName: "Ajay", memberType: "human" as const }],
  ["agent_aria", { memberId: "agent_aria", displayName: "Aria", memberType: "agent" as const }],
]);

describe("buildEnvironmentDigest", () => {
  it("rolls recent activities and open tasks per local member", () => {
    const nowMs = Date.parse("2026-08-05T12:00:00.000Z");
    const digest = buildEnvironmentDigest({
      environmentLabel: "laptop",
      localMemberIds: ["human_ajay", "agent_aria"],
      membersById: members,
      activities: [
        {
          kind: "channel.posted",
          occurredAt: "2026-08-05T10:00:00.000Z",
          actorMemberId: "human_ajay",
          summary: "posted",
        },
        {
          kind: "task.moved",
          occurredAt: "2026-08-05T11:00:00.000Z",
          actorMemberId: "agent_aria",
          summary: "moved",
        },
        {
          kind: "channel.posted",
          occurredAt: "2026-08-04T10:00:00.000Z", // outside window
          actorMemberId: "human_ajay",
          summary: "old",
        },
      ],
      tasks: [
        {
          taskId: "t1",
          title: "Ship R3",
          state: "in-progress",
          assigneeId: "agent_aria",
          updatedAt: "2026-08-05T11:00:00.000Z",
        },
        {
          taskId: "t2",
          title: "Done already",
          state: "done",
          assigneeId: "human_ajay",
          updatedAt: "2026-08-05T09:00:00.000Z",
        },
      ],
      nowMs,
    });

    assert.equal(digest.title, "Standup — laptop");
    assert.ok(digest.bullets.some((b) => b.startsWith("Ajay:")));
    assert.ok(digest.bullets.some((b) => b.includes("Aria") && b.includes("Ship R3")));
    assert.ok(!digest.bullets.some((b) => b.includes("Done already")));
  });

  it("emits an empty-state bullet when nothing happened", () => {
    const digest = buildEnvironmentDigest({
      localMemberIds: ["human_ajay"],
      membersById: members,
      activities: [],
      tasks: [],
      nowMs: Date.now(),
    });
    assert.equal(digest.bullets.length, 1);
    assert.ok(digest.bullets[0]!.includes("No attributed activity"));
  });
});

describe("refineDigestFromModelText", () => {
  it("prefers model bullets when present and falls back otherwise", () => {
    const template = {
      title: "Standup — env",
      bullets: ["template bullet"],
    };
    const polished = refineDigestFromModelText({
      template,
      title: "Standup — laptop",
      body: "- Shipped work map\n- Fixed gap markers\n",
    });
    assert.equal(polished.title, "Standup — laptop");
    assert.deepEqual(polished.bullets, ["Shipped work map", "Fixed gap markers"]);

    const fallback = refineDigestFromModelText({
      template,
      title: "  ",
      body: "\n",
    });
    assert.equal(fallback.title, template.title);
    assert.deepEqual(fallback.bullets, template.bullets);
  });
});
