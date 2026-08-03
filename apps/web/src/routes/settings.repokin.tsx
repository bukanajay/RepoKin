import { createFileRoute } from "@tanstack/react-router";

import { RepoKinSettingsPanel } from "../components/settings/RepoKinSettings";

export const Route = createFileRoute("/settings/repokin")({
  component: RepoKinSettingsPanel,
});
