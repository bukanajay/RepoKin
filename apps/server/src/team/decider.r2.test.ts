import { ProjectId } from "@t3tools/contracts";
import {
  AgentProfile,
  HumanProfile,
  MemberId,
  TeamCommand,
  TeamDomainReadModel,
  type PlannedTeamEvent,
  type TeamEvent,
} from "@t3tools/contracts/team";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TeamCommandInvariantError } from "./Errors.ts";
import { decideTeamCommand } from "./decider.ts";
import { createEmptyTeamReadModel, projectTeamEvent } from "./projector.ts";

const decodeHuman = Schema.decodeUnknownSync(HumanProfile);
const decodeAgent = Schema.decodeUnknownSync(AgentProfile);
const decodeCommand = Schema.decodeUnknownSync(TeamCommand);
const decodeMemberId = Schema.decodeUnknownSync(MemberId);

const projectId = ProjectId.make("project-r2");
const humanId = decodeMemberId("human_ajay");
const agentId = decodeMemberId("agent_aria");

const humanProfile = decodeHuman({
  schemaVersion: 1,
  id: "human_ajay",
  type: "human",
  displayName: "Ajay",
  gitEmails: ["ajay@example.com"],
});

const agentProfile = decodeAgent({
  schemaVersion: 1,
  id: "agent_aria",
  type: "agent",
  name: "Aria",
  owner: "human_ajay",
  character: { characterVersion: 1 },
});

function withSequence(event: PlannedTeamEvent, sequence: number): TeamEvent {
  return { ...event, sequence } as TeamEvent;
}

/** Decide a command, project its event, and return the advanced read model. */
function apply(readModel: TeamDomainReadModel, command: unknown, sequence: number) {
  return Effect.gen(function* () {
    const event = yield* decideTeamCommand({ readModel, command: decodeCommand(command) });
    const next = yield* projectTeamEvent(readModel, withSequence(event, sequence));
    return { event, readModel: next };
  });
}

/** Seed a human + agent roster and a #team channel. */
function seedRoster() {
  return Effect.gen(function* () {
    let readModel = createEmptyTeamReadModel("2026-08-04T12:00:00.000Z");
    let seq = 0;
    for (const profile of [humanProfile, agentProfile]) {
      seq += 1;
      const result = yield* apply(
        readModel,
        { commandId: `cmd-member-${seq}`, projectId, type: "team.member.upsert", profile },
        seq,
      );
      readModel = result.readModel;
    }
    seq += 1;
    const declared = yield* apply(
      readModel,
      {
        commandId: "cmd-channel",
        projectId,
        type: "team.channel.declare",
        declaration: { schemaVersion: 1, id: "team", name: "#team" },
      },
      seq,
    );
    return { readModel: declared.readModel, seq };
  });
}

it.layer(NodeServices.layer)("team R2 decider/projector — channels", (it) => {
  it.effect("declares a channel and projects a human post", () =>
    Effect.gen(function* () {
      const seeded = yield* seedRoster();
      expect(seeded.readModel.projects[0]?.channels.map((c) => c.id)).toEqual(["team"]);

      const posted = yield* apply(
        seeded.readModel,
        {
          commandId: "cmd-post",
          projectId,
          type: "team.channel.post",
          postId: "post-1",
          channelId: "team",
          authorId: humanId,
          content: { kind: "text", body: "kicking off R2" },
          metadata: { actorMemberId: humanId },
        },
        seeded.seq + 1,
      );
      expect(posted.event.type).toBe("team.channel.posted");
      expect(posted.readModel.projects[0]?.posts[0]).toMatchObject({
        postId: "post-1",
        channelId: "team",
        authorId: "human_ajay",
      });
      expect(posted.readModel.projects[0]?.activities.at(-1)?.kind).toBe("channel.posted");
    }),
  );

  it.effect("lets an agent post a structured card but not free text (FR-12.6)", () =>
    Effect.gen(function* () {
      const seeded = yield* seedRoster();

      // A structured card is allowed — it references the agent's work.
      const card = yield* apply(
        seeded.readModel,
        {
          commandId: "cmd-card",
          projectId,
          type: "team.channel.post",
          postId: "post-card",
          channelId: "team",
          authorId: agentId,
          content: { kind: "event", summary: "opened a review" },
        },
        seeded.seq + 1,
      );
      expect(card.event.type).toBe("team.channel.posted");

      // Free text from an agent is rejected as unprompted.
      const failure = yield* Effect.flip(
        decideTeamCommand({
          readModel: seeded.readModel,
          command: decodeCommand({
            commandId: "cmd-chatter",
            projectId,
            type: "team.channel.post",
            postId: "post-chatter",
            channelId: "team",
            authorId: agentId,
            content: { kind: "text", body: "just chatting" },
          }),
        }),
      );
      expect(failure).toBeInstanceOf(TeamCommandInvariantError);
      expect(failure.message).toContain("unprompted");
    }),
  );

  it.effect("rejects posts to an unknown channel", () =>
    Effect.gen(function* () {
      const seeded = yield* seedRoster();
      const failure = yield* Effect.flip(
        decideTeamCommand({
          readModel: seeded.readModel,
          command: decodeCommand({
            commandId: "cmd-post-nochan",
            projectId,
            type: "team.channel.post",
            postId: "post-x",
            channelId: "ghost",
            authorId: humanId,
            content: { kind: "text", body: "hi" },
          }),
        }),
      );
      expect(failure.message).toContain("Channel 'ghost' does not exist");
    }),
  );
});

