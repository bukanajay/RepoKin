import type { MemberPresenceState } from "@t3tools/contracts/team";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { teamEnvironment } from "../../state/team";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";

/**
 * Read-only Team Home for mobile (R1.8). Reuses the roster + local-state RPCs;
 * agent authoring and the fixture previews stay on web/desktop.
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

export function TeamHomeRouteScreen() {
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

  useEffect(() => {
    if (selectedProject !== null && selectedProjectKey !== projectKey(selectedProject)) {
      setSelectedProjectKey(projectKey(selectedProject));
    }
  }, [selectedProject, selectedProjectKey]);

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

  const agents = roster.data?.agents ?? [];
  const humans = roster.data?.humans ?? [];
  const openRequests = (localState.data?.project?.requests ?? []).filter(
    (request) => request.state === "open",
  );
  const unreadMessages = (localState.data?.project?.inbox ?? []).filter(
    (message) => message.state === "queued" || message.state === "delivered",
  );
  const waitingCount = openRequests.length + unreadMessages.length;
  const recentActivity = [...(localState.data?.project?.activities ?? [])]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 6);
  const memberNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const human of humans) byId.set(human.id, human.displayName);
    for (const agent of agents) byId.set(agent.id, agent.name);
    return byId;
  }, [agents, humans]);

  const isEmpty = roster.data !== null && agents.length === 0 && humans.length === 0;

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
              <Text className="text-xl font-t3-semibold text-foreground">Team</Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                {roster.data?.team?.displayName ?? selectedProject?.title ?? "Team home"}
              </Text>
            </View>
            {roster.isPending ? <ActivityIndicator /> : null}
          </View>
          <Text className="text-sm leading-normal text-foreground-muted">
            A read-only view of your team on mobile. Create agents and manage channels on web or
            desktop.
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
                    onPress={() => setSelectedProjectKey(key)}
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

        {roster.data === null ? (
          <SettingsSection title="Team" card>
            <View className="items-center gap-3 px-6 py-10">
              <ActivityIndicator />
              <Text className="text-sm text-foreground-muted">Loading your team…</Text>
            </View>
          </SettingsSection>
        ) : isEmpty ? (
          <SettingsSection title="Team" card>
            <View className="items-center gap-2 px-6 py-9">
              <SymbolView
                name={{ ios: "sparkles", android: "auto_awesome" }}
                size={30}
                tintColor={mutedIconColor}
                type="monochrome"
              />
              <Text className="text-center text-base font-t3-medium text-foreground">
                No team yet
              </Text>
              <Text className="text-center text-sm leading-normal text-foreground-muted">
                Create your first agent on web or desktop; it will show up here.
              </Text>
            </View>
          </SettingsSection>
        ) : (
          <>
            <SettingsSection title="Waiting on you" card>
              <View className="flex-row items-center gap-3 px-4 py-3">
                <SymbolView
                  name={waitingCount > 0 ? "bell.badge" : "checkmark.circle"}
                  size={20}
                  tintColor={iconColor}
                  type="monochrome"
                />
                <Text className="min-w-0 flex-1 text-base text-foreground">
                  {waitingCount === 0
                    ? "Nothing needs you right now."
                    : `${waitingCount} item${waitingCount === 1 ? "" : "s"} waiting`}
                </Text>
              </View>
            </SettingsSection>

            {agents.length > 0 ? (
              <SettingsSection title={`My agents · ${agents.length}`} card>
                {agents.map((agent, index) => (
                  <View
                    key={agent.id}
                    className={
                      index === 0
                        ? "min-h-16 flex-row items-center gap-3 px-4 py-3"
                        : "min-h-16 border-border border-t flex-row items-center gap-3 px-4 py-3"
                    }
                  >
                    <View className="size-9 items-center justify-center rounded-lg bg-subtle">
                      <SymbolView
                        name="sparkles"
                        size={18}
                        tintColor={iconColor}
                        type="monochrome"
                      />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
                        {agent.name}
                      </Text>
                      <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                        {agent.character.runtimeMode ?? "approval-required"}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      <PresenceDot state={presenceByMemberId.get(agent.id) ?? null} />
                      <Text className="text-sm text-foreground-muted">
                        {PRESENCE_LABEL[presenceByMemberId.get(agent.id) ?? "offline"]}
                      </Text>
                    </View>
                  </View>
                ))}
              </SettingsSection>
            ) : null}

            {humans.length > 0 ? (
              <SettingsSection title={`Teammates · ${humans.length}`} card>
                {humans.map((human, index) => (
                  <View
                    key={human.id}
                    className={
                      index === 0
                        ? "min-h-14 flex-row items-center gap-3 px-4 py-3"
                        : "min-h-14 border-border border-t flex-row items-center gap-3 px-4 py-3"
                    }
                  >
                    <View className="size-9 items-center justify-center rounded-full bg-subtle">
                      <SymbolView
                        name="person.crop.circle"
                        size={20}
                        tintColor={iconColor}
                        type="monochrome"
                      />
                    </View>
                    <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
                      {human.displayName}
                    </Text>
                    <PresenceDot state={presenceByMemberId.get(human.id) ?? null} />
                  </View>
                ))}
              </SettingsSection>
            ) : null}

            {recentActivity.length > 0 ? (
              <SettingsSection title="Recent activity" card>
                {recentActivity.map((activity, index) => (
                  <View
                    key={activity.eventId}
                    className={
                      index === 0 ? "gap-0.5 px-4 py-3" : "border-border border-t gap-0.5 px-4 py-3"
                    }
                  >
                    <Text className="text-base text-foreground">{activity.summary}</Text>
                    {activity.actorMemberId !== null ? (
                      <Text className="text-sm text-foreground-muted">
                        {memberNameById.get(activity.actorMemberId) ?? activity.actorMemberId}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </SettingsSection>
            ) : null}

            <SettingsSection title="People" card>
              <SettingsRow icon="person.2" label="View all people" target="SettingsRepoKin" />
            </SettingsSection>
          </>
        )}
      </ScrollView>
    </View>
  );
}
