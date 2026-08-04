import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CheckIcon, InboxIcon, XIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { MemberChip } from "./MemberChip";
import { TeamScreenShell } from "./TeamScreenShell";
import { useTeamScope } from "./teamScope";
import { useTeamInboxData, type TeamInboxData, type TeamInboxItem } from "./useTeamInboxData";

function SenderChip({ memberId, data }: { memberId: string; data: TeamInboxData }) {
  const summary = data.memberSummaryById.get(memberId);
  if (summary === undefined) {
    return <span className="text-sm font-medium text-foreground">{memberId}</span>;
  }
  return (
    <MemberChip
      memberId={summary.memberId}
      displayName={summary.displayName}
      memberType={summary.memberType}
      avatar={summary.avatar}
    />
  );
}

function ThreadLink({ threadId }: { threadId: string }) {
  const { environmentId } = useTeamScope();
  if (environmentId === null) return null;
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId, threadId }}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      Open thread
      <ArrowRightIcon className="size-3" />
    </Link>
  );
}

function stateBadge(item: TeamInboxItem) {
  const state = item.kind === "message" ? item.message.state : item.request.state;
  const variant =
    state === "expired" || state === "declined"
      ? ("warning" as const)
      : state === "read" || state === "accepted"
        ? ("success" as const)
        : ("secondary" as const);
  return (
    <Badge variant={variant} size="sm" className="capitalize">
      {state}
    </Badge>
  );
}

function InboxItemRow({
  item,
  data,
  actionable,
}: {
  item: TeamInboxItem;
  data: TeamInboxData;
  actionable: boolean;
}) {
  if (item.kind === "message") {
    const message = item.message;
    return (
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <SenderChip memberId={message.senderId} data={data} />
          <span className="text-xs text-muted-foreground">sent a message</span>
          {stateBadge(item)}
          <time
            dateTime={message.sentAt}
            className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground/80"
          >
            {formatRelativeTimeLabel(message.sentAt)}
          </time>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {message.body}
        </p>
        <div className="flex items-center gap-3">
          {message.threadId !== null ? <ThreadLink threadId={message.threadId} /> : null}
          {actionable ? (
            <Button size="xs" variant="outline" onClick={() => void data.markMessageRead(message)}>
              <CheckIcon className="size-3.5" />
              Mark read
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const request = item.request;
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <SenderChip memberId={request.fromMemberId} data={data} />
        <span className="text-xs text-muted-foreground">
          requested a {request.kind === "review" ? "review" : "handoff"}
        </span>
        {stateBadge(item)}
        <time
          dateTime={request.createdAt}
          className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground/80"
        >
          {formatRelativeTimeLabel(request.createdAt)}
        </time>
      </div>
      {request.message !== null ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {request.message}
        </p>
      ) : null}
      {request.responseMessage !== null ? (
        <p className="text-xs text-muted-foreground">Response: {request.responseMessage}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <ThreadLink threadId={request.threadId} />
        {actionable ? (
          <>
            <Button size="xs" onClick={() => void data.respondToRequest(request, "accepted")}>
              <CheckIcon className="size-3.5" />
              Accept
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void data.respondToRequest(request, "declined")}
            >
              <XIcon className="size-3.5" />
              Decline
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function TeamInboxScreen() {
  const data = useTeamInboxData();

  if (data.status !== "ready") {
    return (
      <TeamScreenShell title="Inbox">
        {data.status === "loading" ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading inbox…
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.status === "no-environment"
              ? "Connect an environment to see your inbox."
              : "Add a project to this environment to see its inbox."}
          </p>
        )}
      </TeamScreenShell>
    );
  }

  const itemKey = (item: TeamInboxItem) =>
    item.kind === "message" ? `m:${item.message.messageId}` : `r:${item.request.requestId}`;

  return (
    <TeamScreenShell title="Inbox">
      {data.openItems.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed px-3 py-6 text-sm text-muted-foreground">
          <InboxIcon className="size-4" />
          Nothing needs you right now.
        </div>
      ) : (
        <div className="flex flex-col divide-y rounded-2xl border">
          {data.openItems.map((item) => (
            <InboxItemRow key={itemKey(item)} item={item} data={data} actionable />
          ))}
        </div>
      )}

      {data.settledItems.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">History</h2>
          <div className="flex flex-col divide-y rounded-2xl border opacity-80">
            {data.settledItems.map((item) => (
              <InboxItemRow key={itemKey(item)} item={item} data={data} actionable={false} />
            ))}
          </div>
        </section>
      ) : null}
    </TeamScreenShell>
  );
}
