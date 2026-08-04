import type {
  MemberAvatar as MemberAvatarData,
  MemberPresenceState,
  MemberType,
} from "@t3tools/contracts/team";

import { cn } from "~/lib/utils";
import { MemberAvatar, type MemberAvatarSize } from "./MemberAvatar";
import { PresenceDot, presenceStateLabel } from "./PresenceDot";

type MemberChipBadge = {
  label: string;
  tone?: "neutral" | "info";
};

type MemberChipProps = {
  memberId: string;
  displayName: string;
  memberType: MemberType;
  avatar?: MemberAvatarData | undefined;
  /** Omit (undefined) to hide presence entirely; null renders offline. */
  presence?: MemberPresenceState | null | undefined;
  showPresence?: boolean;
  /** e.g. { label: "borrowed" } or { label: "on julius-mbp" }. */
  badge?: MemberChipBadge | undefined;
  size?: MemberAvatarSize;
  className?: string;
};

/**
 * Compact member reference used in rows, cards, and mentions: avatar + name,
 * with optional presence and an optional context badge.
 */
export function MemberChip({
  memberId,
  displayName,
  memberType,
  avatar,
  presence,
  showPresence = false,
  badge,
  size = "sm",
  className,
}: MemberChipProps) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <MemberAvatar
        memberId={memberId}
        displayName={displayName}
        memberType={memberType}
        avatar={avatar}
        size={size}
      />
      <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
      {showPresence ? <PresenceDot state={presence} size="sm" className="ms-0.5" /> : null}
      {showPresence ? <span className="sr-only">{presenceStateLabel(presence)}</span> : null}
      {badge !== undefined ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[0.625rem] font-medium leading-4",
            badge.tone === "info"
              ? "bg-info/8 text-info-foreground dark:bg-info/16"
              : "bg-muted text-muted-foreground",
          )}
        >
          {badge.label}
        </span>
      ) : null}
    </span>
  );
}
