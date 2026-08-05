import { CheckIcon, MessageSquareIcon, RotateCcwIcon } from "lucide-react";
import { useId, useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { MemberChip } from "./MemberChip";
import type { LiveMemberSummary } from "./liveTeamMembers";
import type { BoardTask } from "./useBoardData";

export type TaskReviewVerdict = "approve" | "request-changes";

type TaskDetailDialogProps = {
  task: BoardTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberById: ReadonlyMap<string, LiveMemberSummary>;
  canWrite: boolean;
  onComment: (taskId: string, body: string) => void;
  onReview: (taskId: string, verdict: TaskReviewVerdict, findings: string) => void;
};

/**
 * Board task detail: description, comments (FR-18.4), and structured review
 * actions for in-review work (FR-13.6).
 */
export function TaskDetailDialog({
  task,
  open,
  onOpenChange,
  memberById,
  canWrite,
  onComment,
  onReview,
}: TaskDetailDialogProps) {
  const [draft, setDraft] = useState("");
  const [findings, setFindings] = useState("");
  const formId = useId();

  if (task === null) return null;

  const assignee = task.assigneeId !== null ? (memberById.get(task.assigneeId) ?? null) : null;
  const comments = task.comments ?? [];
  const inReview = task.state === "in-review";

  const submitComment = () => {
    const body = draft.trim();
    if (body.length === 0) return;
    onComment(task.taskId, body);
    setDraft("");
  };

  const submitReview = (verdict: TaskReviewVerdict) => {
    onReview(task.taskId, verdict, findings.trim());
    setFindings("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setDraft("");
          setFindings("");
        }
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-8">{task.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" size="sm" className="capitalize">
              {task.state.replace("-", " ")}
            </Badge>
            {assignee !== null ? (
              <MemberChip
                memberId={assignee.memberId}
                displayName={assignee.displayName}
                memberType={assignee.memberType}
              />
            ) : (
              <span className="text-xs text-muted-foreground">Unassigned</span>
            )}
            {task.labels.map((label) => (
              <Badge key={label} variant="secondary" size="sm">
                {label}
              </Badge>
            ))}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {task.description !== null && task.description.length > 0 ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {task.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No description.</p>
          )}

          {task.refs?.threadId !== undefined || task.refs?.channelId !== undefined ? (
            <p className="font-mono text-xs text-muted-foreground">
              {task.refs.channelId !== undefined ? `#${task.refs.channelId}` : null}
              {task.refs.channelId !== undefined && task.refs.threadId !== undefined ? " · " : null}
              {task.refs.threadId !== undefined ? `thread ${task.refs.threadId}` : null}
            </p>
          ) : null}

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessageSquareIcon className="size-3.5" />
              Comments
            </h3>
            {comments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No comments yet.</p>
            ) : (
              <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                {comments.map((comment) => {
                  const author = memberById.get(comment.authorId);
                  return (
                    <li
                      key={comment.commentId}
                      className="rounded-xl border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        {author !== undefined ? (
                          <MemberChip
                            memberId={author.memberId}
                            displayName={author.displayName}
                            memberType={author.memberType}
                          />
                        ) : (
                          <span className="font-mono text-xs">{comment.authorId}</span>
                        )}
                        {comment.kind === "review" && comment.verdict !== null ? (
                          <Badge
                            variant={comment.verdict === "approve" ? "success" : "warning"}
                            size="sm"
                          >
                            {comment.verdict === "approve" ? "Approved" : "Changes requested"}
                          </Badge>
                        ) : null}
                        <span className="ms-auto text-xs tabular-nums text-muted-foreground">
                          {formatRelativeTimeLabel(comment.at)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-foreground">{comment.body}</p>
                    </li>
                  );
                })}
              </ul>
            )}

            {canWrite ? (
              <form
                id={formId}
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitComment();
                }}
              >
                <Label htmlFor={`${formId}-comment`} className="sr-only">
                  Add comment
                </Label>
                <Textarea
                  id={`${formId}-comment`}
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  placeholder="Add a comment…"
                  rows={2}
                  className="resize-none"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={draft.trim().length === 0}
                >
                  Comment
                </Button>
              </form>
            ) : null}
          </section>

          {canWrite && inReview ? (
            <section className="flex flex-col gap-2 rounded-2xl border border-dashed p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Review
              </h3>
              <p className="text-xs text-muted-foreground">
                Approve marks the task done. Request changes returns it to in progress with your
                findings.
              </p>
              <Textarea
                value={findings}
                onChange={(event) => setFindings(event.currentTarget.value)}
                placeholder="Findings (optional for approve, recommended for changes)…"
                rows={2}
                className="resize-none"
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => submitReview("approve")}>
                  <CheckIcon className="size-3.5" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => submitReview("request-changes")}
                  disabled={findings.trim().length === 0}
                  title={
                    findings.trim().length === 0
                      ? "Add findings when requesting changes"
                      : undefined
                  }
                >
                  <RotateCcwIcon className="size-3.5" />
                  Request changes
                </Button>
              </div>
            </section>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
