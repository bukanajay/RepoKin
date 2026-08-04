import type {
  AgentProfile,
  HumanProfile,
  MemberId,
  MemberPresenceState,
  TeamActivity,
  TeamInboxMessage,
  TeamRequestReadModel,
} from "@t3tools/contracts/team";
import {
  projectAgentThreadPresence,
  projectThreadAwareness,
  type TeamMemberPresence,
} from "@t3tools/shared/agentAwareness";
import { useMemo } from "react";

import { teamEnvironment } from "../../state/team";
import { useEnvironmentQuery } from "../../state/query";
import { useThreadShells } from "../../state/entities";
import { useTeamScope } from "./teamScope";

/**
 * The Team Home data seam (implementation plan §0.1): the screen consumes
 * exactly this hook, and this hook only reads live data — Home has no
 * fixture era.
 */

export type TeamHomeAgent = {
  profile: AgentProfile;
  presence: MemberPresenceState | null;
  /** Live activity headline while a thread runs ("Working — 2m", …). */
  statusHeadline: string | null;
  statusDetail: string | null;
  /** Thread behind the live status, for deep links. */
  activeThreadId: string | null;
  /** Home environment label when the agent normally runs elsewhere. */
  remoteEnvironmentLabel: string | null;
};

export type TeamHomeTeammate = {
  profile: HumanProfile;
  presence: MemberPresenceState | null;
  /** Label of the remote environment the teammate is present from. */
  remoteEnvironmentLabel: string | null;
};

export type TeamHomeWaitingItem =
  | { kind: "request"; request: TeamRequestReadModel }
  | { kind: "message"; message: TeamInboxMessage };

export type TeamHomeMemberSummary = {
  memberId: string;
  displayName: string;
  memberType: "human" | "agent";
  avatar: AgentProfile["avatar"];
};

export type TeamHomeData = {
  status: "no-environment" | "no-project" | "loading" | "ready";
  agents: TeamHomeAgent[];
  teammates: TeamHomeTeammate[];
  waitingOnMe: TeamHomeWaitingItem[];
  recentActivity: TeamActivity[];
  /** Lookup for rendering chips in activity and waiting items. */
  memberSummaryById: Map<string, TeamHomeMemberSummary>;
  /** True when the roster has no members at all → onboarding empty state. */
  isEmpty: boolean;
};

const RECENT_ACTIVITY_LIMIT = 8;

