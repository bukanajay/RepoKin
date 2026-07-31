import type { PlannedTeamEvent, TeamEvent } from "@t3tools/contracts/team";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { TeamEventStoreError } from "../../persistence/Errors.ts";

export interface TeamEventStoreShape {
  readonly append: (event: PlannedTeamEvent) => Effect.Effect<TeamEvent, TeamEventStoreError>;

  readonly readFromSequence: (
    sequenceExclusive: number,
    limit?: number,
  ) => Stream.Stream<TeamEvent, TeamEventStoreError>;

  readonly readAll: () => Stream.Stream<TeamEvent, TeamEventStoreError>;
}

export class TeamEventStore extends Context.Service<TeamEventStore, TeamEventStoreShape>()(
  "t3/team/Services/TeamEventStore",
) {}
