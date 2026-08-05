/**
 * Decision records (FR-17.1): promote origin content to
 * `.repokin/decisions/<slug>.md` with YAML frontmatter + Markdown body.
 */
import {
  DecisionId,
  type TeamDecisionOrigin,
  type TeamDecisionRecord,
  TEAM_DECISIONS_DIR_NAME,
} from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as TeamPaths from "./TeamPaths.ts";

export function slugifyDecisionTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "decision";
}

export function formatDecisionMarkdown(input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly origin: TeamDecisionOrigin;
  readonly promotedById: string;
  readonly promotedAt: string;
}): string {
  const originLines =
    input.origin.kind === "post"
      ? [
          "  kind: post",
          `  postId: ${input.origin.postId}`,
          `  channelId: ${input.origin.channelId}`,
        ]
      : input.origin.kind === "task"
        ? ["  kind: task", `  taskId: ${input.origin.taskId}`]
        : ["  kind: thread", `  threadId: ${input.origin.threadId}`];
  return [
    "---",
    `id: ${input.id}`,
    `title: ${JSON.stringify(input.title)}`,
    `promotedById: ${input.promotedById}`,
    `promotedAt: ${input.promotedAt}`,
    "origin:",
    ...originLines,
    "---",
    "",
    input.body.trim(),
    "",
  ].join("\n");
}

/** Minimal frontmatter parse for list/read (not a full YAML engine). */
export function parseDecisionMarkdown(text: string, path: string): TeamDecisionRecord | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (match === null) return null;
  const front = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const get = (key: string): string | null => {
    const line = front.split(/\r?\n/).find((entry) => entry.startsWith(`${key}:`));
    if (line === undefined) return null;
    const raw = line.slice(key.length + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw) as string;
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw;
  };
  const id = get("id");
  const title = get("title");
  const promotedById = get("promotedById");
  const promotedAt = get("promotedAt");
  if (id === null || title === null || promotedById === null || promotedAt === null) {
    return null;
  }
  // Origin: look for kind under origin block.
  const kindMatch = /origin:\s*\n\s*kind:\s*(\w+)/.exec(front);
  const kind = kindMatch?.[1] ?? "post";
  let origin: TeamDecisionOrigin;
  if (kind === "task") {
    const taskId = /taskId:\s*(\S+)/.exec(front)?.[1] ?? "task_unknown";
    origin = { kind: "task", taskId: taskId as never };
  } else if (kind === "thread") {
    const threadId = /threadId:\s*(\S+)/.exec(front)?.[1] ?? "thread_unknown";
    origin = { kind: "thread", threadId: threadId as never };
  } else {
    const postId = /postId:\s*(\S+)/.exec(front)?.[1] ?? "post_unknown";
    const channelId = /channelId:\s*(\S+)/.exec(front)?.[1] ?? "team";
    origin = { kind: "post", postId: postId as never, channelId: channelId as never };
  }
  return {
    id: DecisionId.make(id),
    title,
    body,
    origin,
    promotedById: promotedById as never,
    promotedAt,
    path,
  };
}

export const writeDecisionRecord = Effect.fn("TeamDecisions.write")(function* (input: {
  readonly workspaceRoot: string;
  readonly slug: string;
  readonly markdown: string;
  readonly commit?: boolean;
  readonly commitMessage?: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = TeamPaths.decisionRecordPath(input.workspaceRoot, input.slug);
  const dir = path.dirname(absolute);
  yield* fileSystem
    .makeDirectory(dir, { recursive: true })
    .pipe(Effect.orElseSucceed(() => undefined));
  yield* writeFileStringAtomically({ filePath: absolute, content: input.markdown });

  let committed = false;
  if (input.commit === true) {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const relative = TeamPaths.decisionRecordPathRelative(input.slug);
    yield* processRunner
      .run({
        command: "git",
        args: ["-C", input.workspaceRoot, "add", "--", relative],
        timeoutBehavior: "timedOutResult",
      })
      .pipe(Effect.ignore);
    const commitResult = yield* processRunner
      .run({
        command: "git",
        args: [
          "-C",
          input.workspaceRoot,
          "commit",
          "-m",
          input.commitMessage ?? `docs(decisions): add ${input.slug}`,
          "--",
          relative,
        ],
        timeoutBehavior: "timedOutResult",
      })
      .pipe(Effect.option);
    committed = commitResult._tag === "Some" && commitResult.value.code === 0;
  }

  return {
    path: absolute,
    relativePath: TeamPaths.decisionRecordPathRelative(input.slug),
    committed,
  } as const;
});

export const listDecisionRecords = Effect.fn("TeamDecisions.list")(function* (
  workspaceRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = TeamPaths.decisionsDir(workspaceRoot);
  const exists = yield* fileSystem.exists(dir).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return [] as TeamDecisionRecord[];

  const entries = yield* fileSystem.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
  const records: TeamDecisionRecord[] = [];
  for (const name of entries.filter((entry) => entry.endsWith(".md")).toSorted()) {
    const absolute = path.join(dir, name);
    const text = yield* fileSystem.readFileString(absolute).pipe(Effect.orElseSucceed(() => ""));
    const relative = TeamPaths.joinPosix(
      TeamPaths.repokinDirRelative(),
      TEAM_DECISIONS_DIR_NAME,
      name,
    );
    const parsed = parseDecisionMarkdown(text, relative);
    if (parsed !== null) records.push(parsed);
  }
  return records;
});
