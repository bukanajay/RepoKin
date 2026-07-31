import { CommandId, ProjectId } from "@t3tools/contracts";
import { AgentProfile, HumanProfile, TeamCommand } from "@t3tools/contracts/team";
import { assert, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { TeamCommandReceiptRepositoryLive } from "./TeamCommandReceipts.ts";
import { TeamEngineLive } from "./TeamEngine.ts";
import { TeamEventStoreLive } from "./TeamEventStore.ts";
import { TeamInboxDeliveryReactor } from "../Services/TeamInboxDeliveryReactor.ts";
import { TeamEngineService } from "../Services/TeamEngine.ts";
import { TeamPresenceResolver } from "../Services/TeamPresenceResolver.ts";
import {
  TeamInboxDeliveryReactorLive,
  resolveQueuedTeamMessageDelivery,
} from "./TeamInboxDeliveryReactor.ts";

const decodeHuman = Schema.decodeUnknownSync(HumanProfile);
const decodeAgent = Schema.decodeUnknownSync(AgentProfile);
const decodeCommand = Schema.decodeUnknownSync(TeamCommand);

const fakePresenceResolver = Layer.succeed(
  TeamPresenceResolver,
  TeamPresenceResolver.of({
    resolveMemberPresence: () => Effect.succeed("online"),
  }),
);

const fakeOrchestrationEngine = Layer.succeed(
  OrchestrationEngineService,
  OrchestrationEngineService.of({
    dispatch: () => Effect.die("unexpected orchestration dispatch"),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  }),
);

const eventInfrastructure = Layer.mergeAll(TeamEventStoreLive, TeamCommandReceiptRepositoryLive);
const teamEngineLayer = TeamEngineLive.pipe(Layer.provide(eventInfrastructure));
const reactorLayer = TeamInboxDeliveryReactorLive.pipe(
  Layer.provideMerge(teamEngineLayer),
  Layer.provide(fakePresenceResolver),
  Layer.provide(fakeOrchestrationEngine),
);
const layer = it.layer(
  Layer.mergeAll(eventInfrastructure, teamEngineLayer, reactorLayer).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

let mutablePresence: "online" | "busy" | "away" | "offline" | null = "busy";
const mutablePresenceResolver = Layer.succeed(
  TeamPresenceResolver,
  TeamPresenceResolver.of({
    resolveMemberPresence: () => Effect.sync(() => mutablePresence),
  }),
);
const mutablePresenceReactorLayer = TeamInboxDeliveryReactorLive.pipe(
  Layer.provideMerge(teamEngineLayer),
  Layer.provide(mutablePresenceResolver),
  Layer.provide(fakeOrchestrationEngine),
);
const mutablePresenceLayer = it.layer(
  Layer.mergeAll(eventInfrastructure, teamEngineLayer, mutablePresenceReactorLayer).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

layer("TeamInboxDeliveryReactor", (it) => {
  it("waits for busy/offline recipients and expires elapsed TTLs", () => {
    assert.equal(
      resolveQueuedTeamMessageDelivery({
        message: { expiresAt: null },
        recipientPresence: "busy",
        nowMs: 1_000,
      }),
      "wait",
    );
    assert.equal(
      resolveQueuedTeamMessageDelivery({
        message: { expiresAt: "2026-07-30T12:00:00.000Z" },
        recipientPresence: "online",
        nowMs: Date.parse("2026-07-30T12:00:00.001Z"),
      }),
      "expire",
    );
  });

  it.effect("delivers queued messages when the resolver reports the agent online", () =>
    Effect.gen(function* () {
      const engine = yield* TeamEngineService;
      const delivery = yield* TeamInboxDeliveryReactor;
      const projectId = ProjectId.make("project-team-delivery");

      for (const command of [
        decodeCommand({
          commandId: CommandId.make("cmd-human-upsert-delivery"),
          projectId,
          type: "team.member.upsert",
          profile: decodeHuman({
            schemaVersion: 1,
            id: "human_julius",
            type: "human",
            displayName: "Julius",
            gitEmails: ["julius@example.com"],
          }),
        }),
        decodeCommand({
          commandId: CommandId.make("cmd-agent-upsert-delivery"),
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
        }),
        decodeCommand({
          commandId: CommandId.make("cmd-message-send-delivery"),
          projectId,
          type: "team.message.send",
          messageId: "message-delivery",
          senderId: "human_julius",
          recipientId: "agent_aria",
          body: "Please take this.",
        }),
      ]) {
        yield* engine.dispatch(command);
      }

      yield* delivery.enqueueProject(projectId);
      yield* delivery.drain;

      const readModel = yield* engine.getReadModel;
      const message = readModel.projects[0]?.inbox.find(
        (entry) => entry.messageId === "message-delivery",
      );
      assert.equal(message?.state, "delivered");
      assert.isNotNull(message?.deliveredAt ?? null);
    }),
  );
});

mutablePresenceLayer("TeamInboxDeliveryReactor queued retry", (it) => {
  it.effect(
    "keeps busy recipient messages queued and delivers them after presence turns online",
    () =>
      Effect.gen(function* () {
        mutablePresence = "busy";
        const engine = yield* TeamEngineService;
        const delivery = yield* TeamInboxDeliveryReactor;
        const projectId = ProjectId.make("project-team-delivery-retry");

        for (const command of [
          decodeCommand({
            commandId: CommandId.make("cmd-human-upsert-delivery-retry"),
            projectId,
            type: "team.member.upsert",
            profile: decodeHuman({
              schemaVersion: 1,
              id: "human_julius",
              type: "human",
              displayName: "Julius",
              gitEmails: ["julius@example.com"],
            }),
          }),
          decodeCommand({
            commandId: CommandId.make("cmd-agent-upsert-delivery-retry"),
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
          }),
          decodeCommand({
            commandId: CommandId.make("cmd-message-send-delivery-retry"),
            projectId,
            type: "team.message.send",
            messageId: "message-delivery-retry",
            senderId: "human_julius",
            recipientId: "agent_aria",
            body: "Queue this until the agent is back.",
          }),
        ]) {
          yield* engine.dispatch(command);
        }

        yield* delivery.enqueueProject(projectId);
        yield* delivery.drain;
        let readModel = yield* engine.getReadModel;
        let message = readModel.projects[0]?.inbox.find(
          (entry) => entry.messageId === "message-delivery-retry",
        );
        expect(message?.state).toBe("queued");

        mutablePresence = "online";
        yield* delivery.enqueueProject(projectId);
        yield* delivery.drain;
        readModel = yield* engine.getReadModel;
        message = readModel.projects[0]?.inbox.find(
          (entry) => entry.messageId === "message-delivery-retry",
        );
        expect(message?.state).toBe("delivered");
      }),
  );
});
