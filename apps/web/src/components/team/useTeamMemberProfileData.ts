import {
  AgentId,
  type AgentProfile,
  type HumanProfile,
  type MemberId,
  type MemberPresenceState,
  type TeamInstructionPreviewResult,
} from "@t3tools/contracts/team";
import { ProviderDriverKind } from "@t3tools/contracts";
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

/** Member profile data seam — live from R1. */

export type MemberProfileThreadRef = {
  threadId: string;
  environmentId: string;
  title: string;
  updatedAt: string;
};

export type TeamMemberProfileData = {
  status: "no-environment" | "no-project" | "loading" | "not-found" | "ready";
  profile: HumanProfile | AgentProfile | null;
  presence: MemberPresenceState | null;
  /** Live status headline while a thread runs (agents only). */
  statusHeadline: string | null;
  /** Owner display name (agents only). */
  ownerName: string | null;
  /** Compiled instruction preview for the agent's preferred driver. */
  instructionPreview: TeamInstructionPreviewResult | null;
  recentThreads: MemberProfileThreadRef[];
};

const RECENT_THREAD_LIMIT = 5;
const DEFAULT_PREVIEW_DRIVER = "codex";

export function useTeamMemberProfileData(memberId: string): TeamMemberProfileData {
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

  const agentProfile = roster.data?.agents.find((candidate) => candidate.id === memberId) ?? null;
  const previewAtom =
    environmentId === null || project === null || agentProfile === null
      ? null
      : teamEnvironment.instructionPreview({
          environmentId,
          input: {
            cwd: project.workspaceRoot,
            agentId: AgentId.make(agentProfile.id),
            driver: ProviderDriverKind.make(
              agentProfile.character.provider?.driver ?? DEFAULT_PREVIEW_DRIVER,
            ),
          },
        });
  const preview = useEnvironmentQuery(previewAtom);

  return useMemo<TeamMemberProfileData>(() => {
    const empty: Omit<TeamMemberProfileData, "status"> = {
      profile: null,
      presence: null,
      statusHeadline: null,
      ownerName: null,
      instructionPreview: null,
      recentThreads: [],
    };
    if (environmentId === null) return { status: "no-environment", ...empty };
    if (project === null) return { status: "no-project", ...empty };
    if (roster.data == null) return { status: "loading", ...empty };

    const profile =
      roster.data.humans.find((candidate) => candidate.id === memberId) ??
      roster.data.agents.find((candidate) => candidate.id === memberId) ??
      null;
    if (profile === null) return { status: "not-found", ...empty };

    const remotePresence =
      localState.data?.presences.find((entry) => entry.memberId === memberId)?.state ?? null;

    let threadPresence: TeamMemberPresence | null = null;
    const recentThreads: MemberProfileThreadRef[] = [];
    if (profile.type === "agent") {
      for (const thread of threadShells) {
        if (
          thread.environmentId !== environmentId ||
          thread.projectId !== project.id ||
          thread.repokinAgentId !== memberId
        ) {
          continue;
        }
        recentThreads.push({
          threadId: thread.id,
          environmentId: thread.environmentId,
          title: thread.title,
          updatedAt: thread.updatedAt,
        });
        const awareness = projectThreadAwareness({ environmentId, project, thread });
        if (awareness === null) continue;
        const presence = projectAgentThreadPresence({
          memberId: memberId as unknown as MemberId,
          awareness,
          nowMs: Date.now(),
        });
        if (
          threadPresence === null ||
          threadPresence.updatedAt.localeCompare(presence.updatedAt) < 0
        ) {
          threadPresence = presence;
        }
      }
      recentThreads.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      recentThreads.splice(RECENT_THREAD_LIMIT);
    }

    let ownerName: string | null = null;
    if (profile.type === "agent") {
      ownerName =
        roster.data.humans.find((human) => human.id === profile.owner)?.displayName ??
        profile.owner;
    }

    const isLocalHuman =
      profile.type === "human" &&
      (profile.environments ?? []).some(
        (linkedEnvironment) => linkedEnvironment.environmentId === environmentId,
      );

    return {
      status: "ready",
      profile,
      presence: threadPresence?.state ?? (isLocalHuman ? "online" : remotePresence),
      statusHeadline:
        threadPresence !== null && threadPresence.state !== "offline"
          ? (threadPresence.headline ?? null)
          : null,
      ownerName,
      instructionPreview: preview.data ?? null,
      recentThreads,
    };
  }, [
    environmentId,
    localState.data?.presences,
    memberId,
    preview.data,
    project,
    roster.data,
    threadShells,
  ]);
}
