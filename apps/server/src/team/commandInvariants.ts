import type {
  ChannelId,
  MemberId,
  TeamCommand,
  TeamDomainReadModel,
  TeamInboxMessage,
  TeamMemberReadModel,
  TeamPostContent,
  TeamProjectReadModel,
  TeamRequestReadModel,
  TeamTaskReadModel,
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

// ---------------------------------------------------------------------------
// R2 — channels + tasks
// ---------------------------------------------------------------------------

export function findTask(
  readModel: TeamDomainReadModel,
  projectId: TeamCommand["projectId"],
  taskId: TeamTaskReadModel["taskId"],
): TeamTaskReadModel | undefined {
  return findProjectState(readModel, projectId)?.tasks.find((task) => task.taskId === taskId);
}

/** True when the member exists and is an agent. */
export function isAgentMember(
  readModel: TeamDomainReadModel,
  projectId: TeamCommand["projectId"],
  memberId: MemberId,
): boolean {
  return findMember(readModel, projectId, memberId)?.memberType === "agent";
}

export function requireChannel(input: {
  readonly readModel: TeamDomainReadModel;
  readonly command: TeamCommand;
  readonly channelId: ChannelId;
}): Effect.Effect<void, TeamCommandInvariantError> {
  const channel = findProjectState(input.readModel, input.command.projectId)?.channels.find(
    (declaration) => declaration.id === input.channelId,
  );
  if (channel !== undefined) return Effect.void;
  return Effect.fail(
    invariantError(
      input.command.type,
      `Channel '${input.channelId}' does not exist in project '${input.command.projectId}'.`,
    ),
  );
}

/**
 * FR-12.6: agents cannot post unprompted. A free-`text` post is the unprompted
 * case; agents may only post structured cards/events/digests that reference
 * their work. Humans may post anything.
 */
export function requirePromptedPost(input: {
  readonly readModel: TeamDomainReadModel;
  readonly command: TeamCommand;
  readonly authorId: MemberId;
  readonly content: TeamPostContent;
}): Effect.Effect<void, TeamCommandInvariantError> {
  if (!isAgentMember(input.readModel, input.command.projectId, input.authorId)) return Effect.void;
  if (input.content.kind !== "text") return Effect.void;
  return Effect.fail(
    invariantError(
      input.command.type,
      `Agent '${input.authorId}' may not post free text unprompted (FR-12.6).`,
    ),
  );
}

export function requireTaskAbsent(input: {
  readonly readModel: TeamDomainReadModel;
  readonly command: TeamCommand;
  readonly taskId: TeamTaskReadModel["taskId"];
}): Effect.Effect<void, TeamCommandInvariantError> {
  if (findTask(input.readModel, input.command.projectId, input.taskId) === undefined) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Task '${input.taskId}' already exists in project '${input.command.projectId}'.`,
    ),
  );
}

export function requireTask(input: {
  readonly readModel: TeamDomainReadModel;
  readonly command: TeamCommand;
  readonly taskId: TeamTaskReadModel["taskId"];
}): Effect.Effect<TeamTaskReadModel, TeamCommandInvariantError> {
  const task = findTask(input.readModel, input.command.projectId, input.taskId);
  if (task !== undefined) return Effect.succeed(task);
  return Effect.fail(
    invariantError(
      input.command.type,
      `Task '${input.taskId}' does not exist in project '${input.command.projectId}'.`,
    ),
  );
}
