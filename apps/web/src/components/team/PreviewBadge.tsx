import { FlaskConicalIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type PreviewBadgeProps = {
  className?: string;
};

/**
 * The fixture marker (implementation plan §0.3). Rendered on every surface
 * whose data hook is fixture-backed, so a design preview can never be
 * mistaken for live product. Removing this badge is part of a fixture's
 * scheduled death — never remove it while the hook still reads fixtures.
 */
export function PreviewBadge({ className }: PreviewBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="warning" size="sm" className={cn("gap-1", className)}>
            <FlaskConicalIcon />
            Preview
          </Badge>
        }
      />
      <TooltipPopup side="bottom" className="max-w-72">
        This screen renders example data. Interactions work but nothing is saved — the live version
        ships in a later release.
      </TooltipPopup>
    </Tooltip>
  );
}
