import { useAtomRefresh } from "@effect/atom-react";
import { AgentId, HumanId, type AgentProfile, type Character } from "@t3tools/contracts/team";
import { useCallback } from "react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { teamEnvironment } from "../../state/team";
import { useAtomCommand } from "../../state/use-atom-command";
import { useTeamScope } from "./teamScope";

const EMPTY_ROSTER_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("team-roster-actions:empty"),
);

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

  // Refresh the shared roster query after a write so profile/people/home screens
  // re-read the updated character (e.g. a changed provider) without a reload.
  const rosterAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.roster({ environmentId, input: { cwd: project.workspaceRoot } });
  const refreshRoster = useAtomRefresh(rosterAtom ?? EMPTY_ROSTER_ATOM);

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
      if (result._tag === "Success") {
        refreshRoster();
      }
      return result._tag === "Success";
    },
    [environmentId, project, refreshRoster, upsertAgent],
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
