import { CommandId } from "@t3tools/contracts";
import { ChannelId, MemberId } from "@t3tools/contracts/team";
import { useCallback, useMemo } from "react";

import { randomUUID } from "../../lib/utils";
import { teamEnvironment } from "../../state/team";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import {
  buildMemberSummaryMap,
  resolveLocalHumanId,
  type LiveMemberSummary,
} from "./liveTeamMembers";
import { useTeamScope } from "./teamScope";

/**
 * Channel-list data seam — LIVE (R2.4 flip). Channel declarations come from the
 * team read model; post counts and last-activity are derived from posts.
 * Fixture file deleted; Preview badge dropped.
 */

export type ChannelListItem = {
  channelId: string;
  slug: string;
  name: string;
  description: string;
  memberIds: readonly string[];
  postCount: number;
  lastPostAt: string | null;
};

export type DeclareChannelInput = {
  slug: string;
  name: string;
  description?: string;
};

export type ChannelsData = {
  status: "no-environment" | "no-project" | "loading" | "ready";
  channels: readonly ChannelListItem[];
  memberById: ReadonlyMap<string, LiveMemberSummary>;
  /** Whether the local actor can declare a channel (a local human was resolved). */
  canDeclare: boolean;
  /** Existing slugs, so the composer can flag a collision before dispatching. */
  existingSlugs: readonly string[];
  declareChannel: (input: DeclareChannelInput) => void;
};

export function useChannelsData(): ChannelsData {
  const { environmentId, project } = useTeamScope();
  const dispatchDeclare = useAtomCommand(teamEnvironment.dispatchCommand, "declare team channel");

  const rosterAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.roster({ environmentId, input: { cwd: project.workspaceRoot } });
  const roster = useEnvironmentQuery(rosterAtom);

  const localStateAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.localState({ environmentId, input: { projectId: project.id } });
  const localState = useEnvironmentQuery(localStateAtom);

  const localHumanId =
    roster.data === null ? null : resolveLocalHumanId(roster.data.humans, environmentId);

  const declareChannel = useCallback(
    (input: DeclareChannelInput) => {
      const slug = input.slug.trim();
      const name = input.name.trim();
      if (
        slug.length === 0 ||
        name.length === 0 ||
        environmentId === null ||
        project === null ||
        localHumanId === null
      ) {
        return;
      }
      const description = input.description?.trim();
      void dispatchDeclare({
        environmentId,
        input: {
          type: "team.channel.declare",
          commandId: CommandId.make(`client:team-channel-declare:${randomUUID()}`),
          projectId: project.id,
          declaration: {
            schemaVersion: 1,
            id: ChannelId.make(slug),
            name,
            ...(description !== undefined && description.length > 0 ? { description } : {}),
          },
          metadata: { actorMemberId: MemberId.make(localHumanId) },
        },
      }).then((result) => {
        if (result._tag === "Success") localState.refresh();
      });
    },
    [dispatchDeclare, environmentId, localHumanId, localState, project],
  );

  return useMemo<ChannelsData>(() => {
    const base = {
      channels: [] as readonly ChannelListItem[],
      memberById: new Map<string, LiveMemberSummary>(),
      canDeclare: false,
      existingSlugs: [] as readonly string[],
      declareChannel,
    };
    if (environmentId === null) return { status: "no-environment", ...base };
    if (project === null) return { status: "no-project", ...base };
    if (roster.data === null || localState.data === null) {
      return { status: "loading", ...base };
    }

    const allMemberIds = [
      ...roster.data.humans.map((human) => human.id as string),
      ...roster.data.agents.map((agent) => agent.id as string),
    ];
    // Post counts/last-activity are rolled up server-side so the list never
    // ships posts (channels with no posts are absent → default to zero).
    const statsByChannel = new Map(
      (localState.data.channelStats ?? []).map((stat) => [stat.channelId as string, stat]),
    );

    const channels: ChannelListItem[] = (localState.data.project?.channels ?? []).map(
      (declaration) => {
        const stats = statsByChannel.get(declaration.id);
        return {
          channelId: declaration.id,
          slug: declaration.id,
          name: declaration.name,
          description: declaration.description ?? "",
          memberIds: declaration.members ?? allMemberIds,
          postCount: stats?.postCount ?? 0,
          lastPostAt: stats?.lastPostAt ?? null,
        };
      },
    );
    channels.sort((left, right) => left.name.localeCompare(right.name));

    return {
      status: "ready",
      channels,
      memberById: buildMemberSummaryMap(roster.data, localState.data.project?.members ?? []),
      canDeclare: localHumanId !== null,
      existingSlugs: channels.map((channel) => channel.slug),
      declareChannel,
    };
  }, [declareChannel, environmentId, localHumanId, localState.data, project, roster.data]);
}
