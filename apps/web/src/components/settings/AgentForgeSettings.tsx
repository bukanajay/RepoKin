import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  MessageId,
  ProviderDriverKind,
  ThreadId,
  type ProviderInteractionMode,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  AgentId,
  type AgentProfile,
  type HumanProfile,
  HumanId,
  type TeamFile,
  type MemberId,
  type MemberPresenceState,
  MemberId as MemberIdSchema,
} from "@t3tools/contracts/team";
import { projectAgentThreadPresence, projectThreadAwareness } from "@t3tools/shared/agentAwareness";
import * as Schema from "effect/Schema";
import {
  BotIcon,
  CableIcon,
  CheckIcon,
  GitBranchIcon,
  RefreshCwIcon,
  SaveIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  providerConfigWithAgentBinding,
  providerInstanceHasAgentBinding,
} from "../../agentforgeBindings";
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
import { useProjects, useThreadShells } from "../../state/entities";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const DRIVER_OPTIONS = [
  { value: "codex", label: "Codex" },
  { value: "claudeAgent", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "grok", label: "Grok" },
  { value: "opencode", label: "OpenCode" },
] as const;

const DEFAULT_AGENT_ID = "agent_aria";
const DEFAULT_OWNER_ID = "human_local";
const DEFAULT_AGENT_NAME = "Aria";
const DEFAULT_PERSONA = "Pragmatic implementation agent focused on scoped, verified progress.";
const NO_BOUND_PROVIDER_VALUE = "__agentforge_no_bound_provider__";
const decodeMemberId = Schema.decodeUnknownSync(MemberIdSchema);

const RUNTIME_MODE_OPTIONS: ReadonlyArray<{ readonly value: RuntimeMode; readonly label: string }> =
  [
    { value: "approval-required", label: "Approval required" },
    { value: "auto-accept-edits", label: "Auto-accept edits" },
    { value: "auto", label: "Auto" },
    { value: "full-access", label: "Full access" },
  ];

const INTERACTION_MODE_OPTIONS: ReadonlyArray<{
  readonly value: ProviderInteractionMode;
  readonly label: string;
}> = [
  { value: "default", label: "Default" },
  { value: "plan", label: "Plan" },
];

function normalizeInput(value: string): string {
  return value.trim();
}

function formatListField(values: readonly string[] | undefined): string {
  return values?.join("\n") ?? "";
}

function parseListField(value: string): readonly string[] | undefined {
  const values = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return values.length === 0 ? undefined : values;
}

function presenceLabel(state: MemberPresenceState | null): string {
  switch (state) {
    case "online":
      return "Online";
    case "busy":
      return "Busy";
    case "away":
      return "Away";
    case "offline":
    case null:
      return "Offline";
  }
}

function presenceDotClassName(state: MemberPresenceState | null): string {
  switch (state) {
    case "online":
      return "bg-emerald-500";
    case "busy":
      return "bg-amber-500";
    case "away":
      return "bg-sky-500";
    case "offline":
    case null:
      return "bg-muted-foreground/45";
  }
}

