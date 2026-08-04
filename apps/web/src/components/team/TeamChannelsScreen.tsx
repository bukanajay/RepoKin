import { Link } from "@tanstack/react-router";
import { HashIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Spinner } from "../ui/spinner";
import { MemberAvatar } from "./MemberAvatar";
import { TeamScreenShell } from "./TeamScreenShell";
import { useChannelsData } from "./useChannelsData";

export function TeamChannelsScreen() {
  const data = useChannelsData();

  if (data.status !== "ready") {
    return (
      <TeamScreenShell title="Channels">
        {data.status === "loading" ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading channels…
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.status === "no-environment"
              ? "Connect an environment to see channels."
              : "Add a project to this environment to see its channels."}
          </p>
        )}
      </TeamScreenShell>
    );
  }

  if (data.channels.length === 0) {
    return (
      <TeamScreenShell title="Channels">
        <p className="text-sm text-muted-foreground">
          No channels yet. Declare one under <code>.repokin/channels/</code>.
        </p>
      </TeamScreenShell>
    );
  }

  return (
    <TeamScreenShell title="Channels">
      <div className="flex flex-col divide-y rounded-2xl border">
        {data.channels.map((channel) => (
          <Link
            key={channel.channelId}
            to="/team/channels/$channelId"
            params={{ channelId: channel.slug }}
            className="flex items-center gap-3 px-3 py-3 outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HashIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold text-foreground">{channel.name}</span>
              <span className="truncate text-xs text-muted-foreground">{channel.description}</span>
            </div>
            <div className="flex shrink-0 -space-x-1.5">
              {channel.memberIds.slice(0, 4).map((memberId) => {
                const member = data.memberById.get(memberId);
                return member !== undefined ? (
                  <MemberAvatar
                    key={memberId}
                    memberId={member.memberId}
                    displayName={member.displayName}
                    memberType={member.memberType}
                    size="xs"
                    className="ring-2 ring-background"
                  />
                ) : null;
              })}
            </div>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {channel.lastPostAt !== null ? formatRelativeTimeLabel(channel.lastPostAt) : "—"}
            </span>
          </Link>
        ))}
      </div>
    </TeamScreenShell>
  );
}
