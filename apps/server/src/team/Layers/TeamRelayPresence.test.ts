import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { resolveRemoteHomeEnvironmentIds } from "./TeamRelayPresence.ts";

const localEnvironmentId = EnvironmentId.make("env-local");

describe("resolveRemoteHomeEnvironmentIds", () => {
  it("collects remote home environments across projects, deduped", () => {
    const result = resolveRemoteHomeEnvironmentIds({
      rosters: [
        {
          agents: [
            { homeEnvironment: EnvironmentId.make("env-remote-1") },
            { homeEnvironment: localEnvironmentId },
          ],
        },
        {
          agents: [
            { homeEnvironment: EnvironmentId.make("env-remote-1") },
            { homeEnvironment: EnvironmentId.make("env-remote-2") },
            { homeEnvironment: undefined },
          ],
        },
      ],
      localEnvironmentId,
    });

    expect(result).toEqual(["env-remote-1", "env-remote-2"]);
  });

  it("returns an empty list when every agent is local or homeless", () => {
    const result = resolveRemoteHomeEnvironmentIds({
      rosters: [
        {
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
      rosters: [{ agents }],
      localEnvironmentId,
    });

    expect(result).toHaveLength(200);
  });
});