export function AgentForgeSettingsPanel() {
  const environmentId = usePrimaryEnvironmentId();
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const upsertAgent = useAtomCommand(teamEnvironment.upsertAgent, "save AgentForge agent");
  const updateTeamFile = useAtomCommand(
    teamEnvironment.updateTeamFile,
    "save AgentForge team file",
  );
  const syncTeamRoster = useAtomCommand(teamEnvironment.syncRoster, "sync AgentForge roster");
  const dispatchTeamCommand = useAtomCommand(
    teamEnvironment.dispatchCommand,
    "dispatch AgentForge team command",
  );
  const projects = useProjects();
  const threadShells = useThreadShells();
  const projectOptions = useMemo(
    () =>
      environmentId === null
        ? []
        : projects
            .filter((project) => project.environmentId === environmentId)
            .map((project) => ({
              value: project.workspaceRoot,
              label: project.title,
            })),
    [environmentId, projects],
  );
  const defaultCwd = serverConfig?.cwd ?? projectOptions[0]?.value ?? "";
  const [cwd, setCwd] = useState(defaultCwd);
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);
  const [ownerId, setOwnerId] = useState(DEFAULT_OWNER_ID);
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [expertise, setExpertise] = useState("typescript\neffect\nfrontend implementation");
  const [conventions, setConventions] = useState(
    "Keep changes scoped\nVerify with focused tests\nReport complete and pending work honestly",
  );
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("approval-required");
  const [interactionMode, setInteractionMode] = useState<ProviderInteractionMode>("default");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [bindingStatus, setBindingStatus] = useState<string | null>(null);
  const [teamRemote, setTeamRemote] = useState("");
  const [teamRemoteStatus, setTeamRemoteStatus] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [messageStatus, setMessageStatus] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [handoffStatus, setHandoffStatus] = useState<string | null>(null);
  const [boundProviderInstanceId, setBoundProviderInstanceId] =
    useState<string>(NO_BOUND_PROVIDER_VALUE);
  const [driver, setDriver] = useState<(typeof DRIVER_OPTIONS)[number]["value"]>("codex");
  const [submitted, setSubmitted] = useState<{
    readonly cwd: string;
    readonly agentId: string;
    readonly driver: (typeof DRIVER_OPTIONS)[number]["value"];
  } | null>(null);

  useEffect(() => {
    if (cwd.length === 0 && defaultCwd.length > 0) {
      setCwd(defaultCwd);
    }
  }, [cwd.length, defaultCwd]);

  const normalizedCwd = normalizeInput(cwd);
  const normalizedAgentId = normalizeInput(agentId);
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
  const threadOptions = useMemo(
    () =>
      environmentId === null || selectedProject === null
        ? []
        : threadShells
            .filter(
              (thread) =>
                thread.environmentId === environmentId &&
                thread.projectId === selectedProject.id &&
                thread.archivedAt === null,
            )
            .toSorted((left, right) => {
              const leftUpdatedAt = left.latestUserMessageAt ?? left.updatedAt;
              const rightUpdatedAt = right.latestUserMessageAt ?? right.updatedAt;
              return rightUpdatedAt.localeCompare(leftUpdatedAt);
            }),
    [environmentId, selectedProject, threadShells],
  );
  const agentPresenceById = useMemo(() => {
    const byAgentId = new Map<string, ReturnType<typeof projectAgentThreadPresence>>();
    if (environmentId === null || selectedProject === null) {
      return byAgentId;
    }

    for (const thread of threadShells) {
      if (
        thread.environmentId !== environmentId ||
        thread.projectId !== selectedProject.id ||
        thread.agentforgeAgentId === null ||
        thread.agentforgeAgentId === undefined
      ) {
        continue;
      }
      const awareness = projectThreadAwareness({
        environmentId,
        project: selectedProject,
        thread,
      });
      if (awareness === null) {
        continue;
      }
      const presence = projectAgentThreadPresence({
        memberId: thread.agentforgeAgentId as unknown as MemberId,
        awareness,
        nowMs: Date.now(),
      });
      const existing = byAgentId.get(thread.agentforgeAgentId);
      if (existing === undefined || existing.updatedAt.localeCompare(presence.updatedAt) < 0) {
        byAgentId.set(thread.agentforgeAgentId, presence);
      }
    }
    return byAgentId;
  }, [environmentId, selectedProject, threadShells]);
  const rosterAtom =
    environmentId === null || normalizedCwd.length === 0
      ? null
      : teamEnvironment.roster({
          environmentId,
          input: { cwd: normalizedCwd },
        });
  const roster = useEnvironmentQuery(rosterAtom);
  const localStateAtom =
    environmentId === null || selectedProject === null
      ? null
      : teamEnvironment.localState({
          environmentId,
          input: { projectId: selectedProject.id },
        });
  const localState = useEnvironmentQuery(localStateAtom);
  const inboxItems = localState.data?.project?.inbox ?? [];
  const assignmentItems = localState.data?.project?.assignments ?? [];
  const activityItems = localState.data?.project?.activities ?? [];
  const remotePresenceByMemberId = useMemo(() => {
    const byMemberId = new Map<string, MemberPresenceState | null>();
    for (const entry of localState.data?.presences ?? []) {
      byMemberId.set(entry.memberId, entry.state);
    }
    return byMemberId;
  }, [localState.data?.presences]);
  const remoteEnvironmentLabelByEnvironmentId = useMemo(() => {
    const byEnvironmentId = new Map<string, string>();
    for (const human of roster.data?.humans ?? []) {
      for (const linkedEnvironment of human.environments ?? []) {
        if (linkedEnvironment.label !== undefined) {
          byEnvironmentId.set(linkedEnvironment.environmentId, linkedEnvironment.label);
        }
      }
    }
    return byEnvironmentId;
  }, [roster.data?.humans]);
  const agentOptions = roster.data?.agents ?? [];
  const selectedThread = threadOptions.find((thread) => thread.id === selectedThreadId) ?? null;
  const threadTitleById = useMemo(
    () => new Map(threadOptions.map((thread) => [thread.id, thread.title] as const)),
    [threadOptions],
  );
  const providerEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
      ),
    [serverProviders, settings],
  );
  // A roster agent whose home environment is elsewhere but that has a local
  // runtime binding here is being run from this machine right now — the bind
  // action itself is the explicit opt-in (M1.4), so no separate "borrow"
  // setting is needed. No locking: this only makes the situation visible.
  const locallyBoundAgentIds = useMemo(() => {
    const bound = new Set<string>();
    for (const agent of roster.data?.agents ?? []) {
      const hasBinding = providerEntries.some((entry) =>
        providerInstanceHasAgentBinding(settings.providerInstances, entry.instanceId, agent.id),
      );
      if (hasBinding) {
        bound.add(agent.id);
      }
    }
    return bound;
  }, [providerEntries, roster.data?.agents, settings.providerInstances]);
  const currentBoundProviderEntry = useMemo(() => {
    if (normalizedAgentId.length === 0) {
      return null;
    }
    return (
      providerEntries.find((entry) =>
        providerInstanceHasAgentBinding(
          settings.providerInstances,
          entry.instanceId,
          normalizedAgentId,
        ),
      ) ?? null
    );
  }, [normalizedAgentId, providerEntries, settings.providerInstances]);
  const selectedAgent = useMemo(
    () => agentOptions.find((agent) => agent.id === agentId) ?? null,
    [agentId, agentOptions],
  );
  const canPreview =
    environmentId !== null && normalizedCwd.length > 0 && normalizedAgentId.length > 0;
  const previewAtom =
    environmentId === null || submitted === null
      ? null
      : teamEnvironment.instructionPreview({
          environmentId,
          input: {
            cwd: submitted.cwd,
            agentId: AgentId.make(submitted.agentId),
            driver: ProviderDriverKind.make(submitted.driver),
          },
        });
  const preview = useEnvironmentQuery(previewAtom);
  const previewTrustedHash =
    submitted === null
      ? undefined
      : settings.agentforge.trustedMechanics[submitted.cwd]?.[submitted.agentId];
  const previewTrustStatus =
    preview.data == null
      ? null
      : previewTrustedHash === undefined
        ? "Untrusted mechanics"
        : previewTrustedHash === preview.data.mechanicalHash
          ? "Trusted mechanics"
          : "Changed mechanics";

  useEffect(() => {
    if (agentOptions.length === 0) {
      return;
    }
    const hasSelectedAgent = agentOptions.some((agent) => agent.id === agentId);
    if (!hasSelectedAgent && (agentId === DEFAULT_AGENT_ID || agentId.trim().length === 0)) {
      setAgentId(agentOptions[0]?.id ?? DEFAULT_AGENT_ID);
    }
  }, [agentId, agentOptions]);

  useEffect(() => {
    if (selectedAgent === null) {
      return;
    }
    setAgentName(selectedAgent.name);
    setOwnerId(selectedAgent.owner);
    setPersona(selectedAgent.character.persona ?? "");
    setExpertise(formatListField(selectedAgent.character.expertise));
    setConventions(formatListField(selectedAgent.character.conventions));
    setRuntimeMode(selectedAgent.character.runtimeMode ?? "approval-required");
    setInteractionMode(selectedAgent.character.interactionMode ?? "default");
  }, [selectedAgent]);

  useEffect(() => {
    setBoundProviderInstanceId(currentBoundProviderEntry?.instanceId ?? NO_BOUND_PROVIDER_VALUE);
  }, [currentBoundProviderEntry]);

  useEffect(() => {
    setTeamRemote(roster.data?.team?.teamRemote ?? "");
  }, [normalizedCwd, roster.data?.team?.teamRemote]);

  useEffect(() => {
    if (threadOptions.length === 0) {
      if (selectedThreadId.length > 0) {
        setSelectedThreadId("");
      }
      return;
    }
    if (!threadOptions.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(threadOptions[0]?.id ?? "");
    }
  }, [selectedThreadId, threadOptions]);

  const normalizedName = normalizeInput(agentName);
  const normalizedOwnerId = normalizeInput(ownerId);
  const normalizedPersona = normalizeInput(persona);
  const canSaveAgent =
    environmentId !== null &&
    normalizedCwd.length > 0 &&
    normalizedAgentId.length > 0 &&
    normalizedName.length > 0 &&
    normalizedOwnerId.length > 0 &&
    normalizedPersona.length > 0;

  function buildCurrentAgentProfile(): AgentProfile | null {
    if (
      normalizedAgentId.length === 0 ||
      normalizedName.length === 0 ||
      normalizedOwnerId.length === 0 ||
      normalizedPersona.length === 0
    ) {
      return null;
    }

    const expertiseValues = parseListField(expertise);
    const conventionValues = parseListField(conventions);
    return {
      schemaVersion: 1,
      id: AgentId.make(normalizedAgentId),
      type: "agent",
      name: normalizedName,
      owner: HumanId.make(normalizedOwnerId),
      character: {
        characterVersion: 1,
        persona: normalizedPersona,
        ...(expertiseValues === undefined ? {} : { expertise: expertiseValues }),
        ...(conventionValues === undefined ? {} : { conventions: conventionValues }),
        runtimeMode,
        interactionMode,
      },
    };
  }

  async function ensureSelectedTeamMembers(): Promise<boolean> {
    if (environmentId === null || selectedProject === null) {
      return false;
    }
    const agentProfile = buildCurrentAgentProfile();
    if (agentProfile === null) {
      return false;
    }
    const humanProfile: HumanProfile = {
      schemaVersion: 1,
      id: HumanId.make(normalizedOwnerId),
      type: "human",
      displayName: normalizedOwnerId,
      gitEmails: [],
    };

    for (const profile of [humanProfile, agentProfile]) {
      const result = await dispatchTeamCommand({
        environmentId,
        input: {
          type: "team.member.upsert",
          commandId: CommandId.make(`client:team-member:${profile.id}:${randomUUID()}`),
          projectId: selectedProject.id,
          profile,
          metadata: { actorMemberId: decodeMemberId(normalizedOwnerId) },
        },
      });
      if (result._tag !== "Success") {
        return false;
      }
    }
    return true;
  }

  async function handleSaveAgent() {
    if (!canSaveAgent || environmentId === null) {
      return;
    }

    setSaveStatus("Saving...");
    const profile = buildCurrentAgentProfile();
    if (profile === null) {
      setSaveStatus("Save failed. Check the agent id, owner id, and persona.");
      return;
    }

    const result = await upsertAgent({
      environmentId,
      input: {
        cwd: normalizedCwd,
        profile,
        commit: false,
      },
    });

    if (result._tag === "Success") {
      setSaveStatus(`Saved locally to ${result.value.write.path}`);
      setSubmitted(null);
      roster.refresh();
      return;
    }

    setSaveStatus("Save failed. Check the agent id, owner id, and workspace path.");
  }

  async function handleSaveTeamRemote() {
    if (environmentId === null || normalizedCwd.length === 0) {
      return;
    }
    setTeamRemoteStatus("Saving...");
    const nextTeam: TeamFile = {
      schemaVersion: 1,
      ...(teamRemote.trim().length === 0 ? {} : { teamRemote: teamRemote.trim() }),
      ...(roster.data?.team?.displayName === undefined
        ? {}
        : { displayName: roster.data.team.displayName }),
    };
    const result = await updateTeamFile({
      environmentId,
      input: {
        cwd: normalizedCwd,
        team: nextTeam,
        commit: false,
      },
    });
    if (result._tag === "Success") {
      setTeamRemoteStatus(
        nextTeam.teamRemote === undefined
          ? "Saved without a team remote."
          : `Saved ${nextTeam.teamRemote}.`,
      );
      roster.refresh();
      return;
    }
    setTeamRemoteStatus("Save failed. Check the repository path and remote value.");
  }

  async function handleSyncRoster() {
    if (environmentId === null || normalizedCwd.length === 0) {
      return;
    }
    setSyncStatus("Syncing...");
    const result = await syncTeamRoster({
      environmentId,
      input: { cwd: normalizedCwd },
    });
    if (result._tag === "Success") {
      setSyncStatus(
        `Fetched ${result.value.remote}/${result.value.branch}: ${result.value.roster.humans.length} humans, ${result.value.roster.agents.length} agents.`,
      );
      return;
    }
    setSyncStatus("Sync failed. Set an explicit team remote first.");
  }

  async function handleSendMessage() {
    if (
      environmentId === null ||
      selectedProject === null ||
      normalizedAgentId.length === 0 ||
      messageBody.trim().length === 0
    ) {
      return;
    }
    setMessageStatus("Sending...");
    const membersReady = await ensureSelectedTeamMembers();
    if (!membersReady) {
      setMessageStatus("Send failed. Save or complete the selected agent profile first.");
      return;
    }
    const result = await dispatchTeamCommand({
      environmentId,
      input: {
        type: "team.message.send",
        commandId: CommandId.make(`client:team-message:${randomUUID()}`),
        projectId: selectedProject.id,
        messageId: MessageId.make(`message-${randomUUID()}`),
        senderId: decodeMemberId(normalizedOwnerId || DEFAULT_OWNER_ID),
        recipientId: decodeMemberId(normalizedAgentId),
        body: messageBody.trim(),
        metadata: { actorMemberId: decodeMemberId(normalizedOwnerId || DEFAULT_OWNER_ID) },
      },
    });
    if (result._tag === "Success") {
      setMessageBody("");
      setMessageStatus(`Queued at #${result.value.sequence}.`);
      localState.refresh();
      return;
    }
    setMessageStatus("Send failed. Check the selected agent and owner id.");
  }

  async function handleMarkMessageRead(messageId: MessageId) {
    if (environmentId === null || selectedProject === null) {
      return;
    }
    const result = await dispatchTeamCommand({
      environmentId,
      input: {
        type: "team.message.markRead",
        commandId: CommandId.make(`client:team-message-read:${randomUUID()}`),
        projectId: selectedProject.id,
        messageId,
        readerId: decodeMemberId(normalizedAgentId),
        metadata: { actorMemberId: decodeMemberId(normalizedAgentId) },
      },
    });
    if (result._tag === "Success") {
      setMessageStatus(`Marked read at #${result.value.sequence}.`);
      localState.refresh();
      return;
    }
    setMessageStatus("Could not mark the message read.");
  }

  async function handleAssignThread() {
    if (
      environmentId === null ||
      selectedProject === null ||
      selectedThreadId.length === 0 ||
      normalizedAgentId.length === 0
    ) {
      return;
    }

    const assignedById = decodeMemberId(normalizedOwnerId || DEFAULT_OWNER_ID);
    setHandoffStatus("Assigning...");
    const membersReady = await ensureSelectedTeamMembers();
    if (!membersReady) {
      setHandoffStatus("Assign failed. Save or complete the selected agent profile first.");
      return;
    }
    const result = await dispatchTeamCommand({
      environmentId,
      input: {
        type: "team.agent.assign",
        commandId: CommandId.make(`client:team-handoff:${randomUUID()}`),
        projectId: selectedProject.id,
        threadId: ThreadId.make(selectedThreadId),
        assigneeId: decodeMemberId(normalizedAgentId),
        assignedById,
        ...(handoffNote.trim().length === 0 ? {} : { note: handoffNote.trim() }),
        metadata: { actorMemberId: assignedById },
      },
    });
    if (result._tag === "Success") {
      setHandoffNote("");
      setHandoffStatus(`Assigned at #${result.value.sequence}.`);
      localState.refresh();
      return;
    }
    setHandoffStatus("Assign failed. Check that the owner and agent are in the local roster.");
  }

  function handleSaveBinding() {
    if (normalizedAgentId.length === 0) {
      return;
    }
    const selectedProvider =
      boundProviderInstanceId === NO_BOUND_PROVIDER_VALUE
        ? null
        : (providerEntries.find((entry) => entry.instanceId === boundProviderInstanceId) ?? null);
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
        config: providerConfigWithAgentBinding(instance.config, normalizedAgentId, false),
      };
    }

    if (selectedProvider !== null) {
      const existing = nextProviderInstances[selectedProvider.instanceId];
      nextProviderInstances[selectedProvider.instanceId] = {
        ...(existing ?? {
          driver: selectedProvider.driverKind,
          enabled: selectedProvider.enabled,
        }),
        config: providerConfigWithAgentBinding(existing?.config, normalizedAgentId, true),
      };
    }

    updateSettings({ providerInstances: nextProviderInstances });
    setBindingStatus(
      selectedProvider === null
        ? `Cleared local runtime binding for ${normalizedAgentId}.`
        : `Bound ${normalizedAgentId} to ${selectedProvider.displayName}.`,
    );
  }

  function handleTrustPreviewMechanics() {
    if (submitted === null || preview.data == null) {
      return;
    }
    updateSettings({
      agentforge: {
        trustedMechanics: {
          ...settings.agentforge.trustedMechanics,
          [submitted.cwd]: {
            ...(settings.agentforge.trustedMechanics[submitted.cwd] ?? {}),
            [submitted.agentId]: preview.data.mechanicalHash,
          },
        },
      },
    });
  }

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="AgentForge"
        icon={<BotIcon className="size-4 text-muted-foreground" />}
      >
        <SettingsRow
          title="Roster"
          description="Read humans and agents from the selected repository's .agentforge directory."
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={rosterAtom === null || roster.isPending}
              onClick={roster.refresh}
            >
              <RefreshCwIcon className={cn("size-3.5", roster.isPending && "animate-spin")} />
              Refresh
            </Button>
          }
          status={
            roster.data
              ? `${roster.data.agents.length} agents · ${roster.data.humans.length} humans`
              : normalizedCwd.length === 0
                ? "Choose a workspace to read the roster."
                : "No roster loaded yet."
          }
        >
          <div className="mt-4 rounded-xl border border-border/70 bg-card shadow-xs/5">
            {roster.error ? (
              <div className="border-border/60 border-b px-3 py-3 text-sm text-destructive sm:px-4">
                {roster.error}
              </div>
            ) : null}

            {roster.data?.warnings.length ? (
              <div className="border-border/60 border-b px-3 py-3 sm:px-4">
                <div className="text-xs font-medium text-foreground">Roster warnings</div>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {roster.data.warnings.map((warning) => (
                    <li key={warning} className="break-words">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="divide-y divide-border/60">
              {agentOptions.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground sm:px-4">
                  No agent profiles found under `.agentforge/agents`.
                </div>
              ) : (
                agentOptions.map((agent) => {
                  const localPresence = agentPresenceById.get(agent.id);
                  // Local thread activity is authoritative when present; a
                  // roster agent whose home environment is elsewhere has no
                  // local threads to derive presence from, so fall back to
                  // what the relay last reported for that environment (M3.3).
                  const isRemoteHome =
                    localPresence === undefined &&
                    agent.homeEnvironment !== undefined &&
                    agent.homeEnvironment !== environmentId;
                  const presenceState =
                    localPresence?.state ?? remotePresenceByMemberId.get(agent.id) ?? null;
                  const remoteEnvironmentLabel = isRemoteHome
                    ? (remoteEnvironmentLabelByEnvironmentId.get(agent.homeEnvironment ?? "") ??
                      agent.homeEnvironment)
                    : null;
                  const isBorrowedHere =
                    agent.homeEnvironment !== undefined &&
                    agent.homeEnvironment !== environmentId &&
                    locallyBoundAgentIds.has(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/45 sm:px-4",
                        agentId === agent.id && "bg-muted/55",
                      )}
                      onClick={() => setAgentId(agent.id)}
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <BotIcon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {agent.name}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border/70 bg-background px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                            <span
                              className={cn(
                                "size-1.5 rounded-full",
                                presenceDotClassName(presenceState),
                              )}
                            />
                            {presenceLabel(presenceState)}
                            {remoteEnvironmentLabel ? ` (on ${remoteEnvironmentLabel})` : null}
                          </span>
                          {isBorrowedHere ? (
                            <span className="inline-flex shrink-0 items-center rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] leading-none text-amber-600 dark:text-amber-400">
                              Borrowed here
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {agent.id} · {agent.character.runtimeMode ?? "approval-required"}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Runtime binding"
          description="Choose the local provider instance that runs the selected agent on this machine."
          control={
            <Button size="sm" disabled={normalizedAgentId.length === 0} onClick={handleSaveBinding}>
              <CableIcon className="size-3.5" />
              Save binding
            </Button>
          }
          status={
            bindingStatus ??
            (currentBoundProviderEntry
              ? `${normalizedAgentId} runs on ${currentBoundProviderEntry.displayName}.`
              : "No local provider binding saved.")
          }
        >
          <div className="mt-4 grid gap-4 rounded-xl border border-border/70 bg-card px-3 py-3 shadow-xs/5 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] sm:px-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Provider instance</span>
              <Select
                value={boundProviderInstanceId}
                onValueChange={(value) => {
                  if (value !== null) {
                    setBoundProviderInstanceId(value);
                  }
                }}
              >
                <SelectTrigger aria-label="Agent runtime provider instance">
                  <SelectValue>
                    {boundProviderInstanceId === NO_BOUND_PROVIDER_VALUE
                      ? "No binding"
                      : (providerEntries.find(
                          (entry) => entry.instanceId === boundProviderInstanceId,
                        )?.displayName ?? boundProviderInstanceId)}
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
            </label>

            <div className="grid content-start gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Selected agent</span>
              <div className="min-h-9 rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-sm">
                <div className="truncate font-medium text-foreground">
                  {selectedAgent?.name ?? normalizedAgentId}
                </div>
                <div className="truncate text-muted-foreground text-xs">
                  {currentBoundProviderEntry
                    ? `Current: ${currentBoundProviderEntry.instanceId}`
                    : "Current: unbound"}
                </div>
              </div>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Team sync"
          description="Set the explicit team remote and fetch its roster without touching the working tree."
          control={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  environmentId === null ||
                  normalizedCwd.length === 0 ||
                  teamRemoteStatus === "Saving..."
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
                  syncStatus === "Syncing..."
                }
                onClick={handleSyncRoster}
              >
                <RefreshCwIcon
                  className={cn("size-4", syncStatus === "Syncing..." && "animate-spin")}
                />
                Sync
              </Button>
            </div>
          }
          status={syncStatus ?? teamRemoteStatus ?? "No remote sync has run for this project."}
        >
          <div className="mt-4 grid gap-3 rounded-xl border border-border/70 bg-card px-3 py-3 shadow-xs/5 sm:px-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Team remote</span>
              <Input
                nativeInput
                value={teamRemote}
                onChange={(event) => setTeamRemote(event.currentTarget.value)}
                placeholder="upstream or origin"
              />
            </label>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <div>
                Current:{" "}
                <span className="font-medium text-foreground">
                  {roster.data?.team?.teamRemote ?? "unset"}
                </span>
              </div>
              <div>Sync reads the fetched remote ref only; local files are not checked out.</div>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Local inbox"
          description="Send direct local messages to the selected agent and inspect delivery state."
          control={
            <Button
              size="sm"
              disabled={
                environmentId === null ||
                selectedProject === null ||
                normalizedAgentId.length === 0 ||
                messageBody.trim().length === 0 ||
                messageStatus === "Sending..."
              }
              onClick={handleSendMessage}
            >
              <SendIcon className="size-4" />
              Send
            </Button>
          }
          status={
            messageStatus ??
            (inboxItems.length === 0
              ? "No local inbox messages for this project."
              : `${inboxItems.length} local messages`)
          }
        >
          <div className="mt-4 grid gap-3 rounded-xl border border-border/70 bg-card px-3 py-3 shadow-xs/5 sm:px-4">
            <Textarea
              value={messageBody}
              onChange={(event) => setMessageBody(event.currentTarget.value)}
              rows={3}
              placeholder={`Message ${normalizedAgentId || "selected agent"}`}
            />
            <div className="divide-y divide-border/60 rounded-md border border-border/60">
              {inboxItems.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  No messages have been sent through the local team inbox.
                </div>
              ) : (
                inboxItems
                  .toSorted((left, right) => right.sentAt.localeCompare(left.sentAt))
                  .map((message) => (
                    <div key={message.messageId} className="grid gap-2 px-3 py-3">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-medium text-foreground">
                          {message.senderId} -&gt; {message.recipientId}
                        </div>
                        <span className="shrink-0 rounded-sm border border-border/70 bg-background px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                          {message.state}
                        </span>
                      </div>
                      <div className="break-words text-sm text-muted-foreground">
                        {message.body}
                      </div>
                      {message.state === "delivered" &&
                      message.recipientId === normalizedAgentId ? (
                        <div>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleMarkMessageRead(message.messageId)}
                          >
                            <CheckIcon className="size-3.5" />
                            Mark read
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))
              )}
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Local handoff"
          description="Assign a project thread to the selected agent and inspect the local activity trail."
          control={
            <Button
              size="sm"
              disabled={
                environmentId === null ||
                selectedProject === null ||
                selectedThread === null ||
                normalizedAgentId.length === 0 ||
                handoffStatus === "Assigning..."
              }
              onClick={handleAssignThread}
            >
              <GitBranchIcon className="size-4" />
              Assign
            </Button>
          }
          status={
            handoffStatus ??
            (assignmentItems.length === 0
              ? "No local thread assignments for this project."
              : `${assignmentItems.length} local assignments`)
          }
        >
          <div className="mt-4 grid gap-3 rounded-xl border border-border/70 bg-card px-3 py-3 shadow-xs/5 sm:px-4">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)]">
              <Select
                value={selectedThreadId}
                onValueChange={(value) => {
                  if (value !== null) {
                    setSelectedThreadId(value);
                  }
                }}
              >
                <SelectTrigger aria-label="Handoff thread">
                  <SelectValue>{selectedThread?.title ?? "Select thread"}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {threadOptions.map((thread) => (
                    <SelectItem hideIndicator key={thread.id} value={thread.id}>
                      <span className="block min-w-0 truncate">{thread.title}</span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Input
                nativeInput
                value={handoffNote}
                onChange={(event) => setHandoffNote(event.currentTarget.value)}
                placeholder="Optional note"
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="divide-y divide-border/60 rounded-md border border-border/60">
                {assignmentItems.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    No threads have been assigned in the local team state.
                  </div>
                ) : (
                  assignmentItems
                    .toSorted((left, right) => right.assignedAt.localeCompare(left.assignedAt))
                    .map((assignment) => (
                      <div key={assignment.threadId} className="grid gap-1 px-3 py-3">
                        <div className="min-w-0 truncate text-sm font-medium text-foreground">
                          {threadTitleById.get(assignment.threadId) ?? assignment.threadId}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {assignment.assigneeId} assigned by {assignment.assignedById}
                        </div>
                        {assignment.note !== null ? (
                          <div className="break-words text-sm text-muted-foreground">
                            {assignment.note}
                          </div>
                        ) : null}
                      </div>
                    ))
                )}
              </div>

              <div className="divide-y divide-border/60 rounded-md border border-border/60">
                {activityItems.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    No local team activity has been recorded.
                  </div>
                ) : (
                  activityItems
                    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt))
                    .slice(0, 6)
                    .map((activity) => (
                      <div key={activity.eventId} className="grid gap-1 px-3 py-3">
                        <div className="text-sm text-foreground">{activity.summary}</div>
                        <div className="text-xs text-muted-foreground">{activity.kind}</div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Agent profile"
          description="Create or edit the selected agent profile as a local .agentforge file."
          control={
            <Button
              size="sm"
              disabled={!canSaveAgent || saveStatus === "Saving..."}
              onClick={handleSaveAgent}
            >
              <SaveIcon className="size-3.5" />
              Save profile
            </Button>
          }
          status={saveStatus ?? "Local write only; no commit is created."}
        >
          <div className="mt-4 grid gap-4 rounded-xl border border-border/70 bg-card px-3 py-3 shadow-xs/5 sm:grid-cols-2 sm:px-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Agent ID</span>
              <Input
                nativeInput
                value={agentId}
                onChange={(event) => setAgentId(event.currentTarget.value)}
                placeholder="agent_aria"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <Input
                nativeInput
                value={agentName}
                onChange={(event) => setAgentName(event.currentTarget.value)}
                placeholder="Aria"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Owner ID</span>
              <Input
                nativeInput
                value={ownerId}
                onChange={(event) => setOwnerId(event.currentTarget.value)}
                placeholder="human_local"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Runtime</span>
                <Select
                  value={runtimeMode}
                  onValueChange={(value) => {
                    if (RUNTIME_MODE_OPTIONS.some((option) => option.value === value)) {
                      setRuntimeMode(value as RuntimeMode);
                    }
                  }}
                >
                  <SelectTrigger aria-label="Runtime mode">
                    <SelectValue>
                      {RUNTIME_MODE_OPTIONS.find((option) => option.value === runtimeMode)?.label ??
                        runtimeMode}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {RUNTIME_MODE_OPTIONS.map((option) => (
                      <SelectItem hideIndicator key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Mode</span>
                <Select
                  value={interactionMode}
                  onValueChange={(value) => {
                    if (INTERACTION_MODE_OPTIONS.some((option) => option.value === value)) {
                      setInteractionMode(value as ProviderInteractionMode);
                    }
                  }}
                >
                  <SelectTrigger aria-label="Interaction mode">
                    <SelectValue>
                      {INTERACTION_MODE_OPTIONS.find((option) => option.value === interactionMode)
                        ?.label ?? interactionMode}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {INTERACTION_MODE_OPTIONS.map((option) => (
                      <SelectItem hideIndicator key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
            </div>

            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Persona</span>
              <Textarea
                value={persona}
                onChange={(event) => setPersona(event.currentTarget.value)}
                rows={4}
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Expertise</span>
              <Textarea
                value={expertise}
                onChange={(event) => setExpertise(event.currentTarget.value)}
                rows={6}
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Conventions</span>
              <Textarea
                value={conventions}
                onChange={(event) => setConventions(event.currentTarget.value)}
                rows={6}
              />
            </label>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Instruction preview"
          description="Compile one agent profile into the exact provider instructions used when a session starts."
          control={
            <Button
              size="sm"
              disabled={!canPreview || preview.isPending}
              onClick={() =>
                setSubmitted({
                  cwd: normalizedCwd,
                  agentId: normalizedAgentId,
                  driver,
                })
              }
            >
              <RefreshCwIcon className={cn("size-3.5", preview.isPending && "animate-spin")} />
              Preview
            </Button>
          }
        >
          <div className="mt-4 grid gap-4 rounded-xl border border-border/70 bg-card px-3 py-3 shadow-xs/5 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)] sm:px-4">
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Workspace</span>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
                <Input
                  nativeInput
                  value={cwd}
                  onChange={(event) => setCwd(event.currentTarget.value)}
                  placeholder="/path/to/repository"
                />
                <Select
                  value={cwd}
                  onValueChange={(value) => {
                    if (value !== null) {
                      setCwd(value);
                    }
                  }}
                >
                  <SelectTrigger aria-label="Project workspace">
                    <SelectValue>
                      {projectOptions.find((project) => project.value === cwd)?.label ??
                        "Select project"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {projectOptions.map((project) => (
                      <SelectItem hideIndicator key={project.value} value={project.value}>
                        <span className="block min-w-0 truncate">{project.label}</span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Agent ID</span>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)]">
                <Input
                  nativeInput
                  value={agentId}
                  onChange={(event) => setAgentId(event.currentTarget.value)}
                  placeholder="agent_aria"
                />
                <Select
                  value={agentId}
                  onValueChange={(value) => {
                    if (value !== null) {
                      setAgentId(value);
                    }
                  }}
                >
                  <SelectTrigger aria-label="Roster agent">
                    <SelectValue>
                      {agentOptions.find((agent) => agent.id === agentId)?.name ?? "Select agent"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {agentOptions.map((agent) => (
                      <SelectItem hideIndicator key={agent.id} value={agent.id}>
                        <span className="block min-w-0 truncate">{agent.name}</span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Driver</span>
              <Select
                value={driver}
                onValueChange={(value) => {
                  if (DRIVER_OPTIONS.some((option) => option.value === value)) {
                    setDriver(value as (typeof DRIVER_OPTIONS)[number]["value"]);
                  }
                }}
              >
                <SelectTrigger aria-label="Provider driver">
                  <SelectValue>
                    {DRIVER_OPTIONS.find((option) => option.value === driver)?.label ?? driver}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {DRIVER_OPTIONS.map((option) => (
                    <SelectItem hideIndicator key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-border/70 bg-card shadow-xs/5">
            <div className="flex min-h-11 items-center justify-between gap-3 border-border/60 border-b px-3 py-2 sm:px-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">Compiled instructions</div>
                <div className="truncate text-xs text-muted-foreground">
                  {preview.data
                    ? `${preview.data.driver} · ${preview.data.mechanicalHash} · ${
                        previewTrustStatus ?? "Untrusted mechanics"
                      }`
                    : submitted
                      ? `${submitted.driver} · ${submitted.agentId}`
                      : "No preview loaded"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="size-6 rounded-sm p-0"
                        disabled={
                          preview.data === undefined || previewTrustStatus === "Trusted mechanics"
                        }
                        onClick={handleTrustPreviewMechanics}
                        aria-label="Trust AgentForge mechanics"
                      >
                        <ShieldCheckIcon className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">Trust mechanics</TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="size-6 rounded-sm p-0"
                        disabled={previewAtom === null || preview.isPending}
                        onClick={preview.refresh}
                        aria-label="Refresh instruction preview"
                      >
                        <RefreshCwIcon
                          className={cn("size-3.5", preview.isPending && "animate-spin")}
                        />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">Refresh preview</TooltipPopup>
                </Tooltip>
              </div>
            </div>

            {preview.error ? (
              <div className="px-3 py-3 text-sm text-destructive sm:px-4">{preview.error}</div>
            ) : null}

            <div className="p-3 sm:p-4">
              <Textarea
                readOnly
                value={
                  preview.data?.instructions ??
                  (submitted === null
                    ? "Choose an agent and driver, then preview."
                    : preview.isPending
                      ? "Compiling..."
                      : "")
                }
                className="font-mono text-xs"
                rows={18}
              />
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
