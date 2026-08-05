import { MemberId, PostId, ChannelId as TeamChannelId } from "@t3tools/contracts/team";
import { useCallback, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LegendList } from "@legendapp/list/react";
import {
  ArrowLeftIcon,
  FileDiffIcon,
  FileTextIcon,
  GitCommitIcon,
  KanbanSquareIcon,
  MessageSquareIcon,
  NewspaperIcon,
  SendIcon,
  ZapIcon,
} from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { teamEnvironment } from "../../state/team";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { MemberChip } from "./MemberChip";
import { TeamCard } from "./TeamCard";
import { TeamScreenShell } from "./TeamScreenShell";
import { deriveMemberAccentColor } from "./memberIdentity";
import { useTeamScope } from "./teamScope";
import {
  useChannelData,
  type ChannelData,
  type ChannelGap,
  type ChannelPost,
  type ChannelTimelineItem,
} from "./useChannelData";

function PostBody({ post }: { post: ChannelPost }) {
  switch (post.kind) {
    case "text":
      return (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{post.body}</p>
      );
    case "thread-card":
      return (
        <TeamCard
          accentColor={deriveMemberAccentColor(post.authorId)}
          header={
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <MessageSquareIcon className="size-3.5 text-muted-foreground" />
              {post.title}
            </span>
          }
          liveState={<span>{post.status}</span>}
        />
      );
    case "diff-card":
      return (
        <TeamCard
          accentColor={deriveMemberAccentColor(post.authorId)}
          header={
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <FileDiffIcon className="size-3.5 text-muted-foreground" />
              {post.title}
            </span>
          }
        >
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-success-foreground">+{post.additions}</span>
            <span className="font-medium text-destructive">−{post.deletions}</span>
            <span>{post.changedFiles} files</span>
            <Badge variant="outline" size="sm" className="font-mono">
              {post.branch}
            </Badge>
          </span>
        </TeamCard>
      );
    case "task-card":
      return (
        <TeamCard
          accentColor={deriveMemberAccentColor(post.authorId)}
          header={
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <KanbanSquareIcon className="size-3.5 text-muted-foreground" />
              {post.title}
            </span>
          }
          liveState={<span className="capitalize">{post.taskState.replace("-", " ")}</span>}
        />
      );
    case "event":
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ZapIcon className="size-3" />
          {post.summary}
        </p>
      );
    case "digest":
      return (
        <TeamCard
          accentColor={deriveMemberAccentColor(post.authorId)}
          header={
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <NewspaperIcon className="size-3.5 text-muted-foreground" />
              {post.title}
            </span>
          }
        >
          <ul className="list-disc space-y-0.5 ps-4 text-sm text-muted-foreground">
            {post.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </TeamCard>
      );
  }
}

function keyExtractor(item: ChannelTimelineItem) {
  return item.kind === "gap" ? item.gapId : item.postId;
}

// Item type feeds LegendList's view recycling — one recycle pool per kind.
function getItemType(item: ChannelTimelineItem) {
  return item.kind;
}

function gapLabel(gap: ChannelGap): string {
  if (gap.missedCount !== null && gap.missedCount > 0) {
    return gap.missedCount === 1
      ? "1 post may have been missed while offline"
      : `${gap.missedCount} posts may have been missed while offline`;
  }
  return "Some posts may have been missed while offline";
}

function GapRow({ gap }: { gap: ChannelGap }) {
  // Honest delivery state (NFR-5 / PRD Q7) — no animation, no spinner.
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-border/40 py-3 text-xs text-muted-foreground"
    >
      <span className="h-px flex-1 bg-border/70" aria-hidden />
      <span className="shrink-0 rounded-full border border-border/70 bg-muted/40 px-2.5 py-0.5">
        {gapLabel(gap)}
      </span>
      <span className="h-px flex-1 bg-border/70" aria-hidden />
    </div>
  );
}

