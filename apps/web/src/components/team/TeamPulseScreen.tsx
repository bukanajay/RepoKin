import { ActivityIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { teamEnvironment } from "../../state/team";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { TeamScreenShell } from "./TeamScreenShell";
import { useTeamScope } from "./teamScope";

const DAY_OPTIONS = [7, 30, 90] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

export function TeamPulseScreen() {
  const { environmentId, project } = useTeamScope();
  const [days, setDays] = useState<DayOption>(30);
  const atom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.repoPulse({
          environmentId,
          input: { cwd: project.workspaceRoot, days },
        });
  const query = useEnvironmentQuery(atom);

  if (environmentId === null || project === null) {
    return (
      <TeamScreenShell title="Pulse">
        <p className="text-sm text-muted-foreground">
          Connect an environment and select a project to view repo pulse.
        </p>
      </TeamScreenShell>
    );
  }

  if (query.data === null) {
    return (
      <TeamScreenShell title="Pulse">
        <div className="flex flex-col gap-3">
          <DayRangePicker days={days} onChange={setDays} />
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Computing pulse from git history…
          </div>
        </div>
      </TeamScreenShell>
    );
  }

  const pulse = query.data;
  const humanCommits = pulse.humans.reduce((sum, row) => sum + row.commits, 0);
  const agentCommits = pulse.agents.reduce((sum, row) => sum + row.commits, 0);
  const unknownCommits = pulse.unknown.reduce((sum, row) => sum + row.commits, 0);
  const splitTotal = humanCommits + agentCommits + unknownCommits;

  return (
    <TeamScreenShell title="Pulse">
      <div className="flex flex-wrap items-center gap-3">
        <DayRangePicker days={days} onChange={setDays} />
        <p className="text-xs text-muted-foreground">
          {pulse.totalCommits} commits · human vs agent (RepoKin-Agent trailers)
        </p>
      </div>

      <section className="flex flex-col gap-2 rounded-2xl border p-3">
        <h2 className="text-sm font-semibold text-foreground">Contribution split</h2>
        {splitTotal === 0 ? (
          <p className="text-xs text-muted-foreground">No commits in this window.</p>
        ) : (
          <>
            <div
              className="flex h-3 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`Humans ${humanCommits}, agents ${agentCommits}, unknown ${unknownCommits}`}
            >
              {humanCommits > 0 ? (
                <div
                  className="bg-sky-500/80 transition-[width]"
                  style={{ width: `${(humanCommits / splitTotal) * 100}%` }}
                />
              ) : null}
              {agentCommits > 0 ? (
                <div
                  className="bg-emerald-500/80 transition-[width]"
                  style={{ width: `${(agentCommits / splitTotal) * 100}%` }}
                />
              ) : null}
              {unknownCommits > 0 ? (
                <div
                  className="bg-muted-foreground/40 transition-[width]"
                  style={{ width: `${(unknownCommits / splitTotal) * 100}%` }}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <LegendSwatch className="bg-sky-500/80" label={`Humans ${humanCommits}`} />
              <LegendSwatch className="bg-emerald-500/80" label={`Agents ${agentCommits}`} />
              {unknownCommits > 0 ? (
                <LegendSwatch
                  className="bg-muted-foreground/40"
                  label={`Unknown ${unknownCommits}`}
                />
              ) : null}
            </div>
          </>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <ContributorCard
          title="Humans"
          barClassName="bg-sky-500/80"
          rows={pulse.humans}
          empty="No human-attributed commits."
        />
        <ContributorCard
          title="Agents"
          barClassName="bg-emerald-500/80"
          rows={pulse.agents}
          empty="No agent-attributed commits."
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <ActivityIcon className="size-4 text-muted-foreground" />
          Hot spots
        </h2>
        {pulse.hotspots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No path activity in this window.</p>
        ) : (
          <div className="flex flex-col divide-y rounded-2xl border">
            {pulse.hotspots.map((hotspot) => {
              const maxTouches = Math.max(...pulse.hotspots.map((entry) => entry.touches), 1);
              const humanPct =
                hotspot.touches > 0 ? (hotspot.humanTouches / hotspot.touches) * 100 : 0;
              const agentPct =
                hotspot.touches > 0 ? (hotspot.agentTouches / hotspot.touches) * 100 : 0;
              return (
                <div key={hotspot.path} className="flex flex-col gap-1.5 px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                      {hotspot.path}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {hotspot.touches} · H{hotspot.humanTouches} / A{hotspot.agentTouches}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="flex h-full"
                      style={{ width: `${(hotspot.touches / maxTouches) * 100}%` }}
                    >
                      {humanPct > 0 ? (
                        <div className="bg-sky-500/80" style={{ width: `${humanPct}%` }} />
                      ) : null}
                      {agentPct > 0 ? (
                        <div className="bg-emerald-500/80" style={{ width: `${agentPct}%` }} />
                      ) : null}
                      {humanPct + agentPct < 100 ? (
                        <div
                          className="bg-muted-foreground/30"
                          style={{ width: `${100 - humanPct - agentPct}%` }}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </TeamScreenShell>
  );
}

function DayRangePicker({
  days,
  onChange,
}: {
  days: DayOption;
  onChange: (days: DayOption) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg border p-0.5"
      role="group"
      aria-label="Pulse window"
    >
      {DAY_OPTIONS.map((option) => (
        <Button
          key={option}
          type="button"
          size="xs"
          variant={days === option ? "secondary" : "ghost"}
          className="min-w-10"
          onClick={() => onChange(option)}
          aria-pressed={days === option}
        >
          {option}d
        </Button>
      ))}
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2.5 shrink-0 rounded-sm ${className}`} aria-hidden />
      {label}
    </span>
  );
}

function ContributorCard({
  title,
  rows,
  empty,
  barClassName,
}: {
  title: string;
  rows: ReadonlyArray<{
    id: string;
    commits: number;
    additions: number;
    deletions: number;
  }>;
  empty: string;
  barClassName: string;
}) {
  const maxCommits = useMemo(() => Math.max(...rows.map((row) => row.commits), 1), [rows]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border p-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono text-foreground">{row.id}</span>
                <span className="tabular-nums text-muted-foreground">
                  {row.commits}c +{row.additions}/−{row.deletions}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${barClassName}`}
                  style={{ width: `${(row.commits / maxCommits) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
