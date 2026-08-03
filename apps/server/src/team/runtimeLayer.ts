import * as Layer from "effect/Layer";

import { TeamCommandReceiptRepositoryLive } from "./Layers/TeamCommandReceipts.ts";
import { TeamEngineLive } from "./Layers/TeamEngine.ts";
import { TeamEventStoreLive } from "./Layers/TeamEventStore.ts";
import * as TeamFileStoreLayer from "./Layers/TeamFileStore.ts";
import { TeamPresenceResolverLive } from "./Layers/TeamPresenceResolver.ts";
import { TeamRelayPresenceLive } from "./Layers/TeamRelayPresence.ts";

export const TeamEventInfrastructureLayerLive = Layer.mergeAll(
  TeamEventStoreLive,
  TeamCommandReceiptRepositoryLive,
);

const TeamRelayPresenceLayerLive = TeamRelayPresenceLive.pipe(
  Layer.provide(TeamFileStoreLayer.layer),
);

export const TeamLayerLive = Layer.mergeAll(
  TeamEventInfrastructureLayerLive,
  TeamEngineLive.pipe(Layer.provide(TeamEventInfrastructureLayerLive)),
  TeamRelayPresenceLayerLive,
  TeamPresenceResolverLive.pipe(
    Layer.provide(TeamRelayPresenceLayerLive),
    Layer.provide(TeamFileStoreLayer.layer),
  ),
);
