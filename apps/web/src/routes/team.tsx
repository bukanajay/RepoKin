import { createFileRoute, redirect } from "@tanstack/react-router";

import { TeamSpaceLayout } from "../components/team/TeamSpaceLayout";

export const Route = createFileRoute("/team")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: TeamSpaceLayout,
});
