import { CommandId } from "@t3tools/contracts";
import {
  MemberId,
  TaskId,
  type TeamTaskReadModel,
  type TeamTaskState,
} from "@t3tools/contracts/team";
import { useCallback, useMemo } from "react";

import { randomUUID } from "../../lib/utils";
import { teamEnvironment } from "../../state/team";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import {
  buildMemberSummaryMap,
  resolveLocalHumanId,
  type LiveMemberSummary,
} from "./liveTeamMembers";
import { useTeamScope } from "./teamScope";

/**
 * Board data seam — LIVE (R2.4 flip). Reads tasks from the team read model and
 * moves them via `team.task.move`. Fixture file deleted; Preview badge dropped.
 */

export type BoardTaskState = TeamTaskState;
export type BoardTask = TeamTaskReadModel;

export const BOARD_COLUMNS: ReadonlyArray<{ state: BoardTaskState; label: string }> = [
  { state: "backlog", label: "Backlog" },
  { state: "in-progress", label: "In progress" },
  { state: "in-review", label: "In review" },
  { state: "done", label: "Done" },
];

export type CreateTaskInput = {
  title: string;
  description?: string;
  assigneeId?: string;
};

export type BoardData = {
  status: "no-environment" | "no-project" | "loading" | "ready";
  tasksByState: ReadonlyMap<BoardTaskState, readonly BoardTask[]>;
  memberById: ReadonlyMap<string, LiveMemberSummary>;
  /** Whether the local actor can move cards (a local human was resolved). */
  canMove: boolean;
  moveTask: (taskId: string, state: BoardTaskState) => void;
  /** Whether the local actor can create tasks (a local human was resolved). */
  canCreate: boolean;
  /** Roster members eligible to be assigned a new task. */
  assignableMembers: readonly LiveMemberSummary[];
  createTask: (input: CreateTaskInput) => void;
};

const EMPTY_TASKS: ReadonlyMap<BoardTaskState, readonly BoardTask[]> = new Map();

export function useBoardData(): BoardData {
  const { environmentId, project } = useTeamScope();
  const dispatchCommand = useAtomCommand(teamEnvironment.dispatchCommand, "move team task");
  const dispatchCreate = useAtomCommand(teamEnvironment.dispatchCommand, "create team task");

  const rosterAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.roster({ environmentId, input: { cwd: project.workspaceRoot } });
  const roster = useEnvironmentQuery(rosterAtom);

  const localStateAtom =
    environmentId === null || project === null
      ? null
      : teamEnvironment.localState({ environmentId, input: { projectId: project.id } });
  const localState = useEnvironmentQuery(localStateAtom);

  const localHumanId =
    roster.data === null ? null : resolveLocalHumanId(roster.data.humans, environmentId);

  const moveTask = useCallback(
    (taskId: string, state: BoardTaskState) => {
      if (environmentId === null || project === null || localHumanId === null) return;
      void dispatchCommand({
        environmentId,
        input: {
          type: "team.task.move",
          commandId: CommandId.make(`client:team-task-move:${randomUUID()}`),
          projectId: project.id,
          taskId: TaskId.make(taskId),
          toState: state,
          movedById: MemberId.make(localHumanId),
          metadata: { actorMemberId: MemberId.make(localHumanId) },
        },
      }).then((result) => {
        if (result._tag === "Success") localState.refresh();
      });
    },
    [dispatchCommand, environmentId, localHumanId, localState, project],
  );

  const createTask = useCallback(
    (input: CreateTaskInput) => {
      const title = input.title.trim();
      if (
        title.length === 0 ||
        environmentId === null ||
        project === null ||
        localHumanId === null
      ) {
        return;
      }
      const description = input.description?.trim();
      void dispatchCreate({
        environmentId,
        input: {
          type: "team.task.create",
          commandId: CommandId.make(`client:team-task-create:${randomUUID()}`),
          projectId: project.id,
          taskId: TaskId.make(`task-${randomUUID()}`),
          title,
          ...(description !== undefined && description.length > 0 ? { description } : {}),
          ...(input.assigneeId !== undefined && input.assigneeId.length > 0
            ? { assigneeId: MemberId.make(input.assigneeId) }
            : {}),
          createdById: MemberId.make(localHumanId),
          metadata: { actorMemberId: MemberId.make(localHumanId) },
        },
      }).then((result) => {
        if (result._tag === "Success") localState.refresh();
      });
    },
    [dispatchCreate, environmentId, localHumanId, localState, project],
  );

  return useMemo<BoardData>(() => {
    const base = {
      tasksByState: EMPTY_TASKS,
      memberById: new Map<string, LiveMemberSummary>(),
      canMove: false,
      moveTask,
      canCreate: false,
      assignableMembers: [] as readonly LiveMemberSummary[],
      createTask,
    };
    if (environmentId === null) return { status: "no-environment", ...base };
    if (project === null) return { status: "no-project", ...base };
    if (roster.data === null || localState.data === null) return { status: "loading", ...base };

    const tasksByState = new Map<BoardTaskState, BoardTask[]>();
    for (const column of BOARD_COLUMNS) tasksByState.set(column.state, []);
    for (const task of localState.data.project?.tasks ?? []) {
      tasksByState.get(task.state)?.push(task);
    }
    for (const list of tasksByState.values()) {
      list.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    const memberById = buildMemberSummaryMap(roster.data, localState.data.project?.members ?? []);

    return {
      status: "ready",
      tasksByState,
      memberById,
      canMove: localHumanId !== null,
      moveTask,
      canCreate: localHumanId !== null,
      assignableMembers: [...memberById.values()],
      createTask,
    };
  }, [createTask, environmentId, localHumanId, localState.data, moveTask, project, roster.data]);
}
