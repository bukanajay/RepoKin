import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberProfileScreen } from "../components/team/TeamMemberProfileScreen";

export const Route = createFileRoute("/team/people/$memberId")({
  component: TeamMemberProfileRoute,
});

function TeamMemberProfileRoute() {
  const { memberId } = Route.useParams();
  return <TeamMemberProfileScreen memberId={memberId} />;
}
