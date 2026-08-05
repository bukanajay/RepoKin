import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, InboxIcon, NewspaperIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { teamEnvironment } from "../../state/team";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { ActivityRow } from "./ActivityRow";
import { AgentBadgeRow } from "./AgentBadgeRow";
import { AgentEditorDialog } from "./AgentEditorDialog";
import { MemberChip } from "./MemberChip";
import { PresenceDot, presenceStateLabel } from "./PresenceDot";
import { TeamCard } from "./TeamCard";
import { TeamScreenShell } from "./TeamScreenShell";
import { deriveMemberAccentColor } from "./memberIdentity";
import { useTeamRosterActions } from "./useTeamRosterActions";
import { useTeamScope } from "./teamScope";
import { useTeamHomeData, type TeamHomeData, type TeamHomeWaitingItem } from "./useTeamHomeData";
import { useWorkMapData } from "./useWorkMapData";

function SectionTitle({ title, linkTo }: { title: string; linkTo?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {linkTo !== undefined ? (
        <Link
          to={linkTo}
          className="ms-auto inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          View all
          <ArrowRightIcon className="size-3" />
        </Link>
      ) : null}
    </div>
  );
}

/** One-action standup posts this environment's digest to #team (FR-15.3). */
function StandupCard() {
  const { environmentId, project } = useTeamScope();
  const postStandup = useAtomCommand(teamEnvironment.postStandupDigest, "post standup digest");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (environmentId === null || project === null) return null;

  return (
    <section className="flex flex-col gap-2.5">
      <SectionTitle title="Standup" />
      <div className="flex flex-col gap-2 rounded-2xl border px-3 py-3">
        <p className="text-xs text-muted-foreground">
          Generate a digest of this environment's activity and post it to{" "}
          <span className="font-mono">#team</span>.
        </p>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setStatus(null);
            void postStandup({
              environmentId,
              input: { projectId: project.id },
            })
              .then((result) => {
                if (result._tag === "Success") {
                  setStatus(`Posted “${result.value.title}” to #${result.value.channelId}.`);
                } else {
                  setStatus("Could not post standup. Check roster / local human identity.");
                }
              })
              .finally(() => setPending(false));
          }}
        >
          {pending ? <Spinner className="size-3.5" /> : <NewspaperIcon className="size-3.5" />}
          {pending ? "Posting…" : "Post standup to #team"}
        </Button>
        {status !== null ? <p className="text-xs text-muted-foreground">{status}</p> : null}
      </div>
    </section>
  );
}

/** Passive overlap radar on Home (FR-14.3) — dismissible list, never a modal. */
function HomeRadarRail() {
  const workMap = useWorkMapData();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  if (workMap.status !== "ready" || workMap.overlaps.length === 0) return null;

  const visible = workMap.overlaps.filter((overlap) => !dismissed.has(overlap.path));
  if (visible.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5">
      <SectionTitle title="Radar" linkTo="/team/map" />
      <div className="flex flex-col divide-y rounded-2xl border">
        {visible.map((overlap) => (
          <div key={overlap.path} className="flex items-start gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-muted-foreground">{overlap.path}</p>
              <p className="text-sm text-foreground">{overlap.note}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setDismissed((previous) => new Set([...previous, overlap.path]))}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function OnboardingEmptyState() {
  const { canWrite } = useTeamRosterActions();
  const [editorOpen, setEditorOpen] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
      <AgentEditorDialog open={editorOpen} onOpenChange={setEditorOpen} agent={null} />
      <h2 className="text-base font-semibold text-foreground">Build your team</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Agents are teammates here: they get a name, a character, and their work shows up in the
        team's activity feed. Create your first agent to get started.
      </p>
      {canWrite ? (
        <Button size="sm" onClick={() => setEditorOpen(true)}>
          <PlusIcon className="size-4" />
          Create your first agent
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Connect an environment and select a project to add agents.
        </p>
      )}
    </div>
  );
}

function AgentCards({ data }: { data: TeamHomeData }) {
  const { environmentId } = useTeamScope();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {data.agents.map((agent) => (
        <TeamCard
          key={agent.profile.id}
          accentColor={deriveMemberAccentColor(agent.profile.id, agent.profile.avatar?.accentColor)}
          header={
            <MemberChip
              memberId={agent.profile.id}
              displayName={agent.profile.name}
              memberType="agent"
              avatar={agent.profile.avatar}
              presence={agent.presence}
              showPresence
              badge={
                agent.remoteEnvironmentLabel !== null
                  ? { label: `on ${agent.remoteEnvironmentLabel}`, tone: "info" }
                  : undefined
              }
            />
          }
          deepLink={
            <Link
              to="/team/people/$memberId"
              params={{ memberId: agent.profile.id }}
              className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Profile
              <ArrowRightIcon className="size-3" />
            </Link>
          }
          liveState={
            agent.statusHeadline !== null &&
            environmentId !== null &&
            agent.activeThreadId !== null ? (
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: agent.activeThreadId }}
                className="inline-flex min-w-0 items-center gap-1.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate">
                  {agent.statusHeadline}
                  {agent.statusDetail !== null ? ` — ${agent.statusDetail}` : ""}
                </span>
                <ArrowRightIcon className="size-3 shrink-0" />
              </Link>
            ) : (
              <span>{presenceStateLabel(agent.presence)}</span>
            )
          }
        >
          <AgentBadgeRow character={agent.profile.character} />
        </TeamCard>
      ))}
    </div>
  );
}

