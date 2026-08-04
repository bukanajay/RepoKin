import type { ReactNode } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "~/lib/utils";

type ActivityRowProps = {
  /** Actor rendering: usually a MemberChip; falls back to "System" styling. */
  actor: ReactNode;
  /** Past-tense verb phrase: "assigned", "sent a message to", … */
  verb: string;
  /** Object of the sentence: a link to a thread, member, or request. */
  object?: ReactNode;
  /** ISO timestamp; rendered as a relative label with the full time on hover. */
  occurredAt: string;
  className?: string;
};

/**
 * One timeline row: actor chip · verb · object link · timestamp. The feed and
 * the Home recent-activity rail both compose this.
 */
export function ActivityRow({ actor, verb, object, occurredAt, className }: ActivityRowProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 py-1.5", className)}>
      <span className="flex min-w-0 shrink-0 items-center">{actor}</span>
      <span className="shrink-0 text-sm text-muted-foreground">{verb}</span>
      {object !== undefined ? (
        <span className="min-w-0 truncate text-sm text-foreground">{object}</span>
      ) : null}
      <time
        dateTime={occurredAt}
        title={new Date(occurredAt).toLocaleString()}
        className="ms-auto shrink-0 ps-2 text-xs tabular-nums text-muted-foreground/80"
      >
        {formatRelativeTimeLabel(occurredAt)}
      </time>
    </div>
  );
}
