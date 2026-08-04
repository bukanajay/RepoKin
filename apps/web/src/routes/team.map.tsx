import { createFileRoute } from "@tanstack/react-router";

import { TeamWorkMapScreen } from "../components/team/TeamWorkMapScreen";

export const Route = createFileRoute("/team/map")({
  component: TeamWorkMapScreen,
});
