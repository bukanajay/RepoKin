import { assert, describe, it } from "@effect/vitest";
import type { AgentDuty } from "@t3tools/contracts/team";

import { dutyContentHash, isDutyConfirmed, shouldFireDuty, wasDutyMissed } from "./duties.ts";

const duty = (overrides: Partial<AgentDuty> = {}): AgentDuty =>
  ({
    id: "nightly-review",
    goal: "Summarize open PRs",
    schedule: { kind: "daily", hourUtc: 9, minuteUtc: 0 },
    reportChannelId: "team",
    enabled: true,
    ...overrides,
  }) as AgentDuty;

describe("dutyContentHash", () => {
  it("is stable for the same duty and changes when the goal changes", () => {
    const a = dutyContentHash(duty());
    const b = dutyContentHash(duty());
    const c = dutyContentHash(duty({ goal: "Something else" }));
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe("isDutyConfirmed", () => {
  it("requires a matching hash under workspace/agent/duty", () => {
    const d = duty();
    const hash = dutyContentHash(d);
    assert.equal(
      isDutyConfirmed({
        confirmedDuties: { "/repo": { agent_aria: { "nightly-review": hash } } },
        workspaceRoot: "/repo",
        agentId: "agent_aria",
        duty: d,
      }),
      true,
    );
    assert.equal(
      isDutyConfirmed({
        confirmedDuties: { "/repo": { agent_aria: { "nightly-review": "stale" } } },
        workspaceRoot: "/repo",
        agentId: "agent_aria",
        duty: d,
      }),
      false,
    );
  });
});

describe("shouldFireDuty", () => {
  it("fires interval duties when elapsed ≥ everyMinutes", () => {
    const schedule = { kind: "interval" as const, everyMinutes: 60 };
    const now = Date.parse("2026-08-05T12:00:00.000Z");
    assert.equal(shouldFireDuty({ schedule, nowMs: now, lastRunAtMs: null }), true);
    assert.equal(
      shouldFireDuty({
        schedule,
        nowMs: now,
        lastRunAtMs: now - 30 * 60_000,
      }),
      false,
    );
    assert.equal(
      shouldFireDuty({
        schedule,
        nowMs: now,
        lastRunAtMs: now - 90 * 60_000,
      }),
      true,
    );
  });

  it("fires daily duties after the UTC target if not yet run today", () => {
    const schedule = { kind: "daily" as const, hourUtc: 9, minuteUtc: 0 };
    // 10:00 UTC — past 09:00
    const now = Date.parse("2026-08-05T10:00:00.000Z");
    assert.equal(shouldFireDuty({ schedule, nowMs: now, lastRunAtMs: null }), true);
    // Already ran at 09:05 today
    assert.equal(
      shouldFireDuty({
        schedule,
        nowMs: now,
        lastRunAtMs: Date.parse("2026-08-05T09:05:00.000Z"),
      }),
      false,
    );
    // Last run was yesterday
    assert.equal(
      shouldFireDuty({
        schedule,
        nowMs: now,
        lastRunAtMs: Date.parse("2026-08-04T09:05:00.000Z"),
      }),
      true,
    );
  });
});

describe("wasDutyMissed", () => {
  it("reports a miss when the fire window is long past without a run", () => {
    const schedule = { kind: "daily" as const, hourUtc: 9, minuteUtc: 0 };
    const now = Date.parse("2026-08-05T12:00:00.000Z"); // 3h after 09:00
    assert.equal(
      wasDutyMissed({
        schedule,
        nowMs: now,
        lastRunAtMs: Date.parse("2026-08-04T09:00:00.000Z"),
        graceMs: 30 * 60_000,
      }),
      true,
    );
  });
});
