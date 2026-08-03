import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  resolveHumanEnvironmentPresenceState,
  resolveRemoteHomeEnvironmentIds,
} from "./TeamRelayPresence.ts";

const localEnvironmentId = EnvironmentId.make("env-local");

describe("resolveRemoteHomeEnvironmentIds", () => {
  it("collects remote home environments across projects, deduped", () => {
    const result = resolveRemoteHomeEnvironmentIds({
      rosters: [
        {
          humans: [],
          agents: [
            { homeEnvironment: EnvironmentId.make("env-remote-1") },
            { homeEnvironment: localEnvironmentId },
          ],
        },
        {
          humans: [
            {
              environments: [
                { environmentId: EnvironmentId.make("env-human-remote") },
                { environmentId: localEnvironmentId },
              ],
            },
          ],
          agents: [
            { homeEnvironment: EnvironmentId.make("env-remote-1") },
            { homeEnvironment: EnvironmentId.make("env-remote-2") },
            { homeEnvironment: undefined },
          ],
        },
      ],
      localEnvironmentId,
    });

    expect(result).toEqual(["env-remote-1", "env-remote-2", "env-human-remote"]);
  });

  it("returns an empty list when every agent is local or homeless", () => {
    const result = resolveRemoteHomeEnvironmentIds({
      rosters: [
        {
          humans: [],
          agents: [{ homeEnvironment: localEnvironmentId }, { homeEnvironment: undefined }],
        },
      ],
      localEnvironmentId,
    });

    expect(result).toEqual([]);
  });

  it("caps the result at 200 environments", () => {
    const agents = Array.from({ length: 250 }, (_, index) => ({
      homeEnvironment: EnvironmentId.make(`env-remote-${index}`),
    }));

    const result = resolveRemoteHomeEnvironmentIds({
      rosters: [{ agents, humans: [] }],
      localEnvironmentId,
    });

    expect(result).toHaveLength(200);
  });
});

describe("resolveHumanEnvironmentPresenceState", () => {
  const nowMs = Date.parse("2026-08-03T00:00:30.000Z");

  it("reports recent input as online", () => {
    expect(
      resolveHumanEnvironmentPresenceState({
        activeAt: "2026-08-03T00:00:05.000Z",
        nowMs,
      }),
    ).toBe("online");
  });

  it("reports stale input as offline and missing input as unknown", () => {
    expect(
      resolveHumanEnvironmentPresenceState({
        activeAt: "2026-08-02T23:59:59.000Z",
        nowMs,
      }),
    ).toBe("offline");
    expect(resolveHumanEnvironmentPresenceState({ activeAt: null, nowMs })).toBeNull();
  });
});
