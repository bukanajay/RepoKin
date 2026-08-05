import type { EventId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  MemberId,
  TeamActivity,
  TeamDomainReadModel,
  TeamEvent,
  TeamInboxMessage,
  TeamProjectReadModel,
  TeamRequestReadModel,
} from "@t3tools/contracts/team";
import { TeamDomainReadModel as TeamDomainReadModelSchema } from "@t3tools/contracts/team";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { toTeamProjectorDecodeError, type TeamProjectorDecodeError } from "./Errors.ts";

const MAX_TEAM_ACTIVITIES = 500;

type ProjectPatch = Partial<Omit<TeamProjectReadModel, "projectId">>;

export function createEmptyTeamReadModel(nowIso: string): TeamDomainReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    updatedAt: nowIso,
  };
}

function emptyProject(projectId: ProjectId, updatedAt: string): TeamProjectReadModel {
  return {
    projectId,
    members: [],
    assignments: [],
    inbox: [],
    requests: [],
    activities: [],
    channels: [],
    posts: [],
    tasks: [],
    updatedAt,
  };
}

function upsertProject(
  projects: ReadonlyArray<TeamProjectReadModel>,
  projectId: ProjectId,
  updatedAt: string,
  patch: (project: TeamProjectReadModel) => ProjectPatch,
): TeamProjectReadModel[] {
  const existing = projects.find((project) => project.projectId === projectId);
  const base = existing ?? emptyProject(projectId, updatedAt);
  const next = { ...base, ...patch(base), updatedAt };
  return existing === undefined
    ? [...projects, next]
    : projects.map((project) => (project.projectId === projectId ? next : project));
}

function appendActivity(
  activities: ReadonlyArray<TeamActivity>,
  activity: TeamActivity,
): TeamActivity[] {
  return [...activities, activity].slice(-MAX_TEAM_ACTIVITIES);
}

function activity(input: {
  readonly eventId: EventId;
  readonly kind: TeamActivity["kind"];
  readonly occurredAt: string;
  readonly actorMemberId: MemberId | null;
  readonly subjectMemberId: MemberId | null;
  readonly threadId: ThreadId | null;
  readonly messageId: MessageId | null;
  readonly requestId: MessageId | null;
  readonly summary: string;
}): TeamActivity {
  return input;
}

const decodeTeamDomainReadModel = Schema.decodeUnknownEffect(TeamDomainReadModelSchema);

/** Validate a fully-constructed read model against the contract schema. */
function validateReadModel(
  value: TeamDomainReadModel,
  eventType: TeamEvent["type"],
): Effect.Effect<TeamDomainReadModel, TeamProjectorDecodeError> {
  return decodeTeamDomainReadModel(value).pipe(
    Effect.mapError(toTeamProjectorDecodeError(eventType)),
  );
}

/**
 * Pure per-event transition helper used inside the switch below. It only
 * constructs the next read model; validation is deferred to the exported
 * `projectTeamEvent` / `projectTeamEvents` so a bulk replay validates once
 * instead of re-decoding the whole (growing) model on every event — which is
 * O(n²) and makes engine boot pathological for large histories. `eventType`
 * is accepted so the call sites read naturally but is intentionally unused.
 */
function buildReadModel(
  value: TeamDomainReadModel,
  _eventType: TeamEvent["type"],
): TeamDomainReadModel {
  return value;
}

function eventOccurredAt(event: TeamEvent): string {
  switch (event.type) {
    case "team.member.upserted":
    case "team.agent.assigned":
      return event.at;
    case "team.message.queued":
      return event.sentAt;
    case "team.message.delivered":
      return event.deliveredAt;
    case "team.message.read":
      return event.readAt;
    case "team.message.expired":
      return event.expiredAt;
    case "team.request.created":
      return event.createdAt;
    case "team.request.responded":
      return event.respondedAt;
    case "team.channel.declared":
    case "team.channel.posted":
    case "team.task.created":
    case "team.task.moved":
    case "team.task.updated":
    case "team.task.assigned":
      return event.at;
  }
}

/**
 * Pure fold: construct the next read model for one event without validating.
 * Used directly by bulk replay (`projectTeamEvents`); single-event callers go
 * through `projectTeamEvent`, which validates the result.
 */
