import { RadarIcon } from "lucide-react";

import { MemberAvatar } from "./MemberAvatar";
import { TeamScreenShell } from "./TeamScreenShell";
import { useWorkMapData, type WorkMapData } from "./useWorkMapData";

function MapTile({ data, index }: { data: WorkMapData; index: number }) {
  const node = data.nodes[index]!;
  return (
    <div
      className="group relative flex min-h-20 flex-col justify-between overflow-hidden rounded-xl border bg-muted/30 p-2.5 transition-colors hover:bg-muted/55"
      style={{ flexGrow: node.weight, flexBasis: `${node.weight * 2}%` }}
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

  return (
    <TeamScreenShell title="Work map" preview={data.isPreview}>
      {/* Static treemap: area follows activity weight; nothing animates at rest. */}
      <div className="flex flex-wrap gap-2">
        {data.nodes.map((node, index) => (
          <MapTile key={node.path} data={data} index={index} />
        ))}
      </div>

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
