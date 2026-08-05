import { createFileRoute } from "@tanstack/react-router";

import { TeamPulseScreen } from "../components/team/TeamPulseScreen";

export const Route = createFileRoute("/team/pulse")({
  component: TeamPulseScreen,
});
