import type { AgentProfile, HumanProfile, MemberPresenceState } from "@t3tools/contracts/team";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { teamEnvironment } from "../../state/team";
import { SettingsSection } from "../settings/components/SettingsSection";

/**
 * Read-only People roster for mobile (R1.8). Lists humans and agents with
 * presence; agent detail is expandable. Authoring stays on web/desktop.
 */

function projectKey(project: { readonly environmentId: string; readonly id: string }): string {
  return `${project.environmentId}:${project.id}`;
}

const PRESENCE_LABEL: Record<MemberPresenceState, string> = {
  online: "Online",
  busy: "Busy",
  away: "Away",
  offline: "Offline",
};

const PRESENCE_DOT: Record<MemberPresenceState, string> = {
  online: "bg-emerald-500",
  busy: "bg-amber-500",
  away: "bg-sky-500",
  offline: "bg-foreground-muted/40",
};

function PresenceDot({ state }: { state: MemberPresenceState | null }) {
  const resolved = state ?? "offline";
  return <View className={`size-2 rounded-full ${PRESENCE_DOT[resolved]}`} />;
}

function providerLabel(agent: AgentProfile): string {
  const provider = agent.character.provider;
  if (provider === undefined) return "Project default";
  return provider.model === undefined ? provider.driver : `${provider.driver} · ${provider.model}`;
}

function valueOrFallback(value: string | undefined, fallback = "Not set"): string {
  return value === undefined || value.trim().length === 0 ? fallback : value;
}

