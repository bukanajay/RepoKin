import { CommandId, EventId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { MemberId } from "@t3tools/contracts/team";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { TeamEventStore } from "../Services/TeamEventStore.ts";
import { TeamEventStoreLive } from "./TeamEventStore.ts";

const layer = it.layer(TeamEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));
const decodeMemberId = Schema.decodeUnknownSync(MemberId);

layer("TeamEventStore", (it) => {
  it.effect("stores and replays typed team events", () =>
    Effect.gen(function* () {
      const eventStore = yield* TeamEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-07-30T12:00:00.000Z";

      const appended = yield* eventStore.append({
        eventId: EventId.make("evt-team-message"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-team"),
        type: "team.message.queued",
        commandId: CommandId.make("cmd-team-message"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-team-message"),
        messageId: MessageId.make("message-team"),
        senderId: decodeMemberId("human_julius"),
        recipientId: decodeMemberId("agent_aria"),
        body: "Please take this.",
        threadId: ThreadId.make("thread-team"),
        sentAt: now,
        expiresAt: null,
        metadata: { actorMemberId: decodeMemberId("human_julius") },
      });

      assert.equal(appended.sequence, 1);
      assert.equal(appended.type, "team.message.queued");

      const storedRows = yield* sql<{ readonly eventJson: string }>`
        SELECT event_json AS "eventJson"
        FROM team_events
        WHERE event_id = ${appended.eventId}
      `;
      assert.equal(typeof storedRows[0]?.eventJson, "string");

      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(replayed.length, 1);
      assert.equal(replayed[0]?.sequence, 1);
      assert.equal(replayed[0]?.type, "team.message.queued");
      assert.equal(replayed[0]?.metadata.actorMemberId, "human_julius");
    }),
  );
});
