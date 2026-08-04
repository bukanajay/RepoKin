import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Card } from "../ui/card";

type TeamCardProps = {
  /** Member or surface accent painted as the card's leading edge. */
  accentColor?: string | undefined;
  /** Header row content: usually a MemberChip or a title with icons. */
  header?: ReactNode;
  /**
   * Deep-link affordance rendered at the header's trailing edge — pass a
   * router Link (or button); the card stays router-agnostic.
   */
  deepLink?: ReactNode;
  /** Live-state slot under the body: status line, presence, progress. */
  liveState?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * Base card for the Team space. Thread, diff, task, and digest cards are
 * composition variants of this one shell: accent edge, header row, body,
 * live-state slot.
 */
export function TeamCard({
  accentColor,
  header,
  deepLink,
  liveState,
  children,
  className,
}: TeamCardProps) {
  return (
    <Card
      className={cn("gap-0 overflow-hidden p-0", className)}
      style={
        accentColor !== undefined
          ? { borderLeft: "var(--team-card-accent-width) solid " + accentColor }
          : undefined
      }
    >
      {header !== undefined || deepLink !== undefined ? (
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
          {deepLink !== undefined ? <div className="shrink-0">{deepLink}</div> : null}
        </div>
      ) : null}
      {children !== undefined ? (
        <div className="min-w-0 px-3 pb-2.5 text-sm text-foreground">{children}</div>
      ) : null}
      {liveState !== undefined ? (
        <div className="border-t bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          {liveState}
        </div>
      ) : null}
    </Card>
  );
}
