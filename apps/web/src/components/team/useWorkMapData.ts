import { EnvironmentId, ProjectId } from "@t3tools/contracts";
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

export type WorkMapScopeOverride = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly workspaceRoot: string;
};

/**
 * @param scopeOverride — when set (e.g. the active chat thread's project),
 *   read that project instead of the Team-space project selector. Used by
 *   FR-14.3 thread radar so the banner matches the open thread.
 */
export function useWorkMapData(scopeOverride?: WorkMapScopeOverride | null): WorkMapData {
  const teamScope = useTeamScope();
  const environmentId = scopeOverride?.environmentId ?? teamScope.environmentId;
  const projectId = scopeOverride?.projectId ?? teamScope.project?.id ?? null;
  const workspaceRoot = scopeOverride?.workspaceRoot ?? teamScope.project?.workspaceRoot ?? null;

  const envId = environmentId === null ? null : EnvironmentId.make(environmentId);
  const projId = projectId === null ? null : ProjectId.make(projectId);

  const rosterAtom =
    envId === null || workspaceRoot === null
      ? null
      : teamEnvironment.roster({ environmentId: envId, input: { cwd: workspaceRoot } });
  const roster = useEnvironmentQuery(rosterAtom);

  const workMapAtom =
    envId === null || projId === null
      ? null
      : teamEnvironment.workMap({
          environmentId: envId,
          input: { projectId: projId },
        });
  const workMap = useEnvironmentQuery(workMapAtom);

  const localStateAtom =
    envId === null || projId === null
      ? null
      : teamEnvironment.localState({ environmentId: envId, input: { projectId: projId } });
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
    if (projectId === null || workspaceRoot === null) return { status: "no-project", ...base };
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
        memberIds: node.memberIds.map(String),
      })),
      overlaps: workMap.data.overlaps.map((overlap) => ({
        path: overlap.path,
        memberIds: overlap.memberIds.map(String),
        note: overlap.note,
      })),
      memberById: buildMemberSummaryMap(roster.data, localState.data?.project?.members ?? []),
      sharingEnabled: workMap.data.sharingEnabled,
    };
  }, [environmentId, localState.data, projectId, roster.data, workMap.data, workspaceRoot]);
}
