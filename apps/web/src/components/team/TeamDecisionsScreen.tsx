import { FileTextIcon } from "lucide-react";
import { useMemo } from "react";

import { teamEnvironment } from "../../state/team";
import { useEnvironmentQuery } from "../../state/query";
import { Spinner } from "../ui/spinner";
import { TeamScreenShell } from "./TeamScreenShell";
import { useTeamScope } from "./teamScope";

export function TeamDecisionsScreen() {
  const { environmentId, project } = useTeamScope();
  const atom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.listDecisions({
          environmentId,
          input: { cwd: project.workspaceRoot },
        });
  const query = useEnvironmentQuery(atom);

  const decisions = useMemo(() => query.data?.decisions ?? [], [query.data]);

  if (environmentId === null || project === null) {
    return (
      <TeamScreenShell title="Decisions">
        <p className="text-sm text-muted-foreground">
          Connect an environment and select a project to browse decision records.
        </p>
      </TeamScreenShell>
    );
  }

  if (query.data === null) {
    return (
      <TeamScreenShell title="Decisions">
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading decisions…
        </div>
      </TeamScreenShell>
    );
  }

  return (
    <TeamScreenShell title="Decisions">
      <p className="text-xs text-muted-foreground">
        Promoted records under <code>.repokin/decisions/</code> (FR-17.1). Promote a channel post
        from the channel view.
      </p>
      {decisions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-12 text-center">
          <FileTextIcon className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No decision records yet.</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y rounded-2xl border">
          {decisions.map((decision) => (
            <article key={decision.id} className="flex flex-col gap-1 px-3 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{decision.title}</h2>
                <span className="ms-auto font-mono text-[0.625rem] text-muted-foreground">
                  {decision.path}
                </span>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {decision.body}
              </p>
              <p className="text-xs text-muted-foreground">
                Promoted by {decision.promotedById} · origin {decision.origin.kind}
              </p>
            </article>
          ))}
        </div>
      )}
    </TeamScreenShell>
  );
}
