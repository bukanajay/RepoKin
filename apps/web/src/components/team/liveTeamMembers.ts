import type {
  AgentProfile,
  MemberProfile,
  HumanProfile,
  TeamMemberReadModel,
  TeamRosterReadModel,
} from "@t3tools/contracts/team";

/** Component-facing member summary shared by the live channel/board hooks. */
export type LiveMemberSummary = {
  memberId: string;
  displayName: string;
  memberType: "human" | "agent";
  avatar: AgentProfile["avatar"];
};

function summaryFromProfile(profile: MemberProfile): LiveMemberSummary {
  return profile.type === "agent"
    ? {
        memberId: profile.id,
        displayName: profile.name,
        memberType: "agent",
        avatar: profile.avatar,
      }
    : {
        memberId: profile.id,
        displayName: profile.displayName,
        memberType: "human",
        avatar: profile.avatar,
      };
}

/**
 * Member summaries for chips/avatars. The Git-resident roster is the primary
 * source; domain members (from the team read model, e.g. relay-synced remote
 * members not on local disk) fill any gaps.
 */
export function buildMemberSummaryMap(
  roster: TeamRosterReadModel,
  domainMembers: ReadonlyArray<TeamMemberReadModel> = [],
): Map<string, LiveMemberSummary> {
  const byId = new Map<string, LiveMemberSummary>();
  for (const member of domainMembers) {
    byId.set(member.memberId, summaryFromProfile(member.profile));
  }
  for (const human of roster.humans) {
    byId.set(human.id, {
      memberId: human.id,
      displayName: human.displayName,
      memberType: "human",
      avatar: human.avatar,
    });
  }
  for (const agent of roster.agents) {
    byId.set(agent.id, {
      memberId: agent.id,
      displayName: agent.name,
      memberType: "agent",
      avatar: agent.avatar,
    });
  }
  return byId;
}

/**
 * The human acting from this environment: prefer one whose published keys
 * include the current environment; fall back to the sole human on a solo
 * roster. Null when the actor can't be resolved (compose/move disabled).
 */
export function resolveLocalHumanId(
  humans: ReadonlyArray<HumanProfile>,
  environmentId: string | null,
): string | null {
  if (environmentId !== null) {
    const linked = humans.find((human) =>
      (human.environments ?? []).some((entry) => entry.environmentId === environmentId),
    );
    if (linked !== undefined) return linked.id;
  }
  return humans.length === 1 ? (humans[0]?.id ?? null) : null;
}
