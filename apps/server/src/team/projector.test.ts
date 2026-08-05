import { TeamEvent } from "@t3tools/contracts/team";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  applyTeamEvent,
  createEmptyTeamReadModel,
  projectTeamEvent,
  projectTeamEvents,
} from "./projector.ts";

const decodeEvent = Schema.decodeUnknownSync(TeamEvent);
const at = "2026-08-05T09:00:00.000Z";
const aggregateId = "project-scale";

function declaredEvent(): TeamEvent {
  return decodeEvent({
    sequence: 1,
    eventId: "evt-declare",
    aggregateKind: "project",
    aggregateId,
    commandId: "cmd-declare",
    causationEventId: null,
    correlationId: null,
    at,
    metadata: { actorMemberId: "alice" },
    type: "team.channel.declared",
    channelId: "team",
    declaration: { schemaVersion: 1, id: "team", name: "#team" },
  });
}

function postedEvent(index: number): TeamEvent {
  return decodeEvent({
    sequence: index + 2,
    eventId: `evt-post-${index}`,
    aggregateKind: "project",
    aggregateId,
    commandId: `cmd-post-${index}`,
    causationEventId: null,
    correlationId: null,
    at,
    metadata: { actorMemberId: "alice" },
    type: "team.channel.posted",
    postId: `post-${index}`,
    channelId: "team",
    authorId: "alice",
    authorEnvironmentId: null,
    content: { kind: "text", body: `Message #${index}` },
    postedAt: at,
    senderSeq: index + 1,
  });
}

it.effect(
  "projectTeamEvents folds a >1000-event history equivalently to per-event projection",
  () =>
    Effect.gen(function* () {
      // More than DEFAULT_READ_FROM_SEQUENCE_LIMIT so this covers the boot-replay
      // scenario end to end (the store no longer caps readAll at 1000).
      const postCount = 1200;
      const events: TeamEvent[] = [
        declaredEvent(),
        ...Array.from({ length: postCount }, (_, index) => postedEvent(index)),
      ];

      const empty = createEmptyTeamReadModel(at);

      // Reference: validate every event (the single-event path).
      let oneByOne = empty;
      for (const event of events) {
        oneByOne = yield* projectTeamEvent(oneByOne, event);
      }

      // Bulk path: validate once at the end.
      const batch = yield* projectTeamEvents(empty, events);

      assert.deepStrictEqual(batch, oneByOne);
      assert.equal(batch.projects[0]?.posts.length, postCount);
      assert.equal(batch.snapshotSequence, events[events.length - 1]?.sequence);
    }),
);

it.effect("projectTeamEvents on an empty batch returns the base model unchanged", () =>
  Effect.gen(function* () {
    const empty = createEmptyTeamReadModel(at);
    const result = yield* projectTeamEvents(empty, []);
    assert.strictEqual(result, empty);
  }),
);

it("applyTeamEvent is a pure transition (no schema validation, same result as the validated path)", () => {
  const empty = createEmptyTeamReadModel(at);
  const applied = applyTeamEvent(empty, declaredEvent());
  assert.equal(applied.projects[0]?.channels[0]?.id, "team");
  assert.equal(applied.snapshotSequence, 1);
});
