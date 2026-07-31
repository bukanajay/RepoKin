import { CommandId, ProjectId } from "@t3tools/contracts";
import { AgentProfile, HumanProfile, TeamCommand } from "@t3tools/contracts/team";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";
import { TeamCommandReceiptRepositoryLive } from "./TeamCommandReceipts.ts";
import { TeamEngineLive } from "./TeamEngine.ts";
import { TeamEventStoreLive } from "./TeamEventStore.ts";

const decodeHuman = Schema.decodeUnknownSync(HumanProfile);
const decodeAgent = Schema.decodeUnknownSync(AgentProfile);
const decodeCommand = Schema.decodeUnknownSync(TeamCommand);

const layer = it.layer(
  Layer.mergeAll(
    TeamEventStoreLive,
    TeamCommandReceiptRepositoryLive,
    TeamEngineLive.pipe(
      Layer.provide(Layer.mergeAll(TeamEventStoreLive, TeamCommandReceiptRepositoryLive)),
    ),
  ).pipe(Layer.provideMerge(SqlitePersistenceMemory), Layer.provideMerge(NodeServices.layer)),
);

layer("TeamEngine", (it) => {
  it.effect("dispatches commands, persists events, and deduplicates command ids", () =>
    Effect.gen(function* () {
      const engine = yield* TeamEngineService;
      const projectId = ProjectId.make("project-team-engine");

      const humanCommand = decodeCommand({
        commandId: CommandId.make("cmd-human-upsert"),
        projectId,
        type: "team.member.upsert",
        profile: decodeHuman({
          schemaVersion: 1,
          id: "human_julius",
          type: "human",
          displayName: "Julius",
          gitEmails: ["julius@example.com"],
        }),
      });
      const agentCommand = decodeCommand({
        commandId: CommandId.make("cmd-agent-upsert"),
        projectId,
        type: "team.member.upsert",
        profile: decodeAgent({
          schemaVersion: 1,
          id: "agent_aria",
          type: "agent",
          name: "Aria",
          owner: "human_julius",
          character: { characterVersion: 1 },
          createdAt: "2026-07-30T12:00:00.000Z",
          updatedAt: "2026-07-30T12:00:00.000Z",
        }),
      });

      const humanResult = yield* engine.dispatch(humanCommand);
      const duplicateHumanResult = yield* engine.dispatch(humanCommand);
      const agentResult = yield* engine.dispatch(agentCommand);

      assert.equal(humanResult.sequence, 1);
      assert.equal(duplicateHumanResult.sequence, 1);
      assert.equal(agentResult.sequence, 2);
      assert.equal(yield* engine.latestSequence, 2);

      const events = yield* Stream.runCollect(engine.readEvents(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(events.length, 2);
      assert.deepStrictEqual(
        events.map((event) => event.type),
        ["team.member.upserted", "team.member.upserted"],
      );
    }),
  );
});
