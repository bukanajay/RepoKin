import type { EnvironmentId } from "@t3tools/contracts";
import type { TeamRosterReadModel } from "@t3tools/contracts/team";

/** Distinct roster environments other than the local one — fan-out targets. */
export function collectRemoteEnvironments(input: {
  readonly roster: TeamRosterReadModel;
  readonly localEnvironmentId: EnvironmentId;
}): ReadonlyArray<EnvironmentId> {
  const seen = new Set<string>();
  const result: EnvironmentId[] = [];
  const add = (environmentId: EnvironmentId | undefined) => {
    if (environmentId === undefined || String(environmentId) === String(input.localEnvironmentId)) {
      return;
    }
    if (seen.has(String(environmentId))) return;
    seen.add(String(environmentId));
    result.push(environmentId);
  };
  for (const agent of input.roster.agents) add(agent.homeEnvironment);
  for (const human of input.roster.humans) {
    for (const environment of human.environments ?? []) add(environment.environmentId);
  }
  return result;
}
