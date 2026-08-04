import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { PreviewBadge } from "./PreviewBadge";

type TeamScreenShellProps = {
  title: string;
  /** Marks the surface as fixture-backed (implementation plan §0.3). */
  preview?: boolean;
  /** Header-trailing actions. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Shared page chrome for Team space screens: title row + content region. */
export function TeamScreenShell({
  title,
  preview = false,
  actions,
  children,
  className,
}: TeamScreenShellProps) {
  return (
    <div
      className={cn("mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6", className)}
    >
      <div className="flex items-center gap-2.5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        {preview ? <PreviewBadge /> : null}
        {actions !== undefined ? (
          <div className="ms-auto flex items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
