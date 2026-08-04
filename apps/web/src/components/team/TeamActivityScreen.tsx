import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Spinner } from "../ui/spinner";
import { ActivityRow } from "./ActivityRow";
import { MemberChip } from "./MemberChip";
import { TeamScreenShell } from "./TeamScreenShell";
import { cn } from "~/lib/utils";
import { useTeamScope } from "./teamScope";
import { useTeamActivityData, type TeamActivityFilter } from "./useTeamActivityData";

const FILTERS: ReadonlyArray<{ value: TeamActivityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "threads", label: "Threads" },
  { value: "messages", label: "Messages" },
  { value: "requests", label: "Requests" },
  { value: "members", label: "Members" },
];

export function TeamActivityScreen() {
  const [filter, setFilter] = useState<TeamActivityFilter>("all");
  const data = useTeamActivityData(filter);
  const { environmentId } = useTeamScope();

  return (
    <TeamScreenShell
      title="Activity"
      actions={
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Activity filter">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                filter === option.value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
    >
      {data.status !== "ready" ? (
        data.status === "loading" ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading activity…
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.status === "no-environment"
              ? "Connect an environment to see team activity."
              : "Add a project to this environment to see its activity."}
          </p>
        )
      ) : data.activities.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No team activity {filter === "all" ? "yet" : "for this filter"}.
        </p>
      ) : (
        <div className="flex flex-col divide-y rounded-2xl border px-3">
          {data.activities.map((activity) => {
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
                object={
                  activity.threadId !== null && environmentId !== null ? (
                    <Link
                      to="/$environmentId/$threadId"
                      params={{ environmentId, threadId: activity.threadId }}
                      className="text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      open thread
                    </Link>
                  ) : undefined
                }
                occurredAt={activity.occurredAt}
              />
            );
          })}
        </div>
      )}
    </TeamScreenShell>
  );
}
