/**
 * AgentForge instruction preview query.
 *
 * Reads the working-tree roster, compiles one agent, and returns the
 * provider-specific expressive instructions with mechanical trust metadata.
 *
 * @module InstructionPreview
 */
import {
  type TeamInstructionPreviewInput,
  TeamInstructionPreviewError,
  type TeamInstructionPreviewResult,
} from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";

import { CharacterCompiler } from "./Services/CharacterCompiler.ts";
import { TeamFileStore } from "./Services/TeamFileStore.ts";

export const previewTeamInstructions = Effect.fn("TeamInstructionPreview.preview")(function* (
  input: TeamInstructionPreviewInput,
): Effect.fn.Return<
  TeamInstructionPreviewResult,
  TeamInstructionPreviewError,
  TeamFileStore | CharacterCompiler
> {
  const store = yield* TeamFileStore;
  const compiler = yield* CharacterCompiler;
  const roster = yield* store.readRoster(input.cwd).pipe(
    Effect.mapError(
      (cause) =>
        new TeamInstructionPreviewError({
          reason: "roster-read-failed",
          cwd: input.cwd,
          agentId: input.agentId,
          driver: input.driver,
          message: "Failed to read AgentForge roster.",
          cause,
        }),
    ),
  );
  const agent = roster.agents.find((candidate) => candidate.id === input.agentId);

  if (agent === undefined) {
    return yield* new TeamInstructionPreviewError({
      reason: "agent-not-found",
      cwd: input.cwd,
      agentId: input.agentId,
      driver: input.driver,
      message: `Agent ${input.agentId} was not found in the AgentForge roster.`,
    });
  }

  const compiled = yield* compiler.compile(agent).pipe(
    Effect.mapError(
      (cause) =>
        new TeamInstructionPreviewError({
          reason: "compile-failed",
          cwd: input.cwd,
          agentId: input.agentId,
          driver: input.driver,
          message: `Failed to compile AgentForge character for ${input.agentId}.`,
          cause,
        }),
    ),
  );
  const instructions = compiled.instructionsByDriver[input.driver];

  if (instructions === undefined || instructions.trim().length === 0) {
    return yield* new TeamInstructionPreviewError({
      reason: "driver-unsupported",
      cwd: input.cwd,
      agentId: input.agentId,
      driver: input.driver,
      message: `Agent ${input.agentId} does not have compiled instructions for ${input.driver}.`,
    });
  }

  return {
    agentId: compiled.agentId,
    characterVersion: compiled.characterVersion,
    driver: input.driver,
    instructions,
    mechanics: compiled.mechanics,
    mechanicalHash: compiled.mechanicalHash,
  };
});
