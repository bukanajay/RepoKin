import { createFileRoute } from "@tanstack/react-router";

import { TeamInboxScreen } from "../components/team/TeamInboxScreen";

export const Route = createFileRoute("/team/inbox")({
  component: TeamInboxScreen,
});
