import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";
import { MemberAvatar } from "./MemberAvatar";
import { TeamCard } from "./TeamCard";
import { TeamScreenShell } from "./TeamScreenShell";
import { deriveMemberAccentColor } from "./memberIdentity";
import {
  BOARD_COLUMNS,
  useBoardData,
  type BoardData,
  type BoardTask,
  type BoardTaskState,
} from "./useBoardData";

function BoardTaskCard({ task, data }: { task: BoardTask; data: BoardData }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.taskId,
  });
  const assignee = task.assigneeId !== null ? data.memberById.get(task.assigneeId) : undefined;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("cursor-grab touch-none", isDragging && "z-10 opacity-90")}
      style={
        transform !== null
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
    >
      <TeamCard
        accentColor={
          task.assigneeId !== null ? deriveMemberAccentColor(task.assigneeId) : undefined
        }
        header={<span className="text-sm font-medium text-foreground">{task.title}</span>}
      >
        <div className="flex items-center gap-1.5">
          {task.labels.map((label) => (
            <Badge key={label} variant="secondary" size="sm">
              {label}
            </Badge>
          ))}
          {assignee !== undefined ? (
            <span className="ms-auto">
              <MemberAvatar
                memberId={assignee.memberId}
                displayName={assignee.displayName}
                memberType={assignee.memberType}
                size="xs"
              />
            </span>
          ) : null}
        </div>
      </TeamCard>
    </div>
  );
}

function BoardColumn({
  state,
  label,
  data,
}: {
  state: BoardTaskState;
  label: string;
  data: BoardData;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: state });
  const tasks = data.tasksByState.get(state) ?? [];

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-40 w-64 shrink-0 flex-col gap-2 rounded-2xl border bg-muted/25 p-2 transition-colors",
        isOver && "border-ring bg-muted/50",
      )}
    >
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground/70">{tasks.length}</span>
      </div>
      {tasks.map((task) => (
        <BoardTaskCard key={task.taskId} task={task} data={data} />
      ))}
    </div>
  );
}

export function TeamBoardScreen() {
  const data = useBoardData();

  const onDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (typeof overId === "string" && typeof event.active.id === "string") {
      data.moveTask(event.active.id, overId as BoardTaskState);
    }
  };

  if (data.status !== "ready") {
    return (
      <TeamScreenShell title="Board" className="max-w-none">
        {data.status === "loading" ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading the board…
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.status === "no-environment"
              ? "Connect an environment to see the board."
              : "Add a project to this environment to see its board."}
          </p>
        )}
      </TeamScreenShell>
    );
  }

  return (
    <TeamScreenShell title="Board" className="max-w-none">
      <DndContext onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {BOARD_COLUMNS.map((column) => (
            <BoardColumn key={column.state} state={column.state} label={column.label} data={data} />
          ))}
        </div>
      </DndContext>
    </TeamScreenShell>
  );
}
