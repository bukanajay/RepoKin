import { createFileRoute } from "@tanstack/react-router";

import { TeamBoardScreen } from "../components/team/TeamBoardScreen";

export const Route = createFileRoute("/team/board")({
  component: TeamBoardScreen,
});
