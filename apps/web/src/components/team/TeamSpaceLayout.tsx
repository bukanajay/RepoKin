import {
  ActivityIcon,
  FileTextIcon,
  HeartPulseIcon,
  HomeIcon,
  HashIcon,
  InboxIcon,
  KanbanSquareIcon,
  MapIcon,
  UsersIcon,
} from "lucide-react";
import { Link, Outlet } from "@tanstack/react-router";

import { isElectron } from "../../env";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { SidebarInset } from "../ui/sidebar";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { TeamScopeProvider, useTeamScope } from "./teamScope";

const TEAM_NAV_ITEMS = [
  { to: "/team", label: "Home", icon: HomeIcon, exact: true },
  { to: "/team/people", label: "People", icon: UsersIcon },
  { to: "/team/activity", label: "Activity", icon: ActivityIcon },
  { to: "/team/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/team/channels", label: "Channels", icon: HashIcon },
  { to: "/team/board", label: "Board", icon: KanbanSquareIcon },
  { to: "/team/map", label: "Map", icon: MapIcon },
  { to: "/team/decisions", label: "Decisions", icon: FileTextIcon },
  { to: "/team/pulse", label: "Pulse", icon: HeartPulseIcon },
] as const;

function TeamProjectSelector() {
  const { projects, project, selectProject } = useTeamScope();
  if (projects.length === 0) return null;

  return (
    <Select
      value={project?.workspaceRoot ?? ""}
      onValueChange={(value) => {
        if (typeof value === "string" && value.length > 0) selectProject(value);
      }}
    >
      <SelectTrigger size="sm" className="max-w-56" aria-label="Team project scope">
        <SelectValue>{project?.title ?? "Select project"}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {projects.map((candidate) => (
          <SelectItem key={candidate.workspaceRoot} value={candidate.workspaceRoot}>
            {candidate.title}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function TeamNavRail() {
  return (
    <nav
      aria-label="Team space"
      className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5 sm:w-44 sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:px-2 sm:py-3"
    >
      {TEAM_NAV_ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: "exact" in item && item.exact }}
          className="flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          activeProps={{
            className: "bg-muted text-foreground",
            "aria-current": "page",
          }}
        >
          <item.icon className="size-4 shrink-0" />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function TeamSpaceContent() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header
            className={cn(
              "workspace-topbar px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
              COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
            )}
          >
            <div className="flex w-full items-center gap-2">
              <span className="text-sm font-medium text-foreground">Team</span>
              <div className="ms-auto flex items-center gap-2">
                <TeamProjectSelector />
              </div>
            </div>
          </header>
        )}

        {isElectron && (
          <div
            className={cn(
              "drag-region flex h-[52px] shrink-0 items-center px-5 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
              COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
            )}
          >
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">Team</span>
            <div className="no-drag-region ms-auto flex items-center gap-2">
              <TeamProjectSelector />
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <TeamNavRail />
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export function TeamSpaceLayout() {
  return (
    <TeamScopeProvider>
      <TeamSpaceContent />
    </TeamScopeProvider>
  );
}
