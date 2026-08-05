import { CommandId, EventId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { ChannelId, MemberId, PostId } from "@t3tools/contracts/team";
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

  it.effect("readAll replays the full history past the bounded read limit", () =>
    Effect.gen(function* () {
      const eventStore = yield* TeamEventStore;
      const aggregateId = ProjectId.make("project-scale");
      const author = decodeMemberId("agent_aria");
      // More than DEFAULT_READ_FROM_SEQUENCE_LIMIT (1000), spanning several
      // READ_PAGE_SIZE pages, so a capped readAll would silently drop the tail.
      const total = 1050;
      // Replay order is by sequence, not timestamp, so a constant time is fine.
      const postedAt = "2026-08-05T09:00:00.000Z";

      yield* Effect.forEach(
        Array.from({ length: total }, (_, index) => index),
        (index) =>
          eventStore.append({
            eventId: EventId.make(`evt-post-${index}`),
            aggregateKind: "project",
            aggregateId,
            type: "team.channel.posted",
            commandId: CommandId.make(`cmd-post-${index}`),
            causationEventId: null,
            correlationId: null,
            postId: PostId.make(`post-${index}`),
            channelId: ChannelId.make("team"),
            authorId: author,
            authorEnvironmentId: null,
            content: { kind: "text", body: `Message #${index}` },
            postedAt,
            at: postedAt,
            metadata: { actorMemberId: author },
          }),
        { discard: true },
      );

      const all = yield* Stream.runCollect(eventStore.readAll()).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      // The in-memory store is shared across cases, so scope to this aggregate.
      const mine = all.filter((event) => event.aggregateId === aggregateId);
      assert.equal(mine.length, total);
      // Nothing beyond event 1000 is lost: last event present, order preserved.
      assert.equal(mine[mine.length - 1]?.eventId, `evt-post-${total - 1}`);

      // Bounded consumers (readEvents RPC) still honor an explicit limit.
      const bounded = yield* Stream.runCollect(eventStore.readFromSequence(0, 500)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(bounded.length, 500);
    }),
  );
});
