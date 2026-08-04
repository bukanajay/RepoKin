import type { MemberAvatar as MemberAvatarData, MemberType } from "@t3tools/contracts/team";
import { SparklesIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  IDENTICON_GRID_SIZE,
  deriveMemberAccentColor,
  identiconCells,
  memberInitials,
} from "./memberIdentity";

export type MemberAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<MemberAvatarSize, string> = {
  xs: "size-5 text-[0.5rem]",
  sm: "size-6 text-[0.625rem]",
  md: "size-8 text-xs",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
};

const GLYPH_WRAPPER_CLASSES: Record<MemberAvatarSize, string> = {
  xs: "hidden",
  sm: "hidden",
  md: "size-3.5 [&_svg]:size-2",
  lg: "size-4.5 [&_svg]:size-2.5",
  xl: "size-5.5 [&_svg]:size-3",
};

type MemberAvatarProps = {
  memberId: string;
  displayName: string;
  memberType: MemberType;
  avatar?: MemberAvatarData | undefined;
  size?: MemberAvatarSize;
  className?: string;
};

function AgentIdenticon({ memberId }: { memberId: string }) {
  const cells = identiconCells(memberId);
  return (
    <svg
      viewBox={`0 0 ${IDENTICON_GRID_SIZE} ${IDENTICON_GRID_SIZE}`}
      className="size-[62%] fill-(--team-identicon-foreground)"
      aria-hidden="true"
    >
      {cells.map((filled, index) =>
        filled ? (
          <rect
            key={index}
            x={index % IDENTICON_GRID_SIZE}
            y={Math.floor(index / IDENTICON_GRID_SIZE)}
            width={1}
            height={1}
          />
        ) : null,
      )}
    </svg>
  );
}

/**
 * Member identity mark. Humans render a photo or initials on their accent;
 * agents render a deterministic geometric identicon on their accent plus a
 * small AI glyph so an agent is never mistaken for a person. Humans are
 * circular, agents rounded-square — legible at every size.
 */
export function MemberAvatar({
  memberId,
  displayName,
  memberType,
  avatar,
  size = "md",
  className,
}: MemberAvatarProps) {
  const accentColor = deriveMemberAccentColor(memberId, avatar?.accentColor);
  const isAgent = memberType === "agent";
  const shapeClass = isAgent ? "rounded-[28%]" : "rounded-full";

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center font-semibold text-white",
        SIZE_CLASSES[size],
        shapeClass,
        className,
      )}
      style={{ backgroundColor: accentColor }}
      title={displayName}
    >
      {avatar?.imageUrl !== undefined ? (
        <img
          src={avatar.imageUrl}
          alt={displayName}
          className={cn("size-full object-cover", shapeClass)}
        />
      ) : isAgent ? (
        <AgentIdenticon memberId={memberId} />
      ) : (
        <span aria-hidden="true">{memberInitials(displayName)}</span>
      )}
      {isAgent ? (
        <span
          className={cn(
            "absolute -right-1 -bottom-1 flex items-center justify-center rounded-full border border-background bg-muted text-muted-foreground",
            GLYPH_WRAPPER_CLASSES[size],
          )}
          aria-label="AI agent"
          role="img"
        >
          <SparklesIcon />
        </span>
      ) : null}
    </span>
  );
}
