import { assert, describe, it } from "@effect/vitest";
import type { TeamRosterReadModel } from "@t3tools/contracts/team";

import { parseGitNumstatLog, projectRepoPulse } from "./repoPulse.ts";

const roster = {
  humans: [
    {
      schemaVersion: 1,
      id: "human_ajay",
      type: "human",
      displayName: "Ajay",
      gitEmails: ["ajay@example.com"],
    },
  ],
  agents: [],
  warnings: [],
} as unknown as TeamRosterReadModel;

describe("parseGitNumstatLog", () => {
  it("attributes agent trailers and aggregates numstat", () => {
    const log = [
      "COMMIT abc\tajay@example.com",
      "TRAILER agent_aria",
      "10\t2\tapps/web/src/a.ts",
      "3\t0\tapps/server/src/b.ts",
      "COMMIT def\tajay@example.com",
      "1\t1\tdocs/readme.md",
    ].join("\n");
    const commits = parseGitNumstatLog(log);
    assert.equal(commits.length, 2);
    assert.equal(commits[0]?.agentId, "agent_aria");
    assert.equal(commits[0]?.additions, 13);
    assert.equal(commits[1]?.agentId, null);
  });
});

describe("projectRepoPulse", () => {
  it("splits human vs agent and builds hotspots", () => {
    const pulse = projectRepoPulse({
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-08-05T00:00:00.000Z",
      roster,
      commits: [
        {
          hash: "a",
          authorEmail: "ajay@example.com",
          agentId: "agent_aria",
          paths: ["apps/web/src/x.ts"],
          additions: 5,
          deletions: 1,
        },
        {
          hash: "b",
          authorEmail: "ajay@example.com",
          agentId: null,
          paths: ["apps/web/src/y.ts", "docs/a.md"],
          additions: 2,
          deletions: 0,
        },
      ],
    });
    assert.equal(pulse.totalCommits, 2);
    assert.equal(pulse.agents[0]?.id, "agent_aria");
    assert.equal(pulse.humans[0]?.id, "human_ajay");
    assert.ok(pulse.hotspots.some((h) => h.path.startsWith("apps/web")));
  });
});
