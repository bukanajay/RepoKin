import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";

const TEAM_PROJECT_SCOPE_STORAGE_KEY = "repokin:team:project-scope";

type TeamScopeValue = {
  environmentId: EnvironmentId | null;
  /** Projects on the primary environment, the candidates for scoping. */
  projects: ReadonlyArray<EnvironmentProject>;
  /** The scoped project, or null while none exists / none is selected. */
  project: EnvironmentProject | null;
  selectProject: (workspaceRoot: string) => void;
};

const TeamScopeContext = createContext<TeamScopeValue | null>(null);

/**
 * Project scope for the Team space, owned by the team layout route and
 * persisted per client (implementation plan §R1.2). Promoting the project
 * into the URL path is a follow-up once inbox deep links demand it.
 */
export function TeamScopeProvider({ children }: { children: ReactNode }) {
  const environmentId = usePrimaryEnvironmentId();
  const allProjects = useProjects();
  const [storedWorkspaceRoot, setStoredWorkspaceRoot] = useLocalStorage(
    TEAM_PROJECT_SCOPE_STORAGE_KEY,
    "",
    Schema.String,
  );

  const value = useMemo<TeamScopeValue>(() => {
    const projects =
      environmentId === null
        ? []
        : allProjects.filter((project) => project.environmentId === environmentId);
    const project =
      projects.find((candidate) => candidate.workspaceRoot === storedWorkspaceRoot) ??
      projects[0] ??
      null;
    return {
      environmentId,
      projects,
      project,
      selectProject: setStoredWorkspaceRoot,
    };
  }, [allProjects, environmentId, setStoredWorkspaceRoot, storedWorkspaceRoot]);

  return <TeamScopeContext.Provider value={value}>{children}</TeamScopeContext.Provider>;
}

export function useTeamScope(): TeamScopeValue {
  const value = useContext(TeamScopeContext);
  if (value === null) {
    throw new Error("useTeamScope must be used inside the Team space layout");
  }
  return value;
}
