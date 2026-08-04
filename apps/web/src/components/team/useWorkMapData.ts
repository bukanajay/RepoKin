import { useMemo } from "react";

import { FIXTURE_MEMBERS, type FixtureMember } from "./fixtures/members";
import {
  FIXTURE_OVERLAPS,
  FIXTURE_WORKMAP_NODES,
  type FixtureOverlap,
  type FixtureWorkMapNode,
} from "./fixtures/workmap";

/**
 * Work-map data seam. FIXTURE-BACKED (implementation plan §5): flips to live
 * work signals in R3 — the last fixture to die.
 */

export type WorkMapData = {
  isPreview: true;
  nodes: readonly FixtureWorkMapNode[];
  overlaps: readonly FixtureOverlap[];
  memberById: ReadonlyMap<string, FixtureMember>;
};

export function useWorkMapData(): WorkMapData {
  return useMemo(
    () => ({
      isPreview: true,
      nodes: FIXTURE_WORKMAP_NODES,
      overlaps: FIXTURE_OVERLAPS,
      memberById: new Map(FIXTURE_MEMBERS.map((member) => [member.memberId, member])),
    }),
    [],
  );
}
