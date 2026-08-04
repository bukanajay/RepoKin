import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { AgentBadgeRow } from "./AgentBadgeRow";
import { AgentEditorDialog } from "./AgentEditorDialog";
import { MemberChip } from "./MemberChip";
import { PresenceDot, presenceStateLabel } from "./PresenceDot";
import { TeamScreenShell } from "./TeamScreenShell";
import { useTeamRosterActions } from "./useTeamRosterActions";
import { useTeamPeopleData, type TeamPersonRow } from "./useTeamPeopleData";

function PersonRow({ person }: { person: TeamPersonRow }) {
  return (
    <Link
      to="/team/people/$memberId"
      params={{ memberId: person.memberId }}
      className="flex items-center gap-3 px-3 py-2.5 outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MemberChip
        memberId={person.memberId}
        displayName={person.displayName}
        memberType={person.memberType}
        avatar={person.profile.avatar}
        size="md"
        badge={
          person.remoteEnvironmentLabel !== null
            ? { label: `on ${person.remoteEnvironmentLabel}`, tone: "info" }
            : undefined
        }
      />
      <div className="hidden min-w-0 flex-1 sm:block">
        {person.profile.type === "agent" ? (
          <AgentBadgeRow character={person.profile.character} />
        ) : null}
      </div>
      {person.ownerName !== null ? (
        <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
          runs for {person.ownerName}
        </span>
      ) : null}
      <span className="ms-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:ms-0">
        <PresenceDot state={person.presence} size="sm" />
        {presenceStateLabel(person.presence)}
      </span>
      <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
    </Link>
  );
}

export function TeamPeopleScreen() {
  const data = useTeamPeopleData();
  const { canWrite } = useTeamRosterActions();
  const [editorOpen, setEditorOpen] = useState(false);

  if (data.status !== "ready") {
    return (
      <TeamScreenShell title="People">
        {data.status === "loading" ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading the roster…
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.status === "no-environment"
              ? "Connect an environment to see the roster."
              : "Add a project to this environment to see its roster."}
          </p>
        )}
      </TeamScreenShell>
    );
  }

  return (
    <TeamScreenShell
      title="People"
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setEditorOpen(true)}>
            <PlusIcon className="size-4" />
            New agent
          </Button>
        ) : undefined
      }
    >
      <AgentEditorDialog open={editorOpen} onOpenChange={setEditorOpen} agent={null} />
      {data.warnings.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-xs text-warning-foreground">
          {data.warnings.length} roster {data.warnings.length === 1 ? "file" : "files"} could not be
          read: {data.warnings.join(", ")}
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Agents <span className="font-normal text-muted-foreground">({data.agents.length})</span>
        </h2>
        {data.agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents in this project's roster yet.</p>
        ) : (
          <div className="flex flex-col divide-y rounded-2xl border">
            {data.agents.map((person) => (
              <PersonRow key={person.memberId} person={person} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Humans <span className="font-normal text-muted-foreground">({data.humans.length})</span>
        </h2>
        {data.humans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No human profiles in this roster yet.</p>
        ) : (
          <div className="flex flex-col divide-y rounded-2xl border">
            {data.humans.map((person) => (
              <PersonRow key={person.memberId} person={person} />
            ))}
          </div>
        )}
      </section>
    </TeamScreenShell>
  );
}