it.layer(NodeServices.layer)("team R2 decider/projector — board", (it) => {
  it.effect("creates, moves, assigns, and updates a task", () =>
    Effect.gen(function* () {
      const seeded = yield* seedRoster();
      let readModel = seeded.readModel;
      let seq = seeded.seq;

      seq += 1;
      const created = yield* apply(
        readModel,
        {
          commandId: "cmd-task-create",
          projectId,
          type: "team.task.create",
          taskId: "task-1",
          title: "Ship the board",
          description: "Wire the domain",
          labels: ["server"],
          createdById: humanId,
        },
        seq,
      );
      readModel = created.readModel;
      expect(readModel.projects[0]?.tasks[0]).toMatchObject({ taskId: "task-1", state: "backlog" });

      seq += 1;
      const assigned = yield* apply(
        readModel,
        {
          commandId: "cmd-task-assign",
          projectId,
          type: "team.task.assign",
          taskId: "task-1",
          assigneeId: agentId,
          assignedById: humanId,
        },
        seq,
      );
      readModel = assigned.readModel;
      expect(readModel.projects[0]?.tasks[0]?.assigneeId).toBe("agent_aria");

      seq += 1;
      const moved = yield* apply(
        readModel,
        {
          commandId: "cmd-task-move",
          projectId,
          type: "team.task.move",
          taskId: "task-1",
          toState: "in-progress",
          movedById: agentId,
        },
        seq,
      );
      readModel = moved.readModel;
      expect(moved.event).toMatchObject({ type: "team.task.moved", fromState: "backlog" });
      expect(readModel.projects[0]?.tasks[0]?.state).toBe("in-progress");

      // LWW update: only the provided field changes; labels are untouched.
      seq += 1;
      const updated = yield* apply(
        readModel,
        {
          commandId: "cmd-task-update",
          projectId,
          type: "team.task.update",
          taskId: "task-1",
          updatedById: humanId,
          title: "Ship the board domain",
        },
        seq,
      );
      readModel = updated.readModel;
      expect(readModel.projects[0]?.tasks[0]).toMatchObject({
        title: "Ship the board domain",
        labels: ["server"],
      });
    }),
  );

  it.effect("forbids an agent self-assigning (FR-18.2)", () =>
    Effect.gen(function* () {
      const seeded = yield* seedRoster();
      const created = yield* apply(
        seeded.readModel,
        {
          commandId: "cmd-task-create-2",
          projectId,
          type: "team.task.create",
          taskId: "task-2",
          title: "Recon",
          createdById: humanId,
        },
        seeded.seq + 1,
      );

      const failure = yield* Effect.flip(
        decideTeamCommand({
          readModel: created.readModel,
          command: decodeCommand({
            commandId: "cmd-self-assign",
            projectId,
            type: "team.task.assign",
            taskId: "task-2",
            assigneeId: agentId,
            assignedById: agentId,
          }),
        }),
      );
      expect(failure.message).toContain("self-assign");
    }),
  );

  it.effect("forbids an agent marking its own task done (FR-18.3)", () =>
    Effect.gen(function* () {
      const seeded = yield* seedRoster();
      let readModel = seeded.readModel;

      const created = yield* apply(
        readModel,
        {
          commandId: "cmd-task-create-3",
          projectId,
          type: "team.task.create",
          taskId: "task-3",
          title: "Implement",
          createdById: humanId,
          assigneeId: agentId,
        },
        seeded.seq + 1,
      );
      readModel = created.readModel;

      const failure = yield* Effect.flip(
        decideTeamCommand({
          readModel,
          command: decodeCommand({
            commandId: "cmd-self-done",
            projectId,
            type: "team.task.move",
            taskId: "task-3",
            toState: "done",
            movedById: agentId,
          }),
        }),
      );
      expect(failure.message).toContain("done");

      // A human may move the agent's task to done.
      const humanDone = yield* decideTeamCommand({
        readModel,
        command: decodeCommand({
          commandId: "cmd-human-done",
          projectId,
          type: "team.task.move",
          taskId: "task-3",
          toState: "done",
          movedById: humanId,
        }),
      });
      expect(humanDone.type).toBe("team.task.moved");
    }),
  );
});
