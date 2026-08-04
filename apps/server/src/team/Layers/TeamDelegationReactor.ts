import { CommandId } from "@t3tools/contracts";
import type {
  MemberId,
  TaskId,
  TeamProjectReadModel,
  TeamRequestRespondedEvent,
} from "@t3tools/contracts/team";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { TeamEngineService } from "../Services/TeamEngine.ts";

/**
 * The board move a delegation accept implies, or `null` when the responded event
 * is not an accept of a task-linked request whose task is still in the backlog.
 * Pure so the accept semantics are tested without standing up the engine.
 */
export function resolveDelegationAcceptMove(input: {
  readonly event: TeamRequestRespondedEvent;
  readonly project: TeamProjectReadModel | undefined;
}): { readonly taskId: TaskId; readonly movedById: MemberId } | null {
  if (input.event.response !== "accepted") {
    return null;
  }
  const request = input.project?.requests.find(
    (candidate) => candidate.requestId === input.event.requestId,
  );
  if (request === undefined || request.taskId === null) {
    return null;
  }
  const task = input.project?.tasks.find((candidate) => candidate.taskId === request.taskId);
  // Only advance a backlog task; re-processing the same accept is then a no-op.
  if (task === undefined || task.state !== "backlog") {
    return null;
  }
  return { taskId: request.taskId, movedById: input.event.responderId };
}

/**
 * R2.3 delegation accept gate.
 *
 * When a delegation request is accepted, advance its linked task into
 * "in-progress". The accept decision itself is made at the assignee's
 * environment via `team.request.respond` — this reactor only reflects that
 * decision onto the board. It never *runs* anything: the actual work still
 * starts through the normal thread/orchestration path, which keeps its
 * runtime-mode / tool-policy / path-scope / trust gates (NFR-3). No inbound
 * event can move a task past "backlog" without an explicit accept.
 */
const makeTeamDelegationReactor = Effect.gen(function* () {
  const teamEngine = yield* TeamEngineService;
  const crypto = yield* Crypto.Crypto;

  const onRequestAccepted = (event: TeamRequestRespondedEvent): Effect.Effect<void> =>
    Effect.gen(function* () {
      const readModel = yield* teamEngine.getReadModel;
      const project = readModel.projects.find(
        (candidate) => candidate.projectId === event.aggregateId,
      );
      const move = resolveDelegationAcceptMove({ event, project });
      if (move === null) {
        return;
      }
      const uuid = yield* crypto.randomUUIDv4;
      yield* teamEngine.dispatch({
        type: "team.task.move",
        commandId: CommandId.make(`server:team-delegation-accept:${uuid}`),
        projectId: event.aggregateId,
        taskId: move.taskId,
        toState: "in-progress",
        movedById: move.movedById,
        metadata: { actorMemberId: move.movedById },
      });
    }).pipe(Effect.ignoreCause({ log: true }));

  yield* teamEngine.streamDomainEvents.pipe(
    Stream.runForEach((event) =>
      event.type === "team.request.responded" && event.response === "accepted"
        ? onRequestAccepted(event)
        : Effect.void,
    ),
    Effect.forkScoped,
  );
});

export const TeamDelegationReactorLive = Layer.effectDiscard(makeTeamDelegationReactor);
