import type { Character } from "@t3tools/contracts/team";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { deriveAgentBadges } from "./agentBadges";

type AgentBadgeRowProps = {
  character: Character;
  className?: string;
};

/**
 * Mechanical facts as badges: provider/model, runtime mode, path scope, tool
 * policy summary. These are harness-enforced settings, so they render as
 * plain facts — never styled as suggestions.
 */
export function AgentBadgeRow({ character, className }: AgentBadgeRowProps) {
  const badges = deriveAgentBadges(character);
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {badges.map((badge) =>
        badge.detail !== undefined ? (
          <Tooltip key={badge.key}>
            <TooltipTrigger
              render={
                <Badge variant="outline" size="sm">
                  {badge.label}
                </Badge>
              }
            />
            <TooltipPopup>{badge.detail}</TooltipPopup>
          </Tooltip>
        ) : (
          <Badge key={badge.key} variant="outline" size="sm">
            {badge.label}
          </Badge>
        ),
      )}
    </span>
  );
}
