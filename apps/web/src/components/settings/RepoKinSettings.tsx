import { useAtomValue } from "@effect/atom-react";
import { type ProviderInstanceConfig, type ProviderInstanceId } from "@t3tools/contracts";
import { type TeamFile } from "@t3tools/contracts/team";
import {
  CableIcon,
  CloudUploadIcon,
  RefreshCwIcon,
  SaveIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  providerConfigWithAgentBinding,
  providerInstanceHasAgentBinding,
} from "../../repokinBindings";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { cn, randomUUID } from "../../lib/utils";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerConfigAtom, primaryServerProvidersAtom } from "../../state/server";
import { teamEnvironment } from "../../state/team";
import { useAtomCommand } from "../../state/use-atom-command";
import { useProjects } from "../../state/entities";
import { useGitStackedAction } from "../../state/sourceControlActions";
import { vcsEnvironment } from "../../state/vcs";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow } from "./settingsLayout";

const NO_BOUND_PROVIDER_VALUE = "__repokin_no_bound_provider__";

function normalizeInput(value: string): string {
  return value.trim();
}

/**
 * RepoKin Settings — environment-local configuration ONLY (R1.4). Agent
 * authoring, messaging, delegation, and instruction/trust review live in the
 * Team space. What remains here is machine-local and never belongs on a member
 * card: the team git remote, per-agent provider-instance bindings, the trust
 * store, and the publish action.
 */
