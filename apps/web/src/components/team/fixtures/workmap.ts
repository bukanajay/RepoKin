/**
 * Work-map fixtures: coarse directory-level activity plus member positions,
 * mirroring the planned R3 work-signal shape (throttled, ephemeral,
 * roster-scoped).
 *
 * Dies in R3 with the `useWorkMapData` flip.
 */

export type FixtureWorkMapNode = {
  path: string;
  label: string;
  /** Relative activity weight; drives the treemap area. */
  weight: number;
  /** Members active in this area right now. */
  memberIds: readonly string[];
};

export type FixtureOverlap = {
  path: string;
  memberIds: readonly string[];
  note: string;
};

export const FIXTURE_WORKMAP_NODES: readonly FixtureWorkMapNode[] = [
  {
    path: "apps/web/src/components/team",
    label: "components/team",
    weight: 34,
    memberIds: ["agent_aria", "human_ajay"],
  },
  { path: "apps/web/src/routes", label: "routes", weight: 12, memberIds: ["agent_aria"] },
  { path: "apps/server/src/team", label: "server/team", weight: 22, memberIds: ["agent_bolt"] },
  {
    path: "packages/contracts/src",
    label: "contracts",
    weight: 9,
    memberIds: ["agent_bolt", "human_sam"],
  },
  {
    path: "apps/web/src/components/settings",
    label: "settings",
    weight: 7,
    memberIds: ["human_ajay"],
  },
  { path: "apps/server/src/persistence", label: "persistence", weight: 6, memberIds: [] },
  { path: "docs/project/repokin", label: "docs", weight: 5, memberIds: ["human_sam"] },
  { path: "apps/mobile/src", label: "mobile", weight: 5, memberIds: [] },
];

export const FIXTURE_OVERLAPS: readonly FixtureOverlap[] = [
  {
    path: "apps/web/src/components/team",
    memberIds: ["agent_aria", "human_ajay"],
    note: "Aria's running thread touches files in your working tree.",
  },
  {
    path: "packages/contracts/src",
    memberIds: ["agent_bolt", "human_sam"],
    note: "Bolt's published branch and Sam's edits overlap in team.ts.",
  },
];
