import { SettingsIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { APP_BASE_NAME } from "../../branding";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <SidebarTrigger
        className={cn(
          "relative z-10 md:hidden",
          backdropVariant &&
            "[:hover,[data-pressed]]:bg-white/15 focus-visible:ring-white/90 focus-visible:ring-offset-blue-700 [&_svg]:stroke-white/90! [&_svg]:opacity-100! [&_svg]:hover:stroke-white!",
        )}
      />
      <SidebarBrand onBackdrop={backdropVariant !== null} />
      {pillLabel ? (
        <Badge
          className="relative z-10 ml-1 rounded-full px-1.5 text-muted-foreground"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
    </SidebarHeader>
  );
});

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <Link
      aria-label={`${APP_BASE_NAME} — go to threads`}
      className={cn(
        "sidebar-brand relative z-10 ml-[var(--workspace-titlebar-content-left)] h-7 w-fit min-w-0 shrink-0 items-center gap-1.5 overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <AgentForgeMark />
      <span
        className={cn(
          "truncate text-sm font-semibold tracking-tight",
          onBackdrop ? "text-white" : "text-foreground",
        )}
      >
        {APP_BASE_NAME}
      </span>
    </Link>
  );
}

/** Monochrome mark for the sidebar brand (uses currentColor). */
function AgentForgeMark() {
  return (
    <svg
      aria-hidden
      className="size-5 shrink-0"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Anvil + A monogram */}
      <path
        d="M6.5 21.5c0-.8.4-1.5 1.1-1.9l4.2-2.3V13.8L8.4 11.2c-.7-.5-1-1.3-.8-2.1.2-.8.8-1.4 1.6-1.6L16 5.8l6.8 1.7c.8.2 1.4.8 1.6 1.6.2.8-.1 1.6-.8 2.1L20.2 13.8v3.5l4.2 2.3c.7.4 1.1 1.1 1.1 1.9v1.2H6.5v-1.2Z"
        fill="currentColor"
        opacity="0.22"
      />
      <path
        d="M16 7.2 9.8 8.8c-.25.06-.4.3-.34.54.04.16.15.28.3.36L14.2 12v4.4l-4.6 2.5c-.22.12-.35.35-.35.6v.7h13.5v-.7c0-.25-.13-.48-.35-.6L17.8 16.4V12l4.44-2.3c.15-.08.26-.2.3-.36.06-.24-.09-.48-.34-.54L16 7.2Z"
        fill="currentColor"
      />
      <path
        d="M16 9.4 13.1 14.8h1.55l.55-1.1h1.6l.55 1.1H19L16 9.4Zm0 2.05.55 1.15h-1.1l.55-1.15Z"
        fill="currentColor"
        opacity="0.92"
      />
      {/* Spark */}
      <path
        d="M23.2 8.2 24 6.4l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleSettingsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/settings" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarFooter className="p-[var(--sidebar-content-inset)]">
      <SidebarProviderUpdatePill />
      <SidebarUpdatePill />
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={handleSettingsClick}>
            <SettingsIcon />
            <span>Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
});
