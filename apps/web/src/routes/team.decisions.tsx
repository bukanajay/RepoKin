import { createFileRoute } from "@tanstack/react-router";

import { TeamDecisionsScreen } from "../components/team/TeamDecisionsScreen";

export const Route = createFileRoute("/team/decisions")({
  component: TeamDecisionsScreen,
});
