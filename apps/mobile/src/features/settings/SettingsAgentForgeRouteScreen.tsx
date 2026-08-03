import type { AgentProfile } from "@t3tools/contracts/team";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { teamEnvironment } from "../../state/team";
import { SettingsSection } from "./components/SettingsSection";

function projectKey(project: { readonly environmentId: string; readonly id: string }): string {
  return `${project.environmentId}:${project.id}`;
}

function providerLabel(agent: AgentProfile): string {
  const provider = agent.character.provider;
  if (provider === undefined) return "Project default";
  return provider.model === undefined ? provider.driver : `${provider.driver} · ${provider.model}`;
}

function valueOrFallback(value: string | undefined, fallback = "Not set"): string {
  return value === undefined || value.trim().length === 0 ? fallback : value;
}

export function SettingsAgentForgeRouteScreen() {
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
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgent =
    roster.data?.agents.find((agent) => agent.id === selectedAgentId) ??
    roster.data?.agents[0] ??
    null;
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
    if (selectedAgent !== null && selectedAgentId !== selectedAgent.id) {
      setSelectedAgentId(selectedAgent.id);
    }
  }, [selectedAgent, selectedAgentId]);

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
                name={{ ios: "sparkles", android: "auto_awesome" }}
                size={22}
                tintColor={iconColor}
                type="monochrome"
              />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xl font-t3-semibold text-foreground">AgentForge</Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                {roster.data?.team?.displayName ?? selectedProject?.title ?? "Team roster"}
              </Text>
            </View>
            {roster.isPending ? <ActivityIndicator /> : null}
          </View>
          <Text className="text-sm leading-normal text-foreground-muted">
            Roster access is read-only on mobile. Agent editing remains available on web and
            desktop.
          </Text>
        </View>

        {projects.length > 0 ? (
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
              detail="Connect an environment with a project to read its AgentForge roster."
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
              <Text className="text-sm text-foreground-muted">Loading team roster...</Text>
            </View>
          </SettingsSection>
        ) : (
          <>
            <SettingsSection
              title={`${roster.data.agents.length} agent${roster.data.agents.length === 1 ? "" : "s"} · ${roster.data.humans.length} human${roster.data.humans.length === 1 ? "" : "s"}`}
              card
            >
              {roster.data.agents.length === 0 ? (
                <EmptyRoster
                  iconColor={mutedIconColor}
                  title="No agents in this roster"
                  detail="Agent profiles will appear here after they are added on web or desktop."
                />
              ) : (
                roster.data.agents.map((agent, index) => (
                  <Pressable
                    key={agent.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedAgent?.id === agent.id }}
                    onPress={() => setSelectedAgentId(agent.id)}
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
                        name="person.crop.circle"
                        size={20}
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
                    <SymbolView
                      name="chevron.right"
                      size={15}
                      tintColor={mutedIconColor}
                      type="monochrome"
                    />
                  </Pressable>
                ))
              )}
            </SettingsSection>

            {selectedAgent !== null ? (
              <SettingsSection title="Agent detail" card>
                <DetailRow label="Name" value={selectedAgent.name} />
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
