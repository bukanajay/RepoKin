import { useMemo } from "react";

import { teamEnvironment } from "../../state/team";
import { useEnvironmentQuery } from "../../state/query";
import { buildMemberSummaryMap, type LiveMemberSummary } from "./liveTeamMembers";
import { useTeamScope } from "./teamScope";

/**
 * Work-map data seam — LIVE (R3.2 flip). Reads the server-projected treemap +
 * overlap radar from `team.readWorkMap`. Fixture files deleted; Preview badge
 * dropped. Dies-in-R3 tracker row is closed when fixture grep is empty.
 */

export type WorkMapNode = {
  path: string;
  label: string;
  weight: number;
  memberIds: readonly string[];
};

export type WorkMapOverlap = {
  path: string;
  memberIds: readonly string[];
  note: string;
};

export type WorkMapData = {
  status: "no-environment" | "no-project" | "loading" | "ready";
  /** Always false now that the fixture is gone (R3.2). */
  isPreview: false;
  nodes: readonly WorkMapNode[];
  overlaps: readonly WorkMapOverlap[];
  memberById: ReadonlyMap<string, LiveMemberSummary>;
  /** Whether this environment is publishing work-location signals (FR-14.4). */
  sharingEnabled: boolean;
};

export function useWorkMapData(): WorkMapData {
  const { environmentId, project } = useTeamScope();

  const rosterAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.roster({ environmentId, input: { cwd: project.workspaceRoot } });
  const roster = useEnvironmentQuery(rosterAtom);

  const workMapAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.workMap({
          environmentId,
          input: { projectId: project.id },
        });
  const workMap = useEnvironmentQuery(workMapAtom);

  const localStateAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.localState({ environmentId, input: { projectId: project.id } });
  const localState = useEnvironmentQuery(localStateAtom);

  return useMemo<WorkMapData>(() => {
    const base = {
      isPreview: false as const,
      nodes: [] as readonly WorkMapNode[],
      overlaps: [] as readonly WorkMapOverlap[],
      memberById: new Map<string, LiveMemberSummary>(),
      sharingEnabled: true,
    };
    if (environmentId === null) return { status: "no-environment", ...base };
    if (project === null) return { status: "no-project", ...base };
    if (roster.data === null || workMap.data === null) {
      return { status: "loading", ...base };
    }

    return {
      status: "ready",
      isPreview: false,
      nodes: workMap.data.nodes.map((node) => ({
        path: node.path,
        label: node.label,
        weight: node.weight,
        memberIds: node.memberIds as string[],
      })),
      overlaps: workMap.data.overlaps.map((overlap) => ({
        path: overlap.path,
        memberIds: overlap.memberIds as string[],
        note: overlap.note,
      })),
      memberById: buildMemberSummaryMap(roster.data, localState.data?.project?.members ?? []),
      sharingEnabled: workMap.data.sharingEnabled,
    };
  }, [environmentId, localState.data, project, roster.data, workMap.data]);
}
