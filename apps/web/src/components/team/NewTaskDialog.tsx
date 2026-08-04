import { PlusIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import type { LiveMemberSummary } from "./liveTeamMembers";
import type { CreateTaskInput } from "./useBoardData";

const UNASSIGNED = "__unassigned__";

type NewTaskDialogProps = {
  assignableMembers: readonly LiveMemberSummary[];
  onCreate: (input: CreateTaskInput) => void;
};

/**
 * Create a backlog task from the board so delegation can be exercised without
 * hand-seeding tasks. Title is the only required field; the description doubles
 * as the delegation prompt (contract note on `team.task.create`).
 */
export function NewTaskDialog({ assignableMembers, onCreate }: NewTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
  const formId = useId();

  const items = useMemo(
    () => [
      { value: UNASSIGNED, label: "Unassigned" },
      ...assignableMembers.map((member) => ({ value: member.memberId, label: member.displayName })),
    ],
    [assignableMembers],
  );

  const canSubmit = title.trim().length > 0;

  const reset = () => {
    setTitle("");
    setDescription("");
    setAssigneeId(UNASSIGNED);
  };

  const submit = () => {
    if (!canSubmit) return;
    onCreate({
      title,
      description,
      ...(assigneeId === UNASSIGNED ? {} : { assigneeId }),
    });
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        New task
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          if (!next) reset();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>
              New tasks land in the backlog. The description is used as the delegation prompt when
              an agent picks it up.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form
              id={formId}
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-title`}>Title</Label>
                <Input
                  id={`${formId}-title`}
                  autoFocus
                  placeholder="Fix the login redirect"
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-description`}>Description (optional)</Label>
                <Textarea
                  id={`${formId}-description`}
                  placeholder="Context and acceptance criteria — this becomes the agent's prompt."
                  value={description}
                  onChange={(event) => setDescription(event.currentTarget.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Assignee</Label>
                <Select
                  items={items}
                  value={assigneeId}
                  onValueChange={(value: string | null) => setAssigneeId(value ?? UNASSIGNED)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button form={formId} type="submit" disabled={!canSubmit}>
              Create task
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
