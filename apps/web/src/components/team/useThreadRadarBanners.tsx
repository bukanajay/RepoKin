/**
 * FR-14.3 thread radar: passive dismissible overlap banners for the open
 * thread. Surfaces when the thread's agent (or any member) collides on a path
 * with other activity, or when a published-branch note is present.
 */
import { useMemo, useState } from "react";
import { RadarIcon } from "lucide-react";
import type { ProjectId } from "@t3tools/contracts";

import type { ComposerBannerStackItem } from "../chat/ComposerBannerStack";
import { useWorkMapData } from "./useWorkMapData";

export function useThreadRadarBanners(input: {
  readonly environmentId: string | null;
  readonly projectId: ProjectId | string | null;
  readonly workspaceRoot: string | null;
  /** When set, prefer overlaps that include this agent. */
  readonly repokinAgentId: string | null | undefined;
}): ReadonlyArray<ComposerBannerStackItem> {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const scope =
    input.environmentId !== null && input.projectId !== null && input.workspaceRoot !== null
      ? {
          environmentId: input.environmentId,
          projectId: String(input.projectId),
          workspaceRoot: input.workspaceRoot,
        }
      : null;

  const workMap = useWorkMapData(scope);

  return useMemo(() => {
    if (workMap.status !== "ready" || workMap.overlaps.length === 0) return [];

    const agentId = input.repokinAgentId;
    const ranked = [...workMap.overlaps].sort((left, right) => {
      const leftHit =
        agentId !== null && agentId !== undefined && left.memberIds.includes(agentId) ? 0 : 1;
      const rightHit =
        agentId !== null && agentId !== undefined && right.memberIds.includes(agentId) ? 0 : 1;
      return leftHit - rightHit || left.path.localeCompare(right.path);
    });

    // At most two banners so the stack never crowds the composer (NFR-2 / UI taste).
    return ranked
      .filter((overlap) => !dismissed.has(overlap.path))
      .slice(0, 2)
      .map((overlap) => ({
        id: `team-radar:${overlap.path}`,
        variant: "info" as const,
        icon: <RadarIcon />,
        title: "Work overlap",
        description: overlap.note,
        dismissLabel: "Dismiss overlap notice",
        onDismiss: () => setDismissed((previous) => new Set([...previous, overlap.path])),
      }));
  }, [dismissed, input.repokinAgentId, workMap.overlaps, workMap.status]);
}
