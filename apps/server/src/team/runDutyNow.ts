/**
 * Manual duty fire for smoke testing (team.runDutyNow).
 */
import type { ProjectId } from "@t3tools/contracts";
import {
  TeamRunDutyNowError,
  type AgentDuty,
  type AgentProfile,
  type TeamRunDutyNowInput,
  type TeamRunDutyNowResult,
} from "@t3tools/contracts/team";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import * as ServerSettings from "../serverSettings.ts";
import { isDutyConfirmed } from "./duties.ts";
import { startDutyAgentRun } from "./dutyRun.ts";
import { TeamFileStore } from "./Services/TeamFileStore.ts";

export const runDutyNow = Effect.fn("TeamDuty.runNow")(function* (input: TeamRunDutyNowInput) {
  const teamFileStore = yield* TeamFileStore;
  const serverEnvironment = yield* ServerEnvironment;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const environmentId = yield* serverEnvironment.getEnvironmentId;
  const roster = yield* teamFileStore.readRoster(input.cwd).pipe(
    Effect.mapError(
      (cause) =>
        new TeamRunDutyNowError({
          message: "Failed to read the RepoKin roster.",
          cause,
        }),
    ),
  );

  const agent = roster.agents.find(
    (candidate) => String(candidate.id) === String(input.agentId),
  ) as AgentProfile | undefined;
  if (agent === undefined) {
    return yield* new TeamRunDutyNowError({
      message: `Agent '${input.agentId}' is not in the roster.`,
    });
  }

  const duty = ((agent.duties ?? []) as readonly AgentDuty[]).find(
    (candidate) => candidate.id === input.dutyId,
  );
  if (duty === undefined) {
    return yield* new TeamRunDutyNowError({
      message: `Duty '${input.dutyId}' is not declared on agent '${input.agentId}'.`,
    });
  }
  if (duty.enabled === false) {
    return yield* new TeamRunDutyNowError({
      message: `Duty '${input.dutyId}' is disabled on the profile.`,
    });
  }

  const settings = yield* serverSettings.getSettings.pipe(
    Effect.mapError(
      (cause) =>
        new TeamRunDutyNowError({
          message: "Failed to read server settings for duty confirmation.",
          cause,
        }),
    ),
  );
  const confirmed = isDutyConfirmed({
    confirmedDuties: settings.repokin.confirmedDuties ?? {},
    workspaceRoot: input.cwd,
    agentId: agent.id,
    duty,
  });
  if (!confirmed) {
    return yield* new TeamRunDutyNowError({
      message: `Duty '${input.dutyId}' is not confirmed on this environment (FR-16.4).`,
    });
  }

  if (
    agent.homeEnvironment !== undefined &&
    String(agent.homeEnvironment) !== String(environmentId)
  ) {
    return yield* new TeamRunDutyNowError({
      message: `This environment is not the home for '${agent.id}'.`,
    });
  }

  const now = yield* DateTime.now;
  const result = yield* startDutyAgentRun({
    projectId: input.projectId as ProjectId,
    agent,
    duty,
    runSuffix: `now-${now.epochMilliseconds}`,
    postStartEvent: true,
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof TeamRunDutyNowError
        ? cause
        : new TeamRunDutyNowError({
            message: "Failed to start duty run.",
            cause,
          }),
    ),
  );

  return {
    taskId: result.taskId,
    threadId: result.threadId,
    dutyId: result.dutyId,
  } satisfies TeamRunDutyNowResult;
});
