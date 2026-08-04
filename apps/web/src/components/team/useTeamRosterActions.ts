import { AgentId, HumanId, type AgentProfile, type Character } from "@t3tools/contracts/team";
import { useCallback } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { teamEnvironment } from "../../state/team";
import { useAtomCommand } from "../../state/use-atom-command";
import { useTeamScope } from "./teamScope";

/**
 * Write actions for the roster, homed in the Team space (R1.4 moved agent
 * authoring and trust out of Settings). Profile writes default to local-only;
 * publishing stays an explicit env-local action in Settings.
 */

export type SaveAgentInput = {
  agentId: string;
  name: string;
  ownerId: string;
  character: Character;
};

export type TeamRosterActions = {
  canWrite: boolean;
  saveAgent: (input: SaveAgentInput) => Promise<boolean>;
  /** Persist an env-local trust decision for an agent's compiled mechanics. */
  trustMechanics: (agentId: string, mechanicalHash: string) => void;
  /** True when the given agent's mechanics hash is already trusted here. */
  isTrusted: (agentId: string, mechanicalHash: string) => boolean;
  revokeTrust: (agentId: string) => void;
};

export function useTeamRosterActions(): TeamRosterActions {
  const { environmentId, project } = useTeamScope();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const upsertAgent = useAtomCommand(teamEnvironment.upsertAgent, "save RepoKin agent");

  const canWrite = environmentId !== null && project !== null;
  const cwd = project?.workspaceRoot ?? "";

  const saveAgent = useCallback(
    async (input: SaveAgentInput): Promise<boolean> => {
      if (environmentId === null || project === null) return false;
      const profile: AgentProfile = {
        schemaVersion: 1,
        id: AgentId.make(input.agentId.trim()),
        type: "agent",
        name: input.name.trim(),
        owner: HumanId.make(input.ownerId.trim()),
        character: input.character,
      };
      const result = await upsertAgent({
        environmentId,
        input: { cwd: project.workspaceRoot, profile, commit: false },
      });
      return result._tag === "Success";
    },
    [environmentId, project, upsertAgent],
  );

  const trustMechanics = useCallback(
    (agentId: string, mechanicalHash: string) => {
      updateSettings({
        repokin: {
          trustedMechanics: {
            ...settings.repokin.trustedMechanics,
            [cwd]: {
              ...(settings.repokin.trustedMechanics[cwd] ?? {}),
              [agentId]: mechanicalHash,
            },
          },
        },
      });
    },
    [cwd, settings.repokin.trustedMechanics, updateSettings],
  );

  const isTrusted = useCallback(
    (agentId: string, mechanicalHash: string) =>
      settings.repokin.trustedMechanics[cwd]?.[agentId] === mechanicalHash,
    [cwd, settings.repokin.trustedMechanics],
  );

  const revokeTrust = useCallback(
    (agentId: string) => {
      const perProject = { ...(settings.repokin.trustedMechanics[cwd] ?? {}) };
      delete perProject[agentId];
      updateSettings({
        repokin: {
          trustedMechanics: {
            ...settings.repokin.trustedMechanics,
            [cwd]: perProject,
          },
        },
      });
    },
    [cwd, settings.repokin.trustedMechanics, updateSettings],
  );

  return { canWrite, saveAgent, trustMechanics, isTrusted, revokeTrust };
}