function PostRow({
  post,
  data,
  onPromote,
}: {
  post: ChannelPost;
  data: ChannelData;
  onPromote?: (post: ChannelPost) => void;
}) {
  const author = data.memberById.get(post.authorId);
  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 py-3">
      <div className="flex items-center gap-2">
        {author !== undefined ? (
          <MemberChip
            memberId={author.memberId}
            displayName={author.displayName}
            memberType={author.memberType}
          />
        ) : (
          <span className="text-sm font-medium text-foreground">{post.authorId}</span>
        )}
        <time
          dateTime={post.postedAt}
          className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground/80"
        >
          {formatRelativeTimeLabel(post.postedAt)}
        </time>
        {post.kind === "text" && onPromote !== undefined ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="shrink-0"
            title="Promote to decision record"
            onClick={() => onPromote(post)}
          >
            <FileTextIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="ps-8">
        <PostBody post={post} />
      </div>
    </div>
  );
}

type PromoteDraft = {
  post: ChannelPost & { kind: "text" };
  title: string;
  commit: boolean;
};

function defaultPromoteTitle(body: string): string {
  return (
    body
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim()
      .slice(0, 80) ?? "Decision"
  );
}

export function TeamChannelScreen({ channelId }: { channelId: string }) {
  const data = useChannelData(channelId);
  const { environmentId, project } = useTeamScope();
  const promoteDecision = useAtomCommand(teamEnvironment.promoteDecision, "promote team decision");
  const [draft, setDraft] = useState("");
  const [promoteStatus, setPromoteStatus] = useState<string | null>(null);
  const [promoteDraft, setPromoteDraft] = useState<PromoteDraft | null>(null);
  const [promoteBusy, setPromoteBusy] = useState(false);
  const promoteFormId = useId();

  const openPromote = useCallback(
    (post: ChannelPost) => {
      if (post.kind !== "text") return;
      if (environmentId === null || project === null) return;
      const actorId = [...data.memberById.values()].find(
        (member) => member.memberType === "human",
      )?.memberId;
      if (actorId === undefined || !data.canPost) {
        setPromoteStatus("No local human identity to attribute the decision.");
        return;
      }
      setPromoteDraft({
        post,
        title: defaultPromoteTitle(post.body),
        commit: false,
      });
    },
    [data.canPost, data.memberById, environmentId, project],
  );

  const submitPromote = useCallback(() => {
    if (promoteDraft === null || environmentId === null || project === null) return;
    const actorId = [...data.memberById.values()].find(
      (member) => member.memberType === "human",
    )?.memberId;
    if (actorId === undefined) {
      setPromoteStatus("No local human identity to attribute the decision.");
      return;
    }
    const title = promoteDraft.title.trim() || defaultPromoteTitle(promoteDraft.post.body);
    setPromoteBusy(true);
    void promoteDecision({
      environmentId,
      input: {
        projectId: project.id,
        cwd: project.workspaceRoot,
        title,
        body: promoteDraft.post.body,
        origin: {
          kind: "post",
          postId: PostId.make(promoteDraft.post.postId),
          channelId: TeamChannelId.make(promoteDraft.post.channelId),
        },
        promotedById: MemberId.make(actorId),
        commit: promoteDraft.commit,
      },
    }).then((result) => {
      setPromoteBusy(false);
      if (result._tag === "Success") {
        const path = result.value.record.path;
        setPromoteStatus(
          result.value.committed
            ? `Committed decision to ${path}`
            : `Saved decision to ${path} (not committed)`,
        );
        setPromoteDraft(null);
      } else {
        setPromoteStatus("Could not promote decision.");
      }
    });
  }, [data.memberById, environmentId, project, promoteDecision, promoteDraft]);

  if (data.status !== "ready") {
    return (
      <TeamScreenShell title={`#${channelId}`}>
        {data.status === "loading" ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading channel…
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.status === "no-environment"
              ? "Connect an environment to see this channel."
              : "Add a project to this environment to see this channel."}
          </p>
        )}
      </TeamScreenShell>
    );
  }

  if (data.channel === null) {
    return (
      <TeamScreenShell title={`#${channelId}`}>
        <p className="text-sm text-muted-foreground">No such channel in this project.</p>
      </TeamScreenShell>
    );
  }

  const channel = data.channel;
  const submitDraft = () => {
    data.sendTextPost(draft);
    setDraft("");
  };

  // Stable renderItem; rows are pure renders of their props, so LegendList may
  // recycle DOM rows safely (`recycleItems`).
  const renderItem = useCallback(
    ({ item }: { item: ChannelTimelineItem }) =>
      item.kind === "gap" ? (
        <GapRow gap={item} />
      ) : (
        <PostRow post={item} data={data} onPromote={openPromote} />
      ),
    [data, openPromote],
  );

  // Chat-shaped layout: the post list is its own bottom-anchored scroller
  // (virtualized for NFR-1 — smooth at 10k posts), header and composer pinned.
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 sm:px-6">
      <div className="flex shrink-0 items-center gap-2.5 pb-2 pt-5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{channel.name}</h1>
        <Link
          to="/team/channels"
          className="ms-auto inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon className="size-3" />
          All channels
        </Link>
      </div>
      {channel.description.length > 0 ? (
        <p className="shrink-0 pb-2 text-xs text-muted-foreground">{channel.description}</p>
      ) : null}
      {promoteStatus !== null ? (
        <p className="shrink-0 pb-2 text-xs text-muted-foreground">{promoteStatus}</p>
      ) : null}

      {data.timeline.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          {data.postsPending ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading posts…
            </span>
          ) : (
            <p className="text-sm text-muted-foreground">No posts yet.</p>
          )}
        </div>
      ) : (
        <LegendList<ChannelTimelineItem>
          data={data.timeline}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          renderItem={renderItem}
          estimatedItemSize={76}
          recycleItems
          alignItemsAtEnd
          initialScrollAtEnd
          maintainScrollAtEnd
          // Older posts load at the top; keep the viewport stable when they
          // prepend so the reader doesn't jump.
          maintainVisibleContentPosition
          onStartReached={() => data.loadOlder()}
          onStartReachedThreshold={0.5}
          className="min-h-0 flex-1 overflow-x-hidden overscroll-y-contain"
        />
      )}

      {data.canPost ? (
        <form
          className="mb-4 mt-2 flex shrink-0 items-center gap-2 rounded-2xl border bg-background p-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder={`Message ${channel.name}`}
            aria-label={`Message ${channel.name}`}
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={draft.trim().length === 0}>
            <SendIcon className="size-4" />
            Send
          </Button>
        </form>
      ) : null}

      <Dialog
        open={promoteDraft !== null}
        onOpenChange={(open) => {
          if (!open && !promoteBusy) setPromoteDraft(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Promote to decision</DialogTitle>
            <DialogDescription>
              Writes a record under <code>.repokin/decisions/</code>. Optionally create a git commit
              limited to that file.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form
              id={promoteFormId}
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitPromote();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor={`${promoteFormId}-title`}>Title</Label>
                <Input
                  id={`${promoteFormId}-title`}
                  autoFocus
                  value={promoteDraft?.title ?? ""}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setPromoteDraft((prev) => (prev === null ? prev : { ...prev, title: next }));
                  }}
                  placeholder="Decision title"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5">
                <Checkbox
                  checked={promoteDraft?.commit ?? false}
                  onCheckedChange={(checked) => {
                    setPromoteDraft((prev) =>
                      prev === null ? prev : { ...prev, commit: checked === true },
                    );
                  }}
                  className="mt-0.5"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <GitCommitIcon className="size-3.5 text-muted-foreground" />
                    Commit to git
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Stages only the new decision file and commits it under{" "}
                    <code>.repokin/decisions/</code>.
                  </span>
                </span>
              </label>
              {promoteDraft !== null ? (
                <p className="line-clamp-4 whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {promoteDraft.post.body}
                </p>
              ) : null}
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={promoteBusy}
              onClick={() => setPromoteDraft(null)}
            >
              Cancel
            </Button>
            <Button
              form={promoteFormId}
              type="submit"
              disabled={promoteBusy || promoteDraft === null}
            >
              {promoteBusy ? (
                <Spinner className="size-3.5" />
              ) : (
                <FileTextIcon className="size-3.5" />
              )}
              {promoteDraft?.commit === true ? "Promote & commit" : "Promote"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
