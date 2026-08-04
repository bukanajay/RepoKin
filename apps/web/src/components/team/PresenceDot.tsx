import type { MemberPresenceState } from "@t3tools/contracts/team";

import { cn } from "~/lib/utils";

const PRESENCE_LABELS: Record<MemberPresenceState, string> = {
  online: "Online",
  busy: "Busy",
  away: "Away",
  offline: "Offline",
};

const PRESENCE_DOT_CLASSES: Record<MemberPresenceState, string> = {
  online: "bg-(--team-presence-online)",
  busy: "bg-(--team-presence-busy)",
  away: "bg-(--team-presence-away)",
  offline: "bg-(--team-presence-offline)",
};

/** Stale or unknown presence collapses to offline — never a fifth state. */
export function resolvePresenceState(
  state: MemberPresenceState | null | undefined,
): MemberPresenceState {
  return state ?? "offline";
}

export function presenceStateLabel(state: MemberPresenceState | null | undefined): string {
  return PRESENCE_LABELS[resolvePresenceState(state)];
}

type PresenceDotProps = {
  state: MemberPresenceState | null | undefined;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Static presence dot. The only motion is the color transition when the
 * state itself changes; presence never animates continuously.
 */
export function PresenceDot({ state, size = "md", className }: PresenceDotProps) {
  const resolved = resolvePresenceState(state);
  return (
    <span
      role="img"
      aria-label={PRESENCE_LABELS[resolved]}
      data-presence={resolved}
      className={cn(
        "inline-flex shrink-0 rounded-full transition-colors duration-300 motion-reduce:transition-none",
        size === "sm" ? "size-1.5" : "size-2",
        PRESENCE_DOT_CLASSES[resolved],
        className,
      )}
    />
  );
}
