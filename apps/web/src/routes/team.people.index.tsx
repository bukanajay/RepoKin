import { createFileRoute } from "@tanstack/react-router";

import { TeamPeopleScreen } from "../components/team/TeamPeopleScreen";

export const Route = createFileRoute("/team/people/")({
  component: TeamPeopleScreen,
});