export function TeamPeopleRouteScreen() {
  const insets = useSafeAreaInsets();
  const iconColor = useThemeColor("--color-icon");
  const mutedIconColor = useThemeColor("--color-icon-subtle");
  const primaryForegroundColor = useThemeColor("--color-primary-foreground");
  const projects = useProjects();
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const selectedProject = useMemo(
    () =>
      projects.find((project) => projectKey(project) === selectedProjectKey) ?? projects[0] ?? null,
    [projects, selectedProjectKey],
  );

  const rosterAtom =
    selectedProject === null
      ? null
      : teamEnvironment.roster({
          environmentId: selectedProject.environmentId,
          input: { cwd: selectedProject.workspaceRoot },
        });
  const roster = useEnvironmentQuery(rosterAtom);

  const localStateAtom =
    selectedProject === null
      ? null
      : teamEnvironment.localState({
          environmentId: selectedProject.environmentId,
          input: { projectId: selectedProject.id },
        });
  const localState = useEnvironmentQuery(localStateAtom);

  const presenceByMemberId = useMemo(() => {
    const byId = new Map<string, MemberPresenceState | null>();
    for (const entry of localState.data?.presences ?? []) {
      byId.set(entry.memberId, entry.state);
    }
    return byId;
  }, [localState.data?.presences]);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgent = roster.data?.agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const owner =
    selectedAgent === null
      ? null
      : (roster.data?.humans.find((human) => human.id === selectedAgent.owner) ?? null);

  useEffect(() => {
    if (selectedProject !== null && selectedProjectKey !== projectKey(selectedProject)) {
      setSelectedProjectKey(projectKey(selectedProject));
    }
  }, [selectedProject, selectedProjectKey]);

  useEffect(() => {
    if (
      selectedAgentId !== null &&
      roster.data !== null &&
      !roster.data.agents.some((agent) => agent.id === selectedAgentId)
    ) {
      setSelectedAgentId(null);
    }
  }, [roster.data, selectedAgentId]);

  const agents = roster.data?.agents ?? [];
  const humans = roster.data?.humans ?? [];

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <View className="gap-3 px-1">
          <View className="flex-row items-center gap-3">
            <View className="size-11 items-center justify-center rounded-xl bg-primary/10">
              <SymbolView
                name={{ ios: "person.2", android: "group" }}
                size={22}
                tintColor={iconColor}
                type="monochrome"
              />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xl font-t3-semibold text-foreground">People</Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                {roster.data?.team?.displayName ?? selectedProject?.title ?? "Team roster"}
              </Text>
            </View>
            {roster.isPending || localState.isPending ? <ActivityIndicator /> : null}
          </View>
          <Text className="text-sm leading-normal text-foreground-muted">
            Read-only roster on mobile. Tap an agent for character details. Edit on web or desktop.
          </Text>
        </View>

        {projects.length > 1 ? (
          <View className="gap-2">
            <Text className="px-2 text-sm font-t3-medium text-foreground-muted">Project</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2"
            >
              {projects.map((project) => {
                const key = projectKey(project);
                const selected = key === selectedProjectKey;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSelectedProjectKey(key);
                      setSelectedAgentId(null);
                    }}
                    className={
                      selected
                        ? "h-10 max-w-64 flex-row items-center gap-2 rounded-xl bg-primary px-3"
                        : "h-10 max-w-64 flex-row items-center gap-2 rounded-xl bg-subtle px-3"
                    }
                  >
                    <SymbolView
                      name="folder"
                      size={15}
                      tintColor={selected ? primaryForegroundColor : iconColor}
                      type="monochrome"
                    />
                    <Text
                      className={
                        selected
                          ? "min-w-0 text-sm font-t3-medium text-primary-foreground"
                          : "min-w-0 text-sm font-t3-medium text-foreground"
                      }
                      numberOfLines={1}
                    >
                      {project.title}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {projects.length === 0 ? (
          <SettingsSection title="Roster" card>
            <EmptyRoster
              iconColor={mutedIconColor}
              title="No projects available"
              detail="Connect an environment with a project to read its roster."
            />
          </SettingsSection>
        ) : roster.error !== null ? (
          <SettingsSection title="Roster" card>
            <EmptyRoster
              iconColor={mutedIconColor}
              title="Roster unavailable"
              detail={roster.error}
              actionLabel="Retry"
              onAction={roster.refresh}
            />
          </SettingsSection>
        ) : roster.data === null ? (
          <SettingsSection title="Roster" card>
            <View className="items-center gap-3 px-6 py-10">
              <ActivityIndicator />
              <Text className="text-sm text-foreground-muted">Loading people…</Text>
            </View>
          </SettingsSection>
        ) : (
          <>
            <SettingsSection title={`Humans · ${humans.length}`} card>
              {humans.length === 0 ? (
                <EmptyRoster
                  iconColor={mutedIconColor}
                  title="No humans in this roster"
                  detail="Human profiles appear after the roster is set up on web or desktop."
                />
              ) : (
                humans.map((human, index) => (
                  <HumanRow
                    key={human.id}
                    human={human}
                    presence={presenceByMemberId.get(human.id) ?? null}
                    first={index === 0}
                    iconColor={iconColor}
                  />
                ))
              )}
            </SettingsSection>

            <SettingsSection title={`Agents · ${agents.length}`} card>
              {agents.length === 0 ? (
                <EmptyRoster
                  iconColor={mutedIconColor}
                  title="No agents in this roster"
                  detail="Create agents on web or desktop; they will show up here."
                />
              ) : (
                agents.map((agent, index) => (
                  <Pressable
                    key={agent.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedAgent?.id === agent.id }}
                    onPress={() =>
                      setSelectedAgentId((current) => (current === agent.id ? null : agent.id))
                    }
                    className={
                      index === 0
                        ? "min-h-16 flex-row items-center gap-3 px-4 py-3"
                        : "min-h-16 border-border border-t flex-row items-center gap-3 px-4 py-3"
                    }
                  >
                    <View
                      className={
                        selectedAgent?.id === agent.id
                          ? "size-9 items-center justify-center rounded-lg bg-primary"
                          : "size-9 items-center justify-center rounded-lg bg-subtle"
                      }
                    >
                      <SymbolView
                        name="sparkles"
                        size={18}
                        tintColor={
                          selectedAgent?.id === agent.id ? primaryForegroundColor : iconColor
                        }
                        type="monochrome"
                      />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
                        {agent.name}
                      </Text>
                      <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                        {providerLabel(agent)}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      <PresenceDot state={presenceByMemberId.get(agent.id) ?? null} />
                      <Text className="text-sm text-foreground-muted">
                        {PRESENCE_LABEL[presenceByMemberId.get(agent.id) ?? "offline"]}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </SettingsSection>

            {selectedAgent !== null ? (
              <SettingsSection title={`${selectedAgent.name} · detail`} card>
                <DetailRow label="Agent ID" value={selectedAgent.id} />
                <DetailRow label="Owner" value={owner?.displayName ?? selectedAgent.owner} />
                <DetailRow
                  label="Home environment"
                  value={valueOrFallback(selectedAgent.homeEnvironment, "Any linked environment")}
                />
                <DetailRow label="Provider" value={providerLabel(selectedAgent)} />
                <DetailRow
                  label="Runtime"
                  value={selectedAgent.character.runtimeMode ?? "approval-required"}
                />
                <DetailRow
                  label="Interaction"
                  value={selectedAgent.character.interactionMode ?? "default"}
                />
                <DetailRow
                  label="Expertise"
                  value={selectedAgent.character.expertise?.join(", ") ?? "Not set"}
                />
                {(selectedAgent.duties?.length ?? 0) > 0 ? (
                  <DetailRow
                    label="Duties"
                    value={selectedAgent.duties!.map((duty) => duty.id).join(", ")}
                  />
                ) : null}
                {selectedAgent.character.persona ? (
                  <View className="border-border border-t gap-1 px-4 py-3">
                    <Text className="text-sm text-foreground-muted">Persona</Text>
                    <Text selectable className="text-base leading-normal text-foreground">
                      {selectedAgent.character.persona}
                    </Text>
                  </View>
                ) : null}
              </SettingsSection>
            ) : null}

            {roster.data.warnings.length > 0 ? (
              <SettingsSection title="Roster warnings" card>
                <View className="gap-2 px-4 py-3">
                  {roster.data.warnings.map((warning) => (
                    <Text key={warning} selectable className="text-sm text-danger-foreground">
                      {warning}
                    </Text>
                  ))}
                </View>
              </SettingsSection>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function HumanRow(props: {
  readonly human: HumanProfile;
  readonly presence: MemberPresenceState | null;
  readonly first: boolean;
  readonly iconColor: string;
}) {
  return (
    <View
      className={
        props.first
          ? "min-h-14 flex-row items-center gap-3 px-4 py-3"
          : "min-h-14 border-border border-t flex-row items-center gap-3 px-4 py-3"
      }
    >
      <View className="size-9 items-center justify-center rounded-full bg-subtle">
        <SymbolView
          name="person.crop.circle"
          size={20}
          tintColor={props.iconColor}
          type="monochrome"
        />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
          {props.human.displayName}
        </Text>
        {props.human.pronouns !== undefined ? (
          <Text className="text-sm text-foreground-muted" numberOfLines={1}>
            {props.human.pronouns}
          </Text>
        ) : null}
      </View>
      <View className="flex-row items-center gap-1.5">
        <PresenceDot state={props.presence} />
        <Text className="text-sm text-foreground-muted">
          {PRESENCE_LABEL[props.presence ?? "offline"]}
        </Text>
      </View>
    </View>
  );
}

function DetailRow(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="min-h-13 border-border border-t first:border-t-0 flex-row items-start gap-4 px-4 py-3">
      <Text className="w-28 shrink-0 text-sm text-foreground-muted">{props.label}</Text>
      <Text selectable className="min-w-0 flex-1 text-right text-base text-foreground">
        {props.value}
      </Text>
    </View>
  );
}

function EmptyRoster(props: {
  readonly iconColor: ColorValue;
  readonly title: string;
  readonly detail: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  return (
    <View className="items-center gap-2 px-6 py-9">
      <SymbolView
        name="person.crop.circle"
        size={30}
        tintColor={props.iconColor}
        type="monochrome"
      />
      <Text className="text-center text-base font-t3-medium text-foreground">{props.title}</Text>
      <Text className="text-center text-sm leading-normal text-foreground-muted">
        {props.detail}
      </Text>
      {props.actionLabel && props.onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={props.onAction}
          className="mt-2 h-10 items-center justify-center rounded-xl bg-subtle px-4"
        >
          <Text className="text-sm font-t3-medium text-foreground">{props.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
