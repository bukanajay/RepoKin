import { createFileRoute } from "@tanstack/react-router";

import { TeamChannelScreen } from "../components/team/TeamChannelScreen";

export const Route = createFileRoute("/team/channels/$channelId")({
  component: TeamChannelRoute,
});

function TeamChannelRoute() {
  const { channelId } = Route.useParams();
  return <TeamChannelScreen channelId={channelId} />;
}
