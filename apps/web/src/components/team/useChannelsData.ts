import { useMemo } from "react";

import { teamEnvironment } from "../../state/team";
import { useEnvironmentQuery } from "../../state/query";
import { buildMemberSummaryMap, type LiveMemberSummary } from "./liveTeamMembers";
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

export type ChannelsData = {
  status: "no-environment" | "no-project" | "loading" | "ready";
  channels: readonly ChannelListItem[];
  memberById: ReadonlyMap<string, LiveMemberSummary>;
};

export function useChannelsData(): ChannelsData {
  const { environmentId, project } = useTeamScope();

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

  return useMemo<ChannelsData>(() => {
    if (environmentId === null)
      return { status: "no-environment", channels: [], memberById: new Map() };
    if (project === null) return { status: "no-project", channels: [], memberById: new Map() };
    if (roster.data === null || localState.data === null) {
      return { status: "loading", channels: [], memberById: new Map() };
    }

    const allMemberIds = [
      ...roster.data.humans.map((human) => human.id as string),
      ...roster.data.agents.map((agent) => agent.id as string),
    ];
    const posts = localState.data.project?.posts ?? [];

    const channels: ChannelListItem[] = (localState.data.project?.channels ?? []).map(
      (declaration) => {
        const channelPosts = posts.filter((post) => post.channelId === declaration.id);
        const lastPostAt = channelPosts.reduce<string | null>(
          (latest, post) => (latest === null || post.postedAt > latest ? post.postedAt : latest),
          null,
        );
        return {
          channelId: declaration.id,
          slug: declaration.id,
          name: declaration.name,
          description: declaration.description ?? "",
          memberIds: declaration.members ?? allMemberIds,
          postCount: channelPosts.length,
          lastPostAt,
        };
      },
    );
    channels.sort((left, right) => left.name.localeCompare(right.name));

    return {
      status: "ready",
      channels,
      memberById: buildMemberSummaryMap(roster.data, localState.data.project?.members ?? []),
    };
  }, [environmentId, localState.data, project, roster.data]);
}