function TeammateRows({ data }: { data: TeamHomeData }) {
  return (
    <div className="flex flex-col divide-y rounded-2xl border">
      {data.teammates.map((teammate) => (
        <div key={teammate.profile.id} className="flex items-center gap-2 px-3 py-2">
          <MemberChip
            memberId={teammate.profile.id}
            displayName={teammate.profile.displayName}
            memberType="human"
            avatar={teammate.profile.avatar}
            badge={
              teammate.remoteEnvironmentLabel !== null
                ? { label: `on ${teammate.remoteEnvironmentLabel}`, tone: "info" }
                : undefined
            }
          />
          <span className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <PresenceDot state={teammate.presence} size="sm" />
            {presenceStateLabel(teammate.presence)}
          </span>
        </div>
      ))}
    </div>
  );
}

function WaitingItemRow({ item, data }: { item: TeamHomeWaitingItem; data: TeamHomeData }) {
  const fromId = item.kind === "request" ? item.request.fromMemberId : item.message.senderId;
  const sender = data.memberSummaryById.get(fromId);
  const description =
    item.kind === "request"
      ? item.request.kind === "review"
        ? "requested a review"
        : "requested a handoff"
      : "sent you a message";
  return (
    <Link
      to="/team/inbox"
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {sender !== undefined ? (
        <MemberChip
          memberId={sender.memberId}
          displayName={sender.displayName}
          memberType={sender.memberType}
          avatar={sender.avatar}
        />
      ) : (
        <span className="text-sm font-medium text-foreground">{fromId}</span>
      )}
      <span className="min-w-0 truncate text-sm text-muted-foreground">{description}</span>
      <ArrowRightIcon className="ms-auto size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function TeamHomeScreen() {
  const data = useTeamHomeData();

  if (data.status === "no-environment" || data.status === "no-project") {
    return (
      <TeamScreenShell title="Home">
        <p className="text-sm text-muted-foreground">
          {data.status === "no-environment"
            ? "Connect an environment to see your team."
            : "Add a project to this environment to see its team."}
        </p>
      </TeamScreenShell>
    );
  }

  if (data.status === "loading") {
    return (
      <TeamScreenShell title="Home">
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading the roster…
        </div>
      </TeamScreenShell>
    );
  }

  if (data.isEmpty) {
    return (
      <TeamScreenShell title="Home">
        <OnboardingEmptyState />
      </TeamScreenShell>
    );
  }

  return (
    <TeamScreenShell title="Home">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {data.agents.length > 0 ? (
            <section className="flex flex-col gap-2.5">
              <SectionTitle title="My agents" linkTo="/team/people" />
              <AgentCards data={data} />
            </section>
          ) : null}

          {data.teammates.length > 0 ? (
            <section className="flex flex-col gap-2.5">
              <SectionTitle title="Teammates" linkTo="/team/people" />
              <TeammateRows data={data} />
            </section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <StandupCard />
          <HomeRadarRail />

          <section className="flex flex-col gap-2.5">
            <SectionTitle title="Waiting on you" linkTo="/team/inbox" />
            {data.waitingOnMe.length === 0 ? (
              <div className="flex items-center gap-2 rounded-2xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
                <InboxIcon className="size-4" />
                Nothing needs you right now.
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 rounded-2xl border p-1">
                {data.waitingOnMe.map((item) => (
                  <WaitingItemRow
                    key={item.kind === "request" ? item.request.requestId : item.message.messageId}
                    item={item}
                    data={data}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2.5">
            <SectionTitle title="Recent activity" linkTo="/team/activity" />
            {data.recentActivity.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">No team activity yet.</p>
            ) : (
              <div className="flex flex-col divide-y rounded-2xl border px-3">
                {data.recentActivity.map((activity) => {
                  const actor =
                    activity.actorMemberId !== null
                      ? data.memberSummaryById.get(activity.actorMemberId)
                      : undefined;
                  return (
                    <ActivityRow
                      key={activity.eventId}
                      actor={
                        actor !== undefined ? (
                          <MemberChip
                            memberId={actor.memberId}
                            displayName={actor.displayName}
                            memberType={actor.memberType}
                            avatar={actor.avatar}
                            size="xs"
                          />
                        ) : (
                          <span className="text-sm font-medium text-muted-foreground">System</span>
                        )
                      }
                      verb={activity.summary}
                      occurredAt={activity.occurredAt}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </TeamScreenShell>
  );
}
