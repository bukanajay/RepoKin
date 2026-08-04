import { CommandId } from "@t3tools/contracts";
import type {
  TeamInboxMessage,
  TeamRequestReadModel,
  TeamRequestResponse,
} from "@t3tools/contracts/team";
import { useMemo } from "react";

import { randomUUID } from "../../lib/utils";
import { teamEnvironment } from "../../state/team";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { useTeamScope } from "./teamScope";
import type { TeamHomeMemberSummary } from "./useTeamHomeData";

/**
 * Notification inbox data seam (implementation plan §R1.6): unifies direct
 * messages and structured requests, each actionable in place. Read state
 * rides the existing team command path.
 */

export type TeamInboxItem =
  | { kind: "message"; sortAt: string; message: TeamInboxMessage }
  | { kind: "request"; sortAt: string; request: TeamRequestReadModel };

export type TeamInboxData = {
  status: "no-environment" | "no-project" | "loading" | "ready";
  /** Open/unread items first, then the settled history. */
  openItems: TeamInboxItem[];
  settledItems: TeamInboxItem[];
  memberSummaryById: Map<string, TeamHomeMemberSummary>;
  markMessageRead: (message: TeamInboxMessage) => Promise<boolean>;
  respondToRequest: (
    request: TeamRequestReadModel,
    response: TeamRequestResponse,
  ) => Promise<boolean>;
};

export function useTeamInboxData(): TeamInboxData {
  const { environmentId, project } = useTeamScope();
  const dispatchTeamCommand = useAtomCommand(
    teamEnvironment.dispatchCommand,
    "dispatch team inbox command",
  );

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

  return useMemo<TeamInboxData>(() => {
    const markMessageRead = async (message: TeamInboxMessage): Promise<boolean> => {
      if (environmentId === null || project === null) return false;
      const result = await dispatchTeamCommand({
        environmentId,
        input: {
          type: "team.message.markRead",
          commandId: CommandId.make(`client:team-inbox-read:${randomUUID()}`),
          projectId: project.id,
          messageId: message.messageId,
          readerId: message.recipientId,
          metadata: { actorMemberId: message.recipientId },
        },
      });
      if (result._tag === "Success") {
        localState.refresh();
        return true;
      }
      return false;
    };

    const respondToRequest = async (
      request: TeamRequestReadModel,
      response: TeamRequestResponse,
    ): Promise<boolean> => {
      if (environmentId === null || project === null) return false;
      const result = await dispatchTeamCommand({
        environmentId,
        input: {
          type: "team.request.respond",
          commandId: CommandId.make(`client:team-request-respond:${randomUUID()}`),
          projectId: project.id,
          requestId: request.requestId,
          responderId: request.toMemberId,
          response,
          metadata: { actorMemberId: request.toMemberId },
        },
      });
      if (result._tag === "Success") {
        localState.refresh();
        return true;
      }
      return false;
    };

    const empty = {
      openItems: [],
      settledItems: [],
      memberSummaryById: new Map<string, TeamHomeMemberSummary>(),
      markMessageRead,
      respondToRequest,
    };
    if (environmentId === null) return { status: "no-environment", ...empty };
    if (project === null) return { status: "no-project", ...empty };
    if (localState.data == null) return { status: "loading", ...empty };

    const openItems: TeamInboxItem[] = [];
    const settledItems: TeamInboxItem[] = [];
    for (const message of localState.data.project?.inbox ?? []) {
      const item: TeamInboxItem = { kind: "message", sortAt: message.sentAt, message };
      if (message.state === "queued" || message.state === "delivered") openItems.push(item);
      else settledItems.push(item);
    }
    for (const request of localState.data.project?.requests ?? []) {
      const item: TeamInboxItem = { kind: "request", sortAt: request.createdAt, request };
      if (request.state === "open") openItems.push(item);
      else settledItems.push(item);
    }
    const bySortAtDesc = (left: TeamInboxItem, right: TeamInboxItem) =>
      right.sortAt.localeCompare(left.sortAt);
    openItems.sort(bySortAtDesc);
    settledItems.sort(bySortAtDesc);

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

    return {
      status: "ready",
      openItems,
      settledItems,
      memberSummaryById,
      markMessageRead,
      respondToRequest,
    };
  }, [dispatchTeamCommand, environmentId, localState, project, roster.data]);
}
