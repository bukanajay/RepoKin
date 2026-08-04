import { createFileRoute } from "@tanstack/react-router";

import { TeamChannelsScreen } from "../components/team/TeamChannelsScreen";

export const Route = createFileRoute("/team/channels/")({
  component: TeamChannelsScreen,
});
