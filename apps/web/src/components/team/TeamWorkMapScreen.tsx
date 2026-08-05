import { MapIcon, RadarIcon } from "lucide-react";

import { MemberAvatar } from "./MemberAvatar";
import { Spinner } from "../ui/spinner";
import { TeamScreenShell } from "./TeamScreenShell";
import { useWorkMapData, type WorkMapData } from "./useWorkMapData";

function MapTile({ data, index }: { data: WorkMapData; index: number }) {
  const node = data.nodes[index]!;
  return (
    <div
      className="group relative flex min-h-20 flex-col justify-between overflow-hidden rounded-xl border bg-muted/30 p-2.5 transition-colors hover:bg-muted/55"
      style={{ flexGrow: node.weight, flexBasis: `${Math.max(node.weight, 1) * 2}%` }}
      title={node.path}
    >
      <span className="truncate font-mono text-xs font-medium text-foreground">{node.label}</span>
      <div className="flex items-center gap-1">
        <div className="flex -space-x-1">
          {node.memberIds.map((memberId) => {
            const member = data.memberById.get(memberId);
            return member !== undefined ? (
              <MemberAvatar
                key={memberId}
                memberId={member.memberId}
                displayName={member.displayName}
                memberType={member.memberType}
                size="xs"
                className="ring-2 ring-background"
              />
            ) : null;
          })}
        </div>
        <span className="ms-auto text-[0.625rem] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {node.weight} touches
        </span>
      </div>
    </div>
  );
}

export function TeamWorkMapScreen() {
  const data = useWorkMapData();

  if (data.status !== "ready") {
    return (
      <TeamScreenShell title="Work map" preview={false}>
        {data.status === "loading" ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading work map…
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.status === "no-environment"
              ? "Connect an environment to see the work map."
              : "Add a project to this environment to see the work map."}
          </p>
        )}
      </TeamScreenShell>
    );
  }

  return (
    <TeamScreenShell title="Work map" preview={false}>
      {!data.sharingEnabled ? (
        <p className="rounded-xl border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Work-location sharing is off on this environment. Teammates cannot see where you are
          working; you still see any signals they publish. Toggle it under Settings → RepoKin.
        </p>
      ) : null}

      {/* Static treemap: area follows activity weight; nothing animates at rest (NFR-2). */}
      {data.nodes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-12 text-center">
          <MapIcon className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No active work locations yet. Edit files or run an agent thread to light up the map.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.nodes.map((node, index) => (
            <MapTile key={node.path} data={data} index={index} />
          ))}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <RadarIcon className="size-4 text-muted-foreground" />
          Radar
        </h2>
        {data.overlaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No overlapping work detected.</p>
        ) : (
          <div className="flex flex-col divide-y rounded-2xl border">
            {data.overlaps.map((overlap) => (
              <div key={overlap.path} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex shrink-0 -space-x-1">
                  {overlap.memberIds.map((memberId) => {
                    const member = data.memberById.get(memberId);
                    return member !== undefined ? (
                      <MemberAvatar
                        key={memberId}
                        memberId={member.memberId}
                        displayName={member.displayName}
                        memberType={member.memberType}
                        size="sm"
                        className="ring-2 ring-background"
                      />
                    ) : null;
                  })}
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {overlap.path}
                  </span>
                  <span className="text-sm text-foreground">{overlap.note}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </TeamScreenShell>
  );
}
