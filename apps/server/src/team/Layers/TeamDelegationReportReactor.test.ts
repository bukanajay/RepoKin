import { MemberId, TaskId, type TeamTaskReadModel } from "@t3tools/contracts/team";
import { describe, expect, it } from "@effect/vitest";

import { buildTaskReportCardContent } from "./TeamDelegationReportReactor.ts";

describe("buildTaskReportCardContent", () => {
  it("mirrors the task into a task-card post", () => {
    const task = {
      taskId: TaskId.make("task-1"),
      title: "Fix the login redirect",
      description: null,
      labels: [],
      refs: null,
      state: "in-review",
      createdById: MemberId.make("human_ajay"),
      assigneeId: MemberId.make("agent_aria"),
      createdAt: "2026-08-04T12:00:00.000Z",
      updatedAt: "2026-08-04T12:05:00.000Z",
    } as TeamTaskReadModel;

    expect(buildTaskReportCardContent(task)).toEqual({
      kind: "task-card",
      taskId: "task-1",
      title: "Fix the login redirect",
      taskState: "in-review",
    });
  });
});
