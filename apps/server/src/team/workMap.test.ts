import { assert, describe, it } from "@effect/vitest";

import {
  coarsenToDirectory,
  detectOverlaps,
  directoriesFromPaths,
  projectWorkMapNodes,
} from "./workMap.ts";

describe("coarsenToDirectory", () => {
  it("drops the file segment and caps depth", () => {
    assert.equal(
      coarsenToDirectory("apps/web/src/components/team/useWorkMapData.ts"),
      "apps/web/src/components",
    );
    assert.equal(coarsenToDirectory("packages/contracts/src/team.ts", 3), "packages/contracts/src");
  });

  it("keeps directory paths and rejects absolute / traversal / empty", () => {
    assert.equal(coarsenToDirectory("apps/server/src/team"), "apps/server/src/team");
    assert.equal(coarsenToDirectory(".github/workflows/ci.yml"), ".github/workflows");
    assert.equal(coarsenToDirectory("/etc/passwd"), null);
    assert.equal(coarsenToDirectory("../outside"), null);
    assert.equal(coarsenToDirectory(""), null);
    assert.equal(coarsenToDirectory("README.md"), null);
  });
});

describe("directoriesFromPaths", () => {
  it("dedupes and sorts coarsened directories", () => {
    assert.deepEqual(
      directoriesFromPaths([
        "apps/web/src/a.ts",
        "apps/web/src/b.ts",
        "apps/server/src/team/decider.ts",
      ]),
      ["apps/server/src/team", "apps/web/src"],
    );
  });
});

describe("projectWorkMapNodes", () => {
  it("groups members onto directories and weights by activity", () => {
    const nodes = projectWorkMapNodes([
      { memberId: "human_ajay", directories: ["apps/web/src", "apps/server/src/team"] },
      { memberId: "agent_aria", directories: ["apps/web/src"], weight: 3 },
      { memberId: "agent_bolt", directories: ["packages/contracts/src"] },
    ]);
    assert.deepEqual(
      nodes.map((node) => ({ path: node.path, memberIds: node.memberIds })),
      [
        { path: "apps/web/src", memberIds: ["agent_aria", "human_ajay"] },
        { path: "apps/server/src/team", memberIds: ["human_ajay"] },
        { path: "packages/contracts/src", memberIds: ["agent_bolt"] },
      ],
    );
    // Aria's boosted weight makes apps/web/src heaviest.
    assert.ok((nodes[0]?.weight ?? 0) > (nodes[1]?.weight ?? 0));
  });
});

describe("detectOverlaps", () => {
  it("emits advisory overlaps only when ≥2 members share a directory", () => {
    const overlaps = detectOverlaps([
      { memberId: "human_ajay", directories: ["apps/web/src/components"] },
      { memberId: "agent_aria", directories: ["apps/web/src/components"] },
      { memberId: "agent_bolt", directories: ["apps/server/src/team"] },
    ]);
    assert.equal(overlaps.length, 1);
    assert.equal(overlaps[0]?.path, "apps/web/src/components");
    assert.deepEqual(overlaps[0]?.memberIds, ["agent_aria", "human_ajay"]);
    assert.ok(overlaps[0]?.note.includes("apps/web/src/components"));
  });

  it("returns empty when nobody overlaps", () => {
    assert.deepEqual(
      detectOverlaps([
        { memberId: "a", directories: ["apps/web"] },
        { memberId: "b", directories: ["apps/server"] },
      ]),
      [],
    );
  });
});
