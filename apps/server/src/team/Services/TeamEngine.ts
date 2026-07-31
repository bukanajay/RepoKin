import type { TeamCommand, TeamDomainReadModel, TeamEvent } from "@t3tools/contracts/team";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { TeamEventStoreError } from "../../persistence/Errors.ts";
import type { TeamDispatchError } from "../Errors.ts";

export interface TeamEngineShape {
  readonly dispatch: (
    command: TeamCommand,
  ) => Effect.Effect<{ readonly sequence: number }, TeamDispatchError>;

  readonly readEvents: (
    fromSequenceExclusive: number,
    limit?: number,
  ) => Stream.Stream<TeamEvent, TeamEventStoreError>;

  readonly latestSequence: Effect.Effect<number>;

  readonly getReadModel: Effect.Effect<TeamDomainReadModel>;

  readonly streamDomainEvents: Stream.Stream<TeamEvent>;
}

export class TeamEngineService extends Context.Service<TeamEngineService, TeamEngineShape>()(
  "t3/team/Services/TeamEngine/TeamEngineService",
) {}
