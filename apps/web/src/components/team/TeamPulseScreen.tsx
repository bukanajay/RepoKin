import { ActivityIcon } from "lucide-react";

import { teamEnvironment } from "../../state/team";
import { useEnvironmentQuery } from "../../state/query";
import { Spinner } from "../ui/spinner";
import { TeamScreenShell } from "./TeamScreenShell";
import { useTeamScope } from "./teamScope";

export function TeamPulseScreen() {
  const { environmentId, project } = useTeamScope();
  const atom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.repoPulse({
          environmentId,
          input: { cwd: project.workspaceRoot, days: 30 },
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
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Computing pulse from git history…
        </div>
      </TeamScreenShell>
    );
  }

  const pulse = query.data;

  return (
    <TeamScreenShell title="Pulse">
      <p className="text-xs text-muted-foreground">
        Last 30 days · {pulse.totalCommits} commits · human vs agent (RepoKin-Agent trailers)
      </p>

      <section className="grid gap-3 sm:grid-cols-2">
        <ContributorCard title="Humans" rows={pulse.humans} empty="No human-attributed commits." />
        <ContributorCard title="Agents" rows={pulse.agents} empty="No agent-attributed commits." />
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
            {pulse.hotspots.map((hotspot) => (
              <div key={hotspot.path} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {hotspot.path}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {hotspot.touches} · H{hotspot.humanTouches} / A{hotspot.agentTouches}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </TeamScreenShell>
  );
}

function ContributorCard({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: ReadonlyArray<{
    id: string;
    commits: number;
    additions: number;
    deletions: number;
  }>;
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border p-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">{row.id}</span>
              <span className="tabular-nums text-muted-foreground">
                {row.commits}c +{row.additions}/−{row.deletions}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
