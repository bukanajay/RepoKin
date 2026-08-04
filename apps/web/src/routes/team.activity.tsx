import { createFileRoute } from "@tanstack/react-router";

import { TeamActivityScreen } from "../components/team/TeamActivityScreen";

export const Route = createFileRoute("/team/activity")({
  component: TeamActivityScreen,
});