export function applyTeamEvent(model: TeamDomainReadModel, event: TeamEvent): TeamDomainReadModel {
  const nextBase: TeamDomainReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: eventOccurredAt(event),
  };

  switch (event.type) {
    case "team.member.upserted":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(nextBase.projects, event.aggregateId, event.at, (project) => ({
            members: [
              ...project.members.filter((member) => member.memberId !== event.memberId),
              {
                memberId: event.memberId,
                memberType: event.memberType,
                profile: event.profile,
                updatedAt: event.at,
              },
            ],
            activities: appendActivity(
              project.activities,
              activity({
                eventId: event.eventId,
                kind: "member.upserted",
                occurredAt: event.at,
                actorMemberId: event.metadata.actorMemberId ?? null,
                subjectMemberId: event.memberId,
                threadId: null,
                messageId: null,
                requestId: null,
                summary: `${event.memberId} profile updated`,
              }),
            ),
          })),
        },
        event.type,
      );

    case "team.agent.assigned":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(nextBase.projects, event.aggregateId, event.at, (project) => ({
            assignments: [
              ...project.assignments.filter((assignment) => assignment.threadId !== event.threadId),
              {
                threadId: event.threadId,
                assigneeId: event.assigneeId,
                assignedById: event.assignedById,
                assignedAt: event.at,
                note: event.note,
              },
            ],
            activities: appendActivity(
              project.activities,
              activity({
                eventId: event.eventId,
                kind: "thread.assigned",
                occurredAt: event.at,
                actorMemberId: event.assignedById,
                subjectMemberId: event.assigneeId,
                threadId: event.threadId,
                messageId: null,
                requestId: null,
                summary: `${event.assignedById} assigned ${event.threadId} to ${event.assigneeId}`,
              }),
            ),
          })),
        },
        event.type,
      );

    case "team.message.queued":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(nextBase.projects, event.aggregateId, event.sentAt, (project) => {
            const inboxMessage: TeamInboxMessage = {
              messageId: event.messageId,
              senderId: event.senderId,
              recipientId: event.recipientId,
              senderEnvironmentId: event.metadata.environmentId ?? null,
              body: event.body,
              threadId: event.threadId,
              sentAt: event.sentAt,
              expiresAt: event.expiresAt,
              state: "queued",
              deliveredAt: null,
              readAt: null,
              expiredAt: null,
            };
            return {
              inbox: [
                ...project.inbox.filter((message) => message.messageId !== event.messageId),
                inboxMessage,
              ],
              activities: appendActivity(
                project.activities,
                activity({
                  eventId: event.eventId,
                  kind: "message.queued",
                  occurredAt: event.sentAt,
                  actorMemberId: event.senderId,
                  subjectMemberId: event.recipientId,
                  threadId: event.threadId,
                  messageId: event.messageId,
                  requestId: null,
                  summary: `${event.senderId} messaged ${event.recipientId}`,
                }),
              ),
            };
          }),
        },
        event.type,
      );

    case "team.message.delivered":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(
            nextBase.projects,
            event.aggregateId,
            event.deliveredAt,
            (project) => ({
              inbox: project.inbox.map((message) =>
                message.messageId === event.messageId
                  ? { ...message, state: "delivered", deliveredAt: event.deliveredAt }
                  : message,
              ),
              activities: appendActivity(
                project.activities,
                activity({
                  eventId: event.eventId,
                  kind: "message.delivered",
                  occurredAt: event.deliveredAt,
                  actorMemberId: event.metadata.actorMemberId ?? null,
                  subjectMemberId: null,
                  threadId: null,
                  messageId: event.messageId,
                  requestId: null,
                  summary: `${event.messageId} delivered`,
                }),
              ),
            }),
          ),
        },
        event.type,
      );

    case "team.message.read":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(
            nextBase.projects,
            event.aggregateId,
            event.readAt,
            (project) => ({
              inbox: project.inbox.map((message) =>
                message.messageId === event.messageId
                  ? { ...message, state: "read", readAt: event.readAt }
                  : message,
              ),
              activities: appendActivity(
                project.activities,
                activity({
                  eventId: event.eventId,
                  kind: "message.read",
                  occurredAt: event.readAt,
                  actorMemberId: event.readerId,
                  subjectMemberId: null,
                  threadId: null,
                  messageId: event.messageId,
                  requestId: null,
                  summary: `${event.readerId} read ${event.messageId}`,
                }),
              ),
            }),
          ),
        },
        event.type,
      );

    case "team.message.expired":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(
            nextBase.projects,
            event.aggregateId,
            event.expiredAt,
            (project) => ({
              inbox: project.inbox.map((message) =>
                message.messageId === event.messageId
                  ? { ...message, state: "expired", expiredAt: event.expiredAt }
                  : message,
              ),
              activities: appendActivity(
                project.activities,
                activity({
                  eventId: event.eventId,
                  kind: "message.expired",
                  occurredAt: event.expiredAt,
                  actorMemberId: event.metadata.actorMemberId ?? null,
                  subjectMemberId: null,
                  threadId: null,
                  messageId: event.messageId,
                  requestId: null,
                  summary: `${event.messageId} expired`,
                }),
              ),
            }),
          ),
        },
        event.type,
      );

    case "team.request.created":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(
            nextBase.projects,
            event.aggregateId,
            event.createdAt,
            (project) => {
              const request: TeamRequestReadModel = {
                requestId: event.requestId,
                kind: event.kind,
                fromMemberId: event.fromMemberId,
                toMemberId: event.toMemberId,
                threadId: event.threadId,
                taskId: event.taskId,
                message: event.message,
                state: "open",
                createdAt: event.createdAt,
                expiresAt: event.expiresAt,
                respondedAt: null,
                response: null,
                responseMessage: null,
              };
              return {
                requests: [
                  ...project.requests.filter((entry) => entry.requestId !== event.requestId),
                  request,
                ],
                activities: appendActivity(
                  project.activities,
                  activity({
                    eventId: event.eventId,
                    kind: "request.created",
                    occurredAt: event.createdAt,
                    actorMemberId: event.fromMemberId,
                    subjectMemberId: event.toMemberId,
                    threadId: event.threadId,
                    messageId: null,
                    requestId: event.requestId,
                    summary: `${event.fromMemberId} requested ${event.kind} from ${event.toMemberId}`,
                  }),
                ),
              };
            },
          ),
        },
        event.type,
      );

    case "team.request.responded":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(
            nextBase.projects,
            event.aggregateId,
            event.respondedAt,
            (project) => ({
              requests: project.requests.map((request) =>
                request.requestId === event.requestId
                  ? {
                      ...request,
                      state: event.response,
                      respondedAt: event.respondedAt,
                      response: event.response,
                      responseMessage: event.message,
                    }
                  : request,
              ),
              activities: appendActivity(
                project.activities,
                activity({
                  eventId: event.eventId,
                  kind: "request.responded",
                  occurredAt: event.respondedAt,
                  actorMemberId: event.responderId,
                  subjectMemberId: null,
                  threadId: null,
                  messageId: null,
                  requestId: event.requestId,
                  summary: `${event.responderId} ${event.response} ${event.requestId}`,
                }),
              ),
            }),
          ),
        },
        event.type,
      );

    case "team.channel.declared":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(nextBase.projects, event.aggregateId, event.at, (project) => ({
            channels: [
              ...project.channels.filter((channel) => channel.id !== event.channelId),
              event.declaration,
            ],
            activities: appendActivity(
              project.activities,
              activity({
                eventId: event.eventId,
                kind: "channel.declared",
                occurredAt: event.at,
                actorMemberId: event.metadata.actorMemberId ?? null,
                subjectMemberId: null,
                threadId: null,
                messageId: null,
                requestId: null,
                summary: `#${event.channelId} declared`,
              }),
            ),
          })),
        },
        event.type,
      );

    case "team.channel.posted":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(
            nextBase.projects,
            event.aggregateId,
            event.postedAt,
            (project) => ({
              posts: [
                ...project.posts.filter((post) => post.postId !== event.postId),
                {
                  postId: event.postId,
                  channelId: event.channelId,
                  authorId: event.authorId,
                  authorEnvironmentId: event.authorEnvironmentId,
                  content: event.content,
                  postedAt: event.postedAt,
                },
              ],
              activities: appendActivity(
                project.activities,
                activity({
                  eventId: event.eventId,
                  kind: "channel.posted",
                  occurredAt: event.postedAt,
                  actorMemberId: event.authorId,
                  subjectMemberId: null,
                  threadId: null,
                  messageId: null,
                  requestId: null,
                  summary: `${event.authorId} posted in #${event.channelId}`,
                }),
              ),
            }),
          ),
        },
        event.type,
      );

    case "team.task.created":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(nextBase.projects, event.aggregateId, event.at, (project) => ({
            tasks: [
              ...project.tasks.filter((task) => task.taskId !== event.taskId),
              {
                taskId: event.taskId,
                title: event.title,
                description: event.description,
                labels: event.labels,
                refs: event.refs,
                state: "backlog",
                assigneeId: event.assigneeId,
                createdById: event.createdById,
                createdAt: event.at,
                updatedAt: event.at,
              },
            ],
            activities: appendActivity(
              project.activities,
              activity({
                eventId: event.eventId,
                kind: "task.created",
                occurredAt: event.at,
                actorMemberId: event.createdById,
                subjectMemberId: event.assigneeId,
                threadId: null,
                messageId: null,
                requestId: null,
                summary: `${event.createdById} created task ${event.taskId}`,
              }),
            ),
          })),
        },
        event.type,
      );

    case "team.task.moved":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(nextBase.projects, event.aggregateId, event.at, (project) => ({
            tasks: project.tasks.map((task) =>
              task.taskId === event.taskId
                ? { ...task, state: event.toState, updatedAt: event.at }
                : task,
            ),
            activities: appendActivity(
              project.activities,
              activity({
                eventId: event.eventId,
                kind: "task.moved",
                occurredAt: event.at,
                actorMemberId: event.movedById,
                subjectMemberId: null,
                threadId: null,
                messageId: null,
                requestId: null,
                summary: `${event.movedById} moved ${event.taskId} to ${event.toState}`,
              }),
            ),
          })),
        },
        event.type,
      );

    case "team.task.updated":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(nextBase.projects, event.aggregateId, event.at, (project) => ({
            // Per-field last-writer-wins (FR-18.6): apply only non-null fields.
            tasks: project.tasks.map((task) =>
              task.taskId === event.taskId
                ? {
                    ...task,
                    title: event.title ?? task.title,
                    description: event.description ?? task.description,
                    labels: event.labels ?? task.labels,
                    refs: event.refs ?? task.refs,
                    updatedAt: event.at,
                  }
                : task,
            ),
            activities: appendActivity(
              project.activities,
              activity({
                eventId: event.eventId,
                kind: "task.updated",
                occurredAt: event.at,
                actorMemberId: event.updatedById,
                subjectMemberId: null,
                threadId: null,
                messageId: null,
                requestId: null,
                summary: `${event.updatedById} updated ${event.taskId}`,
              }),
            ),
          })),
        },
        event.type,
      );

    case "team.task.assigned":
      return buildReadModel(
        {
          ...nextBase,
          projects: upsertProject(nextBase.projects, event.aggregateId, event.at, (project) => ({
            tasks: project.tasks.map((task) =>
              task.taskId === event.taskId
                ? { ...task, assigneeId: event.assigneeId, updatedAt: event.at }
                : task,
            ),
            activities: appendActivity(
              project.activities,
              activity({
                eventId: event.eventId,
                kind: "task.assigned",
                occurredAt: event.at,
                actorMemberId: event.assignedById,
                subjectMemberId: event.assigneeId,
                threadId: null,
                messageId: null,
                requestId: null,
                summary:
                  event.assigneeId === null
                    ? `${event.assignedById} unassigned ${event.taskId}`
                    : `${event.assignedById} assigned ${event.taskId} to ${event.assigneeId}`,
              }),
            ),
          })),
        },
        event.type,
      );
  }
}

/**
 * Project one event and validate the resulting read model against the schema.
 * Use this on the single-event path (command dispatch), where per-event
 * validation catches an invalid transition immediately.
 */
export function projectTeamEvent(
  model: TeamDomainReadModel,
  event: TeamEvent,
): Effect.Effect<TeamDomainReadModel, TeamProjectorDecodeError> {
  return validateReadModel(applyTeamEvent(model, event), event.type);
}

/**
 * Fold many events and validate once at the end. Boot replay uses this: it is
 * O(n) in the number of events plus a single decode, instead of re-decoding
 * the whole (growing) model per event. Persisted events were already validated
 * on append, so the intermediate models need no re-validation.
 */
export function projectTeamEvents(
  model: TeamDomainReadModel,
  events: ReadonlyArray<TeamEvent>,
): Effect.Effect<TeamDomainReadModel, TeamProjectorDecodeError> {
  if (events.length === 0) return Effect.succeed(model);
  let next = model;
  for (const event of events) {
    next = applyTeamEvent(next, event);
  }
  return validateReadModel(next, events[events.length - 1]!.type);
}
