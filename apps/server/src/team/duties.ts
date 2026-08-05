/**
 * Pure helpers for R4 agent duties (FR-16).
 *
 * Duties are T0 on the agent profile. A home environment only runs a duty
 * after the owner confirms its content hash (FR-16.4). Schedule matching is
 * deterministic so missed windows can be reported honestly (FR-16.2).
 */
import type { AgentDuty, AgentDutySchedule } from "@t3tools/contracts/team";

/** Stable content hash for confirmation — changes when schedule/goal/channel change. */
export function dutyContentHash(duty: AgentDuty): string {
  const payload = JSON.stringify({
    id: duty.id,
    goal: duty.goal,
    schedule: duty.schedule,
    reportChannelId: duty.reportChannelId,
    enabled: duty.enabled,
  });
  // FNV-1a 32-bit — good enough for "did the duty definition change?"
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function isDutyConfirmed(input: {
  readonly confirmedDuties: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>
  >;
  readonly workspaceRoot: string;
  readonly agentId: string;
  readonly duty: AgentDuty;
}): boolean {
  const hash = dutyContentHash(input.duty);
  const stored =
    input.confirmedDuties[input.workspaceRoot]?.[input.agentId]?.[input.duty.id] ?? null;
  return stored === hash;
}

/**
 * Whether `now` is inside a new fire window for this schedule since `lastRunAt`.
 * Interval: fire if elapsed ≥ everyMinutes. Daily: fire if we've crossed the
 * UTC HH:MM since last run (or never ran).
 */
export function shouldFireDuty(input: {
  readonly schedule: AgentDutySchedule;
  readonly nowMs: number;
  readonly lastRunAtMs: number | null;
}): boolean {
  const { schedule, nowMs, lastRunAtMs } = input;
  if (schedule.kind === "interval") {
    const everyMs = schedule.everyMinutes * 60_000;
    if (lastRunAtMs === null) return true;
    return nowMs - lastRunAtMs >= everyMs;
  }

  // daily
  const date = new Date(nowMs);
  const targetToday = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    schedule.hourUtc,
    schedule.minuteUtc,
    0,
    0,
  );
  if (nowMs < targetToday) return false;
  if (lastRunAtMs === null) return true;
  // Already fired this UTC day after the target time.
  return lastRunAtMs < targetToday;
}

/** Report a missed window when the env was offline past the fire point. */
export function wasDutyMissed(input: {
  readonly schedule: AgentDutySchedule;
  readonly nowMs: number;
  readonly lastRunAtMs: number | null;
  /** How long after the fire point we still count a run as on-time. */
  readonly graceMs?: number;
}): boolean {
  const graceMs = input.graceMs ?? 30 * 60_000;
  if (input.schedule.kind === "interval") {
    if (input.lastRunAtMs === null) return false;
    const everyMs = input.schedule.everyMinutes * 60_000;
    return input.nowMs - input.lastRunAtMs > everyMs + graceMs;
  }
  const date = new Date(input.nowMs);
  const targetToday = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    input.schedule.hourUtc,
    input.schedule.minuteUtc,
    0,
    0,
  );
  if (input.nowMs < targetToday + graceMs) return false;
  if (input.lastRunAtMs === null) return true;
  return input.lastRunAtMs < targetToday;
}
