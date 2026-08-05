import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockIcon,
  PencilIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { AgentBadgeRow } from "./AgentBadgeRow";
import { AgentEditorDialog } from "./AgentEditorDialog";
import { MemberAvatar } from "./MemberAvatar";
import { PresenceDot, presenceStateLabel } from "./PresenceDot";
import { TeamScreenShell } from "./TeamScreenShell";
import { useTeamMemberProfileData } from "./useTeamMemberProfileData";
import { useTeamRosterActions } from "./useTeamRosterActions";

function ProfileList({ label, values }: { label: string; values: readonly string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <ul className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <li
            key={value}
            className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          >
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TeamMemberProfileScreen({ memberId }: { memberId: string }) {
  const data = useTeamMemberProfileData(memberId);
  const {
    canWrite,
    isTrusted,
    trustMechanics,
    revokeTrust,
    confirmDuty,
    isDutyConfirmed,
    revokeDutyConfirmation,
  } = useTeamRosterActions();
  const [editorOpen, setEditorOpen] = useState(false);

  if (data.status !== "ready" || data.profile === null) {
    return (
      <TeamScreenShell title={memberId}>
        {data.status === "loading" ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading profile…
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.status === "not-found"
              ? "This member is not in the current project's roster."
              : "Select a connected environment and project to view profiles."}
          </p>
        )}
      </TeamScreenShell>
    );
  }

  const profile = data.profile;
  const displayName = profile.type === "agent" ? profile.name : profile.displayName;
  const trusted =
    profile.type === "agent" && data.instructionPreview !== null
      ? isTrusted(profile.id, data.instructionPreview.mechanicalHash)
      : false;

  return (
    <TeamScreenShell
      title={displayName}
      actions={
        <div className="flex items-center gap-2">
          {canWrite && profile.type === "agent" ? (
            <Button size="xs" variant="outline" onClick={() => setEditorOpen(true)}>
              <PencilIcon className="size-3.5" />
              Edit
            </Button>
          ) : null}
          <Link
            to="/team/people"
            className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeftIcon className="size-3" />
            All people
          </Link>
        </div>
      }
    >
      {profile.type === "agent" ? (
        <AgentEditorDialog open={editorOpen} onOpenChange={setEditorOpen} agent={profile} />
      ) : null}
      {/* Identity header */}
      <div className="flex items-start gap-4">
        <MemberAvatar
          memberId={profile.id}
          displayName={displayName}
          memberType={profile.type}
          avatar={profile.avatar}
          size="xl"
        />
        <div className="flex min-w-0 flex-col gap-1 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-foreground">{displayName}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PresenceDot state={data.presence} size="sm" />
              {data.statusHeadline ?? presenceStateLabel(data.presence)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {profile.id}
            {data.ownerName !== null ? ` · runs for ${data.ownerName}` : ""}
            {profile.type === "human" && profile.pronouns !== undefined
              ? ` · ${profile.pronouns}`
              : ""}
          </span>
          {profile.type === "agent" ? (
            <AgentBadgeRow character={profile.character} className="pt-1" />
          ) : null}
        </div>
      </div>

      {/* Expressive character / bio */}
      {profile.type === "agent" ? (
        <section className="flex flex-col gap-3">
          {profile.character.persona !== undefined ? (
            <p className="max-w-prose text-sm leading-relaxed text-foreground">
              {profile.character.persona}
            </p>
          ) : null}
          <ProfileList label="Expertise" values={profile.character.expertise ?? []} />
          <ProfileList label="Conventions" values={profile.character.conventions ?? []} />
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          {profile.bio !== undefined ? (
            <p className="max-w-prose text-sm leading-relaxed text-foreground">{profile.bio}</p>
          ) : null}
          <ProfileList label="Git emails" values={profile.gitEmails} />
        </section>
      )}

      {/* Compiled instruction preview + trust (agents) */}
      {profile.type === "agent" && data.instructionPreview !== null ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Compiled instructions{" "}
              <span className="font-normal text-muted-foreground">
                ({data.instructionPreview.driver})
              </span>
            </h2>
            <Badge variant={trusted ? "success" : "warning"} size="sm" className="gap-1">
              <ShieldCheckIcon />
              {trusted ? "Trusted mechanics" : "Untrusted mechanics"}
            </Badge>
            {canWrite ? (
              <Button
                size="xs"
                variant="outline"
                className="ms-auto"
                onClick={() =>
                  trusted
                    ? revokeTrust(profile.id)
                    : trustMechanics(profile.id, data.instructionPreview!.mechanicalHash)
                }
              >
                <ShieldCheckIcon className="size-3.5" />
                {trusted ? "Revoke trust" : "Trust mechanics"}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Mechanical hash <code>{data.instructionPreview.mechanicalHash}</code>. Trust pins these
            harness settings; you'll be re-prompted if they change.
          </p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {data.instructionPreview.instructions}
          </pre>
        </section>
      ) : null}

      {/* R4 duties — confirm on home environment (FR-16.4) */}
      {profile.type === "agent" && (profile.duties?.length ?? 0) > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <ClockIcon className="size-4 text-muted-foreground" />
            Duties
          </h2>
          <p className="text-xs text-muted-foreground">
            Confirmed duties may run on this environment when it is the agent&apos;s home. Changing
            a duty requires re-confirmation.
          </p>
          <div className="flex flex-col divide-y rounded-2xl border">
            {profile.duties.map((duty) => {
              const confirmed = isDutyConfirmed(profile.id, duty);
              return (
                <div
                  key={duty.id}
                  className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium text-foreground">
                        {duty.id}
                      </span>
                      <Badge variant={confirmed ? "success" : "warning"} size="sm">
                        {confirmed ? "Confirmed" : "Inert"}
                      </Badge>
                      {duty.enabled === false ? (
                        <Badge variant="outline" size="sm">
                          Disabled
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{duty.goal}</p>
                    <p className="text-xs text-muted-foreground">
                      {duty.schedule.kind === "daily"
                        ? `Daily at ${String(duty.schedule.hourUtc).padStart(2, "0")}:${String(duty.schedule.minuteUtc).padStart(2, "0")} UTC`
                        : `Every ${duty.schedule.everyMinutes} min`}{" "}
                      · reports to #{duty.reportChannelId}
                    </p>
                  </div>
                  {canWrite ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        confirmed
                          ? revokeDutyConfirmation(profile.id, duty.id)
                          : confirmDuty(profile.id, duty)
                      }
                    >
                      {confirmed ? "Revoke" : "Confirm duty"}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Recent threads (agents) */}
      {profile.type === "agent" && data.recentThreads.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Recent threads</h2>
          <div className="flex flex-col divide-y rounded-2xl border">
            {data.recentThreads.map((thread) => (
              <Link
                key={thread.threadId}
                to="/$environmentId/$threadId"
                params={{ environmentId: thread.environmentId, threadId: thread.threadId }}
                className="flex items-center gap-2 px-3 py-2 outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate text-sm text-foreground">{thread.title}</span>
                <span className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRelativeTimeLabel(thread.updatedAt)}
                </span>
                <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </TeamScreenShell>
  );
}