export function RepoKinSettingsPanel() {
  const environmentId = usePrimaryEnvironmentId();
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const updateTeamFile = useAtomCommand(teamEnvironment.updateTeamFile, "save RepoKin team file");
  const syncTeamRoster = useAtomCommand(teamEnvironment.syncRoster, "sync RepoKin roster");
  const projects = useProjects();

  const projectOptions = useMemo(
    () =>
      environmentId === null
        ? []
        : projects
            .filter((project) => project.environmentId === environmentId)
            .map((project) => ({ value: project.workspaceRoot, label: project.title })),
    [environmentId, projects],
  );
  const defaultCwd = serverConfig?.cwd ?? projectOptions[0]?.value ?? "";
  const [cwd, setCwd] = useState(defaultCwd);
  const [teamRemote, setTeamRemote] = useState("");
  const [teamRemoteStatus, setTeamRemoteStatus] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [publishConfirmationOpen, setPublishConfirmationOpen] = useState(false);
  const [bindingStatus, setBindingStatus] = useState<string | null>(null);

  useEffect(() => {
    if (cwd.length === 0 && defaultCwd.length > 0) {
      setCwd(defaultCwd);
    }
  }, [cwd.length, defaultCwd]);

  const normalizedCwd = normalizeInput(cwd);
  const vcsScope = useMemo(
    () => ({ environmentId, cwd: normalizedCwd.length === 0 ? null : normalizedCwd }),
    [environmentId, normalizedCwd],
  );
  const vcsStatus = useEnvironmentQuery(
    environmentId === null || normalizedCwd.length === 0
      ? null
      : vcsEnvironment.status({ environmentId, input: { cwd: normalizedCwd } }),
  );
  const publishTeamChanges = useGitStackedAction(vcsScope);
  const selectedProject = useMemo(
    () =>
      environmentId === null
        ? null
        : (projects.find(
            (project) =>
              project.environmentId === environmentId && project.workspaceRoot === normalizedCwd,
          ) ?? null),
    [environmentId, normalizedCwd, projects],
  );
  const rosterAtom =
    environmentId === null || normalizedCwd.length === 0
      ? null
      : teamEnvironment.roster({ environmentId, input: { cwd: normalizedCwd } });
  const roster = useEnvironmentQuery(rosterAtom);
  const agentOptions = roster.data?.agents ?? [];

  const providerEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
      ),
    [serverProviders, settings],
  );

  const boundProviderByAgentId = useMemo(() => {
    const byAgentId = new Map<string, string>();
    for (const agent of agentOptions) {
      const entry = providerEntries.find((candidate) =>
        providerInstanceHasAgentBinding(settings.providerInstances, candidate.instanceId, agent.id),
      );
      if (entry !== undefined) {
        byAgentId.set(agent.id, entry.instanceId);
      }
    }
    return byAgentId;
  }, [agentOptions, providerEntries, settings.providerInstances]);

  const trustedMechanics = settings.repokin.trustedMechanics[normalizedCwd] ?? {};
  const trustedEntries = Object.entries(trustedMechanics);

  useEffect(() => {
    setTeamRemote(roster.data?.team?.teamRemote ?? "");
  }, [normalizedCwd, roster.data?.team?.teamRemote]);

  async function handleSaveTeamRemote() {
    if (environmentId === null || normalizedCwd.length === 0) return;
    setTeamRemoteStatus("Saving…");
    const nextTeam: TeamFile = {
      schemaVersion: 1,
      ...(teamRemote.trim().length === 0 ? {} : { teamRemote: teamRemote.trim() }),
      ...(roster.data?.team?.displayName === undefined
        ? {}
        : { displayName: roster.data.team.displayName }),
    };
    const result = await updateTeamFile({
      environmentId,
      input: { cwd: normalizedCwd, team: nextTeam, commit: true },
    });
    if (result._tag === "Success") {
      setTeamRemoteStatus(
        nextTeam.teamRemote === undefined
          ? "Saved without a team remote."
          : `Saved ${nextTeam.teamRemote}.`,
      );
      roster.refresh();
      vcsStatus.refresh();
      return;
    }
    setTeamRemoteStatus("Save failed. Check the repository path and remote value.");
  }

  async function handleSyncRoster() {
    if (environmentId === null || normalizedCwd.length === 0) return;
    setSyncStatus("Syncing…");
    const result = await syncTeamRoster({ environmentId, input: { cwd: normalizedCwd } });
    if (result._tag === "Success") {
      setSyncStatus(
        `Fetched ${result.value.remote}/${result.value.branch}: ${result.value.roster.humans.length} humans, ${result.value.roster.agents.length} agents.`,
      );
      return;
    }
    setSyncStatus("Sync failed. Set an explicit team remote first.");
  }

  async function handlePublishTeamChanges() {
    const aheadCount = vcsStatus.data?.aheadCount ?? 0;
    if (aheadCount === 0 || environmentId === null || normalizedCwd.length === 0) return;
    setPublishConfirmationOpen(false);
    setPublishStatus("Publishing…");
    const result = await publishTeamChanges.run({ actionId: randomUUID(), action: "push" });
    if (result._tag === "Success") {
      setPublishStatus(`Published ${aheadCount} local commit${aheadCount === 1 ? "" : "s"}.`);
      vcsStatus.refresh();
      return;
    }
    setPublishStatus("Publish failed. Check the repository remote and branch permissions.");
  }

  function handleSaveBinding(agentId: string, instanceId: string) {
    const selectedProvider =
      instanceId === NO_BOUND_PROVIDER_VALUE
        ? null
        : (providerEntries.find((entry) => entry.instanceId === instanceId) ?? null);
    if (
      selectedProvider !== null &&
      (!selectedProvider.enabled ||
        !selectedProvider.isAvailable ||
        selectedProvider.status === "error")
    ) {
      setBindingStatus("Choose an enabled, available provider instance.");
      return;
    }

    const nextProviderInstances: Record<ProviderInstanceId, ProviderInstanceConfig> = {
      ...settings.providerInstances,
    };
    for (const [rawInstanceId, instance] of Object.entries(nextProviderInstances)) {
      nextProviderInstances[rawInstanceId as ProviderInstanceId] = {
        ...instance,
        config: providerConfigWithAgentBinding(instance.config, agentId, false),
      };
    }
    if (selectedProvider !== null) {
      const existing = nextProviderInstances[selectedProvider.instanceId];
      nextProviderInstances[selectedProvider.instanceId] = {
        ...(existing ?? { driver: selectedProvider.driverKind, enabled: selectedProvider.enabled }),
        config: providerConfigWithAgentBinding(existing?.config, agentId, true),
      };
    }
    updateSettings({ providerInstances: nextProviderInstances });
    setBindingStatus(
      selectedProvider === null
        ? `Cleared local runtime binding for ${agentId}.`
        : `Bound ${agentId} to ${selectedProvider.displayName}.`,
    );
  }

  function handleRevokeTrust(agentId: string) {
    const perProject = { ...(settings.repokin.trustedMechanics[normalizedCwd] ?? {}) };
    delete perProject[agentId];
    updateSettings({
      repokin: {
        trustedMechanics: { ...settings.repokin.trustedMechanics, [normalizedCwd]: perProject },
        workLocationSharing: settings.repokin.workLocationSharing,
        confirmedDuties: settings.repokin.confirmedDuties,
      },
    });
  }

  function handleRevokeDuty(agentId: string, dutyId: string) {
    const perAgent = { ...(settings.repokin.confirmedDuties[normalizedCwd]?.[agentId] ?? {}) };
    delete perAgent[dutyId];
    updateSettings({
      repokin: {
        trustedMechanics: settings.repokin.trustedMechanics,
        workLocationSharing: settings.repokin.workLocationSharing,
        confirmedDuties: {
          ...settings.repokin.confirmedDuties,
          [normalizedCwd]: {
            ...(settings.repokin.confirmedDuties[normalizedCwd] ?? {}),
            [agentId]: perAgent,
          },
        },
      },
    });
  }

  const workLocationSharing = settings.repokin.workLocationSharing !== false;

  function handleWorkLocationSharingChange(enabled: boolean) {
    updateSettings({
      repokin: {
        trustedMechanics: settings.repokin.trustedMechanics,
        workLocationSharing: enabled,
        confirmedDuties: settings.repokin.confirmedDuties,
      },
    });
  }

  const confirmedDutyEntries = useMemo(() => {
    const perWorkspace = settings.repokin.confirmedDuties[normalizedCwd] ?? {};
    const rows: Array<{ agentId: string; dutyId: string; hash: string }> = [];
    for (const [agentId, duties] of Object.entries(perWorkspace)) {
      for (const [dutyId, hash] of Object.entries(duties)) {
        rows.push({ agentId, dutyId, hash });
      }
    }
    return rows.toSorted((left, right) =>
      `${left.agentId}/${left.dutyId}`.localeCompare(`${right.agentId}/${right.dutyId}`),
    );
  }, [normalizedCwd, settings.repokin.confirmedDuties]);

  const unpublishedCommitCount = vcsStatus.data?.aheadCount ?? 0;
  const canPublishTeamChanges =
    unpublishedCommitCount > 0 &&
    vcsStatus.data?.isRepo === true &&
    vcsStatus.data.hasPrimaryRemote &&
    !publishTeamChanges.isPending;

  return (
    <SettingsPageContainer className="max-w-5xl gap-6">
      <section className="space-y-5 px-3 sm:px-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-foreground">RepoKin</h2>
            <p className="text-sm text-muted-foreground">
              Machine-local only: team remote, runtime bindings, trust, and duty confirmations.
              Create agents, channels, and work in the{" "}
              <Link
                to="/team"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                Team space
              </Link>
              .
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" render={<Link to="/team/people" />}>
              <UsersIcon className="size-4" />
              People
            </Button>
            <Button size="sm" render={<Link to="/team" />}>
              Open Team
            </Button>
          </div>
        </div>

        <label className="grid max-w-sm gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Project</span>
          <Select
            value={cwd}
            onValueChange={(value) => {
              if (value !== null) setCwd(value);
            }}
          >
            <SelectTrigger aria-label="RepoKin project workspace">
              <SelectValue>
                {projectOptions.find((project) => project.value === cwd)?.label ?? "Select project"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="start">
              {projectOptions.map((project) => (
                <SelectItem hideIndicator key={project.value} value={project.value}>
                  <span className="block min-w-0 truncate">{project.label}</span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>

        {unpublishedCommitCount > 0 || publishStatus !== null ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {unpublishedCommitCount > 0
                  ? "Team changes ready to publish"
                  : "Team changes published"}
              </div>
              <div className="text-xs text-muted-foreground">
                {publishStatus ??
                  `${unpublishedCommitCount} local commit${unpublishedCommitCount === 1 ? "" : "s"} ahead on ${vcsStatus.data?.refName ?? "the current branch"}.`}
              </div>
            </div>
            {unpublishedCommitCount > 0 ? (
              <Button
                size="sm"
                className="shrink-0"
                disabled={!canPublishTeamChanges}
                onClick={() => {
                  if (vcsStatus.data?.isDefaultRef) {
                    setPublishConfirmationOpen(true);
                    return;
                  }
                  void handlePublishTeamChanges();
                }}
              >
                <CloudUploadIcon className="size-3.5" />
                {publishTeamChanges.isPending ? "Publishing…" : "Publish team changes"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="flex flex-col">
        <SettingsRow
          title="Team remote"
          description="The git remote RepoKin fetches the roster from. Sync reads the fetched ref only; local files are never checked out."
          control={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  environmentId === null ||
                  normalizedCwd.length === 0 ||
                  teamRemoteStatus === "Saving…"
                }
                onClick={handleSaveTeamRemote}
              >
                <SaveIcon className="size-4" />
                Save
              </Button>
              <Button
                size="sm"
                disabled={
                  environmentId === null ||
                  normalizedCwd.length === 0 ||
                  teamRemote.trim().length === 0 ||
                  syncStatus === "Syncing…"
                }
                onClick={handleSyncRoster}
              >
                <RefreshCwIcon
                  className={cn("size-4", syncStatus === "Syncing…" && "animate-spin")}
                />
                Sync
              </Button>
            </div>
          }
          status={syncStatus ?? teamRemoteStatus ?? "No remote sync has run for this project."}
        >
          <div className="mt-4 max-w-md">
            <Input
              nativeInput
              value={teamRemote}
              onChange={(event) => setTeamRemote(event.currentTarget.value)}
              placeholder="upstream or origin"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title="Work-location sharing"
          description="Publish coarse directory activity (never file contents) so teammates can see overlaps on the work map. Off keeps your location private on this environment (FR-14.4)."
          control={
            <Switch
              checked={workLocationSharing}
              onCheckedChange={handleWorkLocationSharingChange}
              aria-label="Share work location with roster"
            />
          }
          status={
            workLocationSharing
              ? "Sharing directory activity with the roster."
              : "Off — not publishing work locations."
          }
        />

        <SettingsRow
          title="Runtime bindings"
          description="Choose which local provider instance runs each agent on this machine. Bindings never leave this environment."
          status={
            bindingStatus ??
            (agentOptions.length === 0
              ? "No agents in this project's roster yet."
              : `${boundProviderByAgentId.size} of ${agentOptions.length} agents bound.`)
          }
        >
          {agentOptions.length > 0 ? (
            <div className="mt-4 divide-y divide-border/60 rounded-lg border border-border/70 bg-card shadow-xs/5">
              {agentOptions.map((agent) => {
                const bound = boundProviderByAgentId.get(agent.id) ?? NO_BOUND_PROVIDER_VALUE;
                return (
                  <div
                    key={agent.id}
                    className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)] sm:items-center sm:px-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                        <CableIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        {agent.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{agent.id}</div>
                    </div>
                    <Select
                      value={bound}
                      onValueChange={(value) => {
                        if (typeof value === "string") handleSaveBinding(agent.id, value);
                      }}
                    >
                      <SelectTrigger aria-label={`Provider instance for ${agent.name}`}>
                        <SelectValue>
                          {bound === NO_BOUND_PROVIDER_VALUE
                            ? "No binding"
                            : (providerEntries.find((entry) => entry.instanceId === bound)
                                ?.displayName ?? bound)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        <SelectItem hideIndicator value={NO_BOUND_PROVIDER_VALUE}>
                          No binding
                        </SelectItem>
                        {providerEntries.map((entry) => {
                          const ready = isProviderInstancePickerReady(entry);
                          const disabled =
                            !entry.enabled || !entry.isAvailable || entry.status === "error";
                          return (
                            <SelectItem
                              hideIndicator
                              key={entry.instanceId}
                              value={entry.instanceId}
                              disabled={disabled}
                            >
                              <span className="grid min-w-0">
                                <span className="truncate">{entry.displayName}</span>
                                <span className="truncate text-muted-foreground text-xs">
                                  {entry.instanceId} · {ready ? "ready" : entry.status}
                                </span>
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectPopup>
                    </Select>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground sm:px-4">
              Create agents in the{" "}
              <Link
                to="/team/people"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                Team space
              </Link>{" "}
              to bind them to a provider here.
            </div>
          )}
        </SettingsRow>

        <SettingsRow
          title="Trusted mechanics"
          description="Env-local store of trusted harness hashes. Confirm or revoke on each agent's profile in Team → People."
          status={
            trustedEntries.length === 0
              ? "No trusted mechanics for this project."
              : `${trustedEntries.length} trusted.`
          }
        >
          {trustedEntries.length > 0 ? (
            <div className="mt-4 divide-y divide-border/60 rounded-lg border border-border/70 bg-card shadow-xs/5">
              {trustedEntries.map(([agentId, hash]) => (
                <div key={agentId} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                  <ShieldCheckIcon className="size-4 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{agentId}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{hash}</div>
                  </div>
                  <Button size="xs" variant="outline" onClick={() => handleRevokeTrust(agentId)}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </SettingsRow>

        <SettingsRow
          title="Confirmed duties"
          description="Env-local store of duty content hashes (FR-16.4). Confirm duties on agent profiles; revoke here or there to inert them on this machine."
          status={
            confirmedDutyEntries.length === 0
              ? "No duties confirmed for this project."
              : `${confirmedDutyEntries.length} confirmation${confirmedDutyEntries.length === 1 ? "" : "s"}.`
          }
        >
          {confirmedDutyEntries.length > 0 ? (
            <div className="mt-4 divide-y divide-border/60 rounded-lg border border-border/70 bg-card shadow-xs/5">
              {confirmedDutyEntries.map((entry) => (
                <div
                  key={`${entry.agentId}:${entry.dutyId}`}
                  className="flex items-center gap-3 px-3 py-3 sm:px-4"
                >
                  <ShieldCheckIcon className="size-4 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {entry.agentId}
                      <span className="font-normal text-muted-foreground"> / </span>
                      <span className="font-mono text-xs">{entry.dutyId}</span>
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {entry.hash}
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => handleRevokeDuty(entry.agentId, entry.dutyId)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </SettingsRow>
      </div>

      <AlertDialog open={publishConfirmationOpen} onOpenChange={setPublishConfirmationOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish to the default branch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will push {unpublishedCommitCount} local commit
              {unpublishedCommitCount === 1 ? "" : "s"} from{" "}
              {vcsStatus.data?.refName ?? "the current branch"}. RepoKin never publishes
              automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button onClick={() => void handlePublishTeamChanges()}>
              <CloudUploadIcon className="size-3.5" />
              Publish
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {selectedProject === null && normalizedCwd.length > 0 ? (
        <p className="px-3 text-xs text-muted-foreground sm:px-4">
          This workspace path is not a known project on this environment.
        </p>
      ) : null}
    </SettingsPageContainer>
  );
}
