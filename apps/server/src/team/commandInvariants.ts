import type {
  MemberId,
  TeamCommand,
  TeamDomainReadModel,
  TeamInboxMessage,
  TeamMemberReadModel,
  TeamProjectReadModel,
  TeamRequestReadModel,
} from "@t3tools/contracts/team";
import type { MessageId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { TeamCommandInvariantError } from "./Errors.ts";

function invariantError(commandType: string, detail: string): TeamCommandInvariantError {
  return new TeamCommandInvariantError({
    commandType,
    detail,
  });
}

export function findProjectState(
  readModel: TeamDomainReadModel,
  projectId: TeamCommand["projectId"],
): TeamProjectReadModel | undefined {
  return readModel.projects.find((project) => project.projectId === projectId);
}

export function findMember(
  readModel: TeamDomainReadModel,
  projectId: TeamCommand["projectId"],
  memberId: MemberId,
): TeamMemberReadModel | undefined {
  return findProjectState(readModel, projectId)?.members.find(
    (member) => member.memberId === memberId,
  );
}

export function findMessage(
  readModel: TeamDomainReadModel,
  projectId: TeamCommand["projectId"],
  messageId: MessageId,
): TeamInboxMessage | undefined {
  return findProjectState(readModel, projectId)?.inbox.find(
    (message) => message.messageId === messageId,
  );
}

export function findRequest(
  readModel: TeamDomainReadModel,
  projectId: TeamCommand["projectId"],
  requestId: MessageId,
): TeamRequestReadModel | undefined {
  return findProjectState(readModel, projectId)?.requests.find(
    (request) => request.requestId === requestId,
  );
}

export function requireMember(input: {
  readonly readModel: TeamDomainReadModel;
  readonly command: TeamCommand;
  readonly memberId: MemberId;
}): Effect.Effect<TeamMemberReadModel, TeamCommandInvariantError> {
  const member = findMember(input.readModel, input.command.projectId, input.memberId);
  if (member) return Effect.succeed(member);
  return Effect.fail(
    invariantError(
      input.command.type,
      `Member '${input.memberId}' does not exist in project '${input.command.projectId}'.`,
    ),
  );
}

export function requireMessageAbsent(input: {
  readonly readModel: TeamDomainReadModel;
  readonly command: TeamCommand;
  readonly messageId: MessageId;
}): Effect.Effect<void, TeamCommandInvariantError> {
  if (!findMessage(input.readModel, input.command.projectId, input.messageId)) return Effect.void;
  return Effect.fail(
    invariantError(
      input.command.type,
      `Message '${input.messageId}' already exists in project '${input.command.projectId}'.`,
    ),
  );
}

export function requireQueuedMessage(input: {
  readonly readModel: TeamDomainReadModel;
  readonly command: TeamCommand;
  readonly messageId: MessageId;
}): Effect.Effect<TeamInboxMessage, TeamCommandInvariantError> {
  const message = findMessage(input.readModel, input.command.projectId, input.messageId);
  if (message === undefined) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Message '${input.messageId}' does not exist in project '${input.command.projectId}'.`,
      ),
    );
  }
  if (message.state === "queued") return Effect.succeed(message);
  return Effect.fail(
    invariantError(
      input.command.type,
      `Message '${input.messageId}' is '${message.state}' and is not queued.`,
    ),
  );
}

export function requireReadableMessage(input: {
  readonly readModel: TeamDomainReadModel;
  readonly command: TeamCommand;
  readonly messageId: MessageId;
  readonly readerId: MemberId;
}): Effect.Effect<TeamInboxMessage, TeamCommandInvariantError> {
  const message = findMessage(input.readModel, input.command.projectId, input.messageId);
  if (message === undefined) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Message '${input.messageId}' does not exist in project '${input.command.projectId}'.`,
      ),
    );
  }
  if (message.recipientId !== input.readerId) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Member '${input.readerId}' cannot mark message '${input.messageId}' read.`,
      ),
    );
  }
  if (message.state === "delivered") return Effect.succeed(message);
  return Effect.fail(
    invariantError(
      input.command.type,
      `Message '${input.messageId}' is '${message.state}' and is not delivered.`,
    ),
  );
}

export function requireOpenRequest(input: {
  readonly readModel: TeamDomainReadModel;
  readonly command: TeamCommand;
  readonly requestId: MessageId;
}): Effect.Effect<TeamRequestReadModel, TeamCommandInvariantError> {
  const request = findRequest(input.readModel, input.command.projectId, input.requestId);
  if (request === undefined) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Request '${input.requestId}' does not exist in project '${input.command.projectId}'.`,
      ),
    );
  }
  if (request.state === "open") return Effect.succeed(request);
  return Effect.fail(
    invariantError(
      input.command.type,
      `Request '${input.requestId}' is '${request.state}' and cannot be responded to again.`,
    ),
  );
}
