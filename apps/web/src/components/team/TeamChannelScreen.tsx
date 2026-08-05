import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LegendList } from "@legendapp/list/react";
import {
  ArrowLeftIcon,
  FileDiffIcon,
  KanbanSquareIcon,
  MessageSquareIcon,
  NewspaperIcon,
  SendIcon,
  ZapIcon,
} from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { MemberChip } from "./MemberChip";
import { TeamCard } from "./TeamCard";
import { TeamScreenShell } from "./TeamScreenShell";
import { deriveMemberAccentColor } from "./memberIdentity";
import { useChannelData, type ChannelData, type ChannelPost } from "./useChannelData";

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

function keyExtractor(post: ChannelPost) {
  return post.postId;
}

// Item type feeds LegendList's view recycling — one recycle pool per post kind.
function getItemType(post: ChannelPost) {
  return post.kind;
}

function PostRow({ post, data }: { post: ChannelPost; data: ChannelData }) {
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
      </div>
      <div className="ps-8">
        <PostBody post={post} />
      </div>
    </div>
  );
}

export function TeamChannelScreen({ channelId }: { channelId: string }) {
  const data = useChannelData(channelId);
  const [draft, setDraft] = useState("");

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

  // Stable renderItem; PostRow is a pure render of its props, so LegendList may
  // recycle its DOM rows safely (`recycleItems`).
  const renderItem = useCallback(
    ({ item }: { item: ChannelPost }) => <PostRow post={item} data={data} />,
    [data],
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

      {data.posts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">No posts yet.</p>
        </div>
      ) : (
        <LegendList<ChannelPost>
          data={data.posts}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          renderItem={renderItem}
          estimatedItemSize={76}
          recycleItems
          alignItemsAtEnd
          initialScrollAtEnd
          maintainScrollAtEnd
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
    </div>
  );
}