export function useTeamHomeData(): TeamHomeData {
  const { environmentId, project } = useTeamScope();
  const threadShells = useThreadShells();

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

  return useMemo<TeamHomeData>(() => {
    if (environmentId === null) {
      return emptyData("no-environment");
    }
    if (project === null) {
      return emptyData("no-project");
    }
    if (roster.data == null) {
      return emptyData("loading");
    }

    const humans = roster.data.humans;
    const agents = roster.data.agents;

    const environmentLabelByEnvironmentId = new Map<string, string>();
    for (const human of humans) {
      for (const linkedEnvironment of human.environments ?? []) {
        if (linkedEnvironment.label !== undefined) {
          environmentLabelByEnvironmentId.set(
            linkedEnvironment.environmentId,
            linkedEnvironment.label,
          );
        }
      }
    }

    // Live agent status from local running threads; freshest thread wins.
    const threadPresenceByAgentId = new Map<string, TeamMemberPresence>();
    for (const thread of threadShells) {
      if (
        thread.environmentId !== environmentId ||
        thread.projectId !== project.id ||
        thread.repokinAgentId === null ||
        thread.repokinAgentId === undefined
      ) {
        continue;
      }
      const awareness = projectThreadAwareness({ environmentId, project, thread });
      if (awareness === null) continue;
      const presence = projectAgentThreadPresence({
        memberId: thread.repokinAgentId as unknown as MemberId,
        awareness,
        nowMs: Date.now(),
      });
      const existing = threadPresenceByAgentId.get(thread.repokinAgentId);
      if (existing === undefined || existing.updatedAt.localeCompare(presence.updatedAt) < 0) {
        threadPresenceByAgentId.set(thread.repokinAgentId, presence);
      }
    }

    // Relay-resolved presence (remote members) from the local team domain.
    const remotePresenceByMemberId = new Map<string, MemberPresenceState | null>();
    for (const entry of localState.data?.presences ?? []) {
      remotePresenceByMemberId.set(entry.memberId, entry.state);
    }

    const homeAgents: TeamHomeAgent[] = agents.map((profile) => {
      const threadPresence = threadPresenceByAgentId.get(profile.id) ?? null;
      const presence = threadPresence?.state ?? remotePresenceByMemberId.get(profile.id) ?? null;
      const isRemote =
        profile.homeEnvironment !== undefined && profile.homeEnvironment !== environmentId;
      return {
        profile,
        presence,
        statusHeadline: threadPresence?.headline ?? null,
        statusDetail: threadPresence?.detail ?? null,
        activeThreadId: threadPresence?.threadId ?? null,
        remoteEnvironmentLabel: isRemote
          ? (environmentLabelByEnvironmentId.get(profile.homeEnvironment!) ??
            profile.homeEnvironment!)
          : null,
      };
    });

    const teammates: TeamHomeTeammate[] = humans.map((profile) => {
      const isLocal = (profile.environments ?? []).some(
        (linkedEnvironment) => linkedEnvironment.environmentId === environmentId,
      );
      const remoteLabel = isLocal
        ? null
        : ((profile.environments ?? [])
            .map((linkedEnvironment) => linkedEnvironment.label)
            .find((label) => label !== undefined) ?? null);
      return {
        profile,
        presence: isLocal ? "online" : (remotePresenceByMemberId.get(profile.id) ?? null),
        remoteEnvironmentLabel: remoteLabel,
      };
    });

    const localHumanIds = new Set(
      humans
        .filter((human) =>
          // With no environment keys published, a solo roster treats every
          // human as local rather than hiding everything behind identity.
          (human.environments ?? []).length === 0
            ? humans.length === 1
            : (human.environments ?? []).some(
                (linkedEnvironment) => linkedEnvironment.environmentId === environmentId,
              ),
        )
        .map((human) => human.id as string),
    );

    const waitingOnMe: TeamHomeWaitingItem[] = [];
    for (const request of localState.data?.project?.requests ?? []) {
      if (request.state === "open" && localHumanIds.has(request.toMemberId)) {
        waitingOnMe.push({ kind: "request", request });
      }
    }
    for (const message of localState.data?.project?.inbox ?? []) {
      const unread = message.state === "queued" || message.state === "delivered";
      if (unread && localHumanIds.has(message.recipientId)) {
        waitingOnMe.push({ kind: "message", message });
      }
    }

    const recentActivity = [...(localState.data?.project?.activities ?? [])]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, RECENT_ACTIVITY_LIMIT);

    const memberSummaryById = new Map<string, TeamHomeMemberSummary>();
    for (const human of humans) {
      memberSummaryById.set(human.id, {
        memberId: human.id,
        displayName: human.displayName,
        memberType: "human",
        avatar: human.avatar,
      });
    }
    for (const agent of agents) {
      memberSummaryById.set(agent.id, {
        memberId: agent.id,
        displayName: agent.name,
        memberType: "agent",
        avatar: agent.avatar,
      });
    }

    return {
      status: "ready",
      agents: homeAgents,
      teammates,
      waitingOnMe,
      recentActivity,
      memberSummaryById,
      isEmpty: homeAgents.length === 0 && teammates.length === 0,
    };
  }, [environmentId, localState.data, project, roster.data, threadShells]);
}

function emptyData(status: TeamHomeData["status"]): TeamHomeData {
  return {
    status,
    agents: [],
    teammates: [],
    waitingOnMe: [],
    recentActivity: [],
    memberSummaryById: new Map(),
    isEmpty: false,
  };
}
