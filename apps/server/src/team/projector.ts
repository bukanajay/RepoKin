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

function decodeReadModel(
  value: TeamDomainReadModel,
  eventType: TeamEvent["type"],
): Effect.Effect<TeamDomainReadModel, TeamProjectorDecodeError> {
  return Schema.decodeUnknownEffect(TeamDomainReadModelSchema)(value).pipe(
    Effect.mapError(toTeamProjectorDecodeError(eventType)),
  );
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
  }
}

export function projectTeamEvent(
  model: TeamDomainReadModel,
  event: TeamEvent,
): Effect.Effect<TeamDomainReadModel, TeamProjectorDecodeError> {
  const nextBase: TeamDomainReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: eventOccurredAt(event),
  };

  switch (event.type) {
    case "team.member.upserted":
      return decodeReadModel(
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
      return decodeReadModel(
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
      return decodeReadModel(
        {
          ...nextBase,
          projects: upsertProject(nextBase.projects, event.aggregateId, event.sentAt, (project) => {
            const inboxMessage: TeamInboxMessage = {
              messageId: event.messageId,
              senderId: event.senderId,
              recipientId: event.recipientId,
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
      return decodeReadModel(
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
      return decodeReadModel(
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
      return decodeReadModel(
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
      return decodeReadModel(
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
      return decodeReadModel(
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
  }
}
