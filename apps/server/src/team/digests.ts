/**
 * Deterministic environment digest template (R3.3 / PRD Q10 fallback).
 * No provider call — pure projection over activities + tasks + roster membership.
 */

export interface DigestActivity {
  readonly kind: string;
  readonly occurredAt: string;
  readonly actorMemberId: string | null;
  readonly summary: string;
}

export interface DigestTask {
  readonly taskId: string;
  readonly title: string;
  readonly state: string;
  readonly assigneeId: string | null;
  readonly updatedAt: string;
}

export interface DigestMember {
  readonly memberId: string;
  readonly displayName: string;
  readonly memberType: "human" | "agent";
}

export interface EnvironmentDigest {
  readonly title: string;
  readonly bullets: readonly string[];
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Build a standup digest for the members that live on this environment
 * (the local human + agents whose home is here, or all local agents when
 * home is unset).
 */
export function buildEnvironmentDigest(input: {
  readonly environmentLabel?: string;
  readonly localMemberIds: ReadonlyArray<string>;
  readonly membersById: ReadonlyMap<string, DigestMember>;
  readonly activities: ReadonlyArray<DigestActivity>;
  readonly tasks: ReadonlyArray<DigestTask>;
  readonly nowMs: number;
  readonly windowMs?: number;
}): EnvironmentDigest {
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
  const sinceMs = input.nowMs - windowMs;
  const localSet = new Set(input.localMemberIds.map(String));

  const recent = input.activities.filter((activity) => {
    const at = Date.parse(activity.occurredAt);
    if (!Number.isFinite(at) || at < sinceMs) return false;
    if (activity.actorMemberId === null) return false;
    return localSet.has(String(activity.actorMemberId));
  });

  const openTasks = input.tasks.filter(
    (task) =>
      task.state !== "done" && task.assigneeId !== null && localSet.has(String(task.assigneeId)),
  );

  const bullets: string[] = [];

  // Per-member activity rollup.
  for (const memberId of input.localMemberIds) {
    const member = input.membersById.get(memberId);
    const name = member?.displayName ?? memberId;
    const memberActivities = recent.filter(
      (activity) => String(activity.actorMemberId) === String(memberId),
    );
    const memberTasks = openTasks.filter((task) => String(task.assigneeId) === String(memberId));

    if (memberActivities.length === 0 && memberTasks.length === 0) continue;

    const parts: string[] = [];
    if (memberActivities.length > 0) {
      const kinds = new Map<string, number>();
      for (const activity of memberActivities) {
        kinds.set(activity.kind, (kinds.get(activity.kind) ?? 0) + 1);
      }
      const kindSummary = [...kinds.entries()]
        .map(([kind, count]) => `${count}× ${kind.replace(/^.*\./, "")}`)
        .slice(0, 4)
        .join(", ");
      parts.push(
        `${memberActivities.length} ${memberActivities.length === 1 ? "activity" : "activities"} (${kindSummary})`,
      );
    }
    if (memberTasks.length > 0) {
      const titles = memberTasks
        .slice(0, 3)
        .map((task) => `"${task.title}" [${task.state}]`)
        .join(", ");
      parts.push(
        `${memberTasks.length} open task${memberTasks.length === 1 ? "" : "s"}: ${titles}`,
      );
    }
    bullets.push(`${name}: ${parts.join("; ")}`);
  }

  if (bullets.length === 0) {
    bullets.push("No attributed activity or open tasks for this environment in the last day.");
  }

  const label = input.environmentLabel?.trim();
  const title =
    label !== undefined && label.length > 0 ? `Standup — ${label}` : "Standup — this environment";

  return { title, bullets: bullets.slice(0, 12) };
}

/**
 * Turn a model-produced title/body (e.g. from `generatePrContent`) into a
 * digest, falling back to the template when the body is empty.
 */
export function refineDigestFromModelText(input: {
  readonly template: EnvironmentDigest;
  readonly title: string;
  readonly body: string;
}): EnvironmentDigest {
  const title = input.title.trim() || input.template.title;
  const bodyLines = input.body
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s+/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 12);
  return {
    title: title.length > 80 ? `${title.slice(0, 77).trimEnd()}…` : title,
    bullets: bodyLines.length > 0 ? bodyLines : input.template.bullets,
  };
}

/** Prompt payload for an optional provider polish step (Q10). */
export function buildDigestPolishSummary(template: EnvironmentDigest): string {
  return [
    "Rewrite this environment standup digest for a team channel.",
    "Keep it terse, factual, and free of speculation.",
    "Title should start with 'Standup'.",
    "Body should be 3–8 short bullet lines (no markdown fences).",
    "",
    `Current title: ${template.title}`,
    "Current bullets:",
    ...template.bullets.map((bullet) => `- ${bullet}`),
  ].join("\n");
}
