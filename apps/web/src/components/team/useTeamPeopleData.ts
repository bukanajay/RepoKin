import type {
  AgentProfile,
  HumanProfile,
  MemberId,
  MemberPresenceState,
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

/** The People (roster) data seam — live from R1, no fixture era. */

export type TeamPersonRow = {
  memberId: string;
  displayName: string;
  memberType: "human" | "agent";
  profile: HumanProfile | AgentProfile;
  presence: MemberPresenceState | null;
  /** Owner display name for agents. */
  ownerName: string | null;
  remoteEnvironmentLabel: string | null;
};

export type TeamPeopleData = {
  status: "no-environment" | "no-project" | "loading" | "ready";
  humans: TeamPersonRow[];
  agents: TeamPersonRow[];
  /** Roster files that failed to decode; surfaced, never fatal. */
  warnings: readonly string[];
};

export function useTeamPeopleData(): TeamPeopleData {
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

  return useMemo<TeamPeopleData>(() => {
    if (environmentId === null)
      return { status: "no-environment", humans: [], agents: [], warnings: [] };
    if (project === null) return { status: "no-project", humans: [], agents: [], warnings: [] };
    if (roster.data == null) return { status: "loading", humans: [], agents: [], warnings: [] };

    const remotePresenceByMemberId = new Map<string, MemberPresenceState | null>();
    for (const entry of localState.data?.presences ?? []) {
      remotePresenceByMemberId.set(entry.memberId, entry.state);
    }

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

    const humanNameById = new Map(
      roster.data.humans.map((human) => [human.id as string, human.displayName] as const),
    );
    const environmentLabelByEnvironmentId = new Map<string, string>();
    for (const human of roster.data.humans) {
      for (const linkedEnvironment of human.environments ?? []) {
        if (linkedEnvironment.label !== undefined) {
          environmentLabelByEnvironmentId.set(
            linkedEnvironment.environmentId,
            linkedEnvironment.label,
          );
        }
      }
    }

    const humans: TeamPersonRow[] = roster.data.humans.map((profile) => {
      const isLocal = (profile.environments ?? []).some(
        (linkedEnvironment) => linkedEnvironment.environmentId === environmentId,
      );
      return {
        memberId: profile.id,
        displayName: profile.displayName,
        memberType: "human",
        profile,
        presence: isLocal ? "online" : (remotePresenceByMemberId.get(profile.id) ?? null),
        ownerName: null,
        remoteEnvironmentLabel: isLocal
          ? null
          : ((profile.environments ?? [])
              .map((linkedEnvironment) => linkedEnvironment.label)
              .find((label) => label !== undefined) ?? null),
      };
    });

    const agents: TeamPersonRow[] = roster.data.agents.map((profile) => {
      const isRemote =
        profile.homeEnvironment !== undefined && profile.homeEnvironment !== environmentId;
      return {
        memberId: profile.id,
        displayName: profile.name,
        memberType: "agent",
        profile,
        presence:
          threadPresenceByAgentId.get(profile.id)?.state ??
          remotePresenceByMemberId.get(profile.id) ??
          null,
        ownerName: humanNameById.get(profile.owner) ?? profile.owner,
        remoteEnvironmentLabel: isRemote
          ? (environmentLabelByEnvironmentId.get(profile.homeEnvironment!) ??
            profile.homeEnvironment!)
          : null,
      };
    });

    return { status: "ready", humans, agents, warnings: roster.data.warnings };
  }, [environmentId, localState.data?.presences, project, roster.data, threadShells]);
}
