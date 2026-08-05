import { MemberId, TaskId, type TeamTaskReadModel } from "@t3tools/contracts/team";
import { describe, expect, it } from "@effect/vitest";

import {
  buildDelegationReportContent,
  buildTaskReportCardContent,
  summarizeDelegationThread,
} from "./TeamDelegationReportReactor.ts";

const baseTask = {
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

describe("buildTaskReportCardContent", () => {
  it("mirrors the task into a task-card post", () => {
    expect(buildTaskReportCardContent(baseTask)).toEqual({
      kind: "task-card",
      taskId: "task-1",
      title: "Fix the login redirect",
      taskState: "in-review",
    });
  });
});

describe("summarizeDelegationThread", () => {
  it("aggregates unique files across checkpoints and picks last assistant paragraph", () => {
    const stats = summarizeDelegationThread({
      branch: "repokin/agent-aria/fix-login",
      checkpoints: [
        {
          files: [
            { path: "apps/web/a.ts", additions: 3, deletions: 1 },
            { path: "apps/web/b.ts", additions: 1, deletions: 0 },
          ],
        },
        {
          files: [{ path: "apps/web/a.ts", additions: 2, deletions: 0 }],
        },
      ],
      messages: [
        { role: "user", text: "fix login" },
        { role: "assistant", text: "First draft.\n\nMore detail." },
        { role: "assistant", text: "Redirect now uses the returnTo query.\n\nExtra context." },
      ],
    });
    expect(stats.changedFiles).toBe(2);
    expect(stats.additions).toBe(6);
    expect(stats.deletions).toBe(1);
    expect(stats.branch).toBe("repokin/agent-aria/fix-login");
    expect(stats.summary).toBe("Redirect now uses the returnTo query.");
  });
});

describe("buildDelegationReportContent", () => {
  it("uses a diff-card when files changed", () => {
    const content = buildDelegationReportContent({
      task: baseTask,
      stats: {
        additions: 6,
        deletions: 1,
        changedFiles: 2,
        branch: "repokin/agent-aria/fix-login",
        summary: "Redirect now uses the returnTo query.",
      },
    });
    expect(content).toMatchObject({
      kind: "diff-card",
      additions: 6,
      deletions: 1,
      changedFiles: 2,
      branch: "repokin/agent-aria/fix-login",
    });
    if (content.kind === "diff-card") {
      expect(content.title).toContain("Fix the login redirect");
      expect(content.title).toContain("returnTo");
    }
  });

  it("falls back to task-card when there is no file activity", () => {
    expect(
      buildDelegationReportContent({
        task: baseTask,
        stats: {
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          branch: null,
          summary: "Looked around; nothing to change.",
        },
      }),
    ).toEqual({
      kind: "task-card",
      taskId: "task-1",
      title: "Fix the login redirect",
      taskState: "in-review",
    });
  });
});
