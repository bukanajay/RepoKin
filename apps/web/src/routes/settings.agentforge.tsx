import { createFileRoute } from "@tanstack/react-router";

import { AgentForgeSettingsPanel } from "../components/settings/AgentForgeSettings";

export const Route = createFileRoute("/settings/agentforge")({
  component: AgentForgeSettingsPanel,
});
