import type { TeamActivity, TeamActivityKind } from "@t3tools/contracts/team";
import { useMemo } from "react";

import { teamEnvironment } from "../../state/team";
import { useEnvironmentQuery } from "../../state/query";
import { useTeamScope } from "./teamScope";
import type { TeamHomeMemberSummary } from "./useTeamHomeData";

/**
 * Activity feed data seam — a projection over events we already store,
 * currently served whole via teamReadLocalState. When volumes demand a
 * cursor, this hook moves to the additive `team.readActivity` query without
 * the screen noticing (implementation plan §R1.5).
 */

export type TeamActivityFilter = "all" | "members" | "threads" | "messages" | "requests";

const FILTER_KINDS: Record<Exclude<TeamActivityFilter, "all">, readonly TeamActivityKind[]> = {
  members: ["member.upserted"],
  threads: ["thread.assigned"],
  messages: ["message.queued", "message.delivered", "message.read", "message.expired"],
  requests: ["request.created", "request.responded"],
};

export type TeamActivityData = {
  status: "no-environment" | "no-project" | "loading" | "ready";
  activities: TeamActivity[];
  memberSummaryById: Map<string, TeamHomeMemberSummary>;
};

export function useTeamActivityData(filter: TeamActivityFilter): TeamActivityData {
  const { environmentId, project } = useTeamScope();

  const rosterAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.roster({
          environmentId,
          input: { cwd: project.workspaceRoot },
        });
  const roster = useEnvironmentQuery(rosterAtom);

  const localStateAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.localState({
          environmentId,
          input: { projectId: project.id },
        });
  const localState = useEnvironmentQuery(localStateAtom);

  return useMemo<TeamActivityData>(() => {
    const empty = { activities: [], memberSummaryById: new Map<string, TeamHomeMemberSummary>() };
    if (environmentId === null) return { status: "no-environment", ...empty };
    if (project === null) return { status: "no-project", ...empty };
    if (localState.data == null) return { status: "loading", ...empty };

    const kinds = filter === "all" ? null : FILTER_KINDS[filter];
    const activities = [...(localState.data.project?.activities ?? [])]
      .filter((activity) => kinds === null || kinds.includes(activity.kind))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

    const memberSummaryById = new Map<string, TeamHomeMemberSummary>();
    for (const human of roster.data?.humans ?? []) {
      memberSummaryById.set(human.id, {
        memberId: human.id,
        displayName: human.displayName,
        memberType: "human",
        avatar: human.avatar,
      });
    }
    for (const agent of roster.data?.agents ?? []) {
      memberSummaryById.set(agent.id, {
        memberId: agent.id,
        displayName: agent.name,
        memberType: "agent",
        avatar: agent.avatar,
      });
    }

    return { status: "ready", activities, memberSummaryById };
  }, [environmentId, filter, localState.data, project, roster.data]);
}
