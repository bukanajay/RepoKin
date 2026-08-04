import { createFileRoute } from "@tanstack/react-router";

import { TeamHomeScreen } from "../components/team/TeamHomeScreen";

export const Route = createFileRoute("/team/")({
  component: TeamHomeScreen,
});
