/**
 * TeamFileStore — read and write the `.repokin/` roster.
 *
 * Reads never checkout or pull. Remote roster reads use `git show <ref>:<path>`.
 * Malformed profiles become warnings, never fatal failures.
 * Writes touch only `.repokin/` and optionally produce their own commit.
 *
 * @module TeamFileStore
 */
import type {
  AgentProfile,
  HumanProfile,
  TeamFile,
  TeamRosterReadModel,
} from "@t3tools/contracts/team";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class TeamFileStoreError extends Schema.TaggedErrorClass<TeamFileStoreError>()(
  "TeamFileStoreError",
  {
    operation: Schema.Literals(["write", "commit", "read", "resolve-root", "encode"]),
    workspaceRoot: Schema.String,
    path: Schema.optionalKey(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const target = this.path ?? this.workspaceRoot;
    return `TeamFileStore ${this.operation} failed at ${target}.`;
  }
}

export interface TeamWriteResult {
  /** Absolute path written. */
  readonly path: string;
  /** Whether a git commit was created for this write. */
  readonly committed: boolean;
}

export interface TeamFileStoreShape {
  /**
   * Read the full roster from the working tree under `.repokin/`.
   * Missing directory → empty roster. Bad files → warnings only.
   */
  readonly readRoster: (workspaceRoot: string) => Effect.Effect<TeamRosterReadModel>;

  /**
   * Read the roster from a git ref without touching the working tree.
   * Uses `git ls-tree` + `git show <ref>:<path>` only.
   */
  readonly readRosterFromRef: (
    workspaceRoot: string,
    ref: string,
  ) => Effect.Effect<TeamRosterReadModel>;

  readonly writeTeamFile: (
    workspaceRoot: string,
    team: TeamFile,
    options?: {
      readonly commitMessage?: string;
      readonly commit?: boolean;
    },
  ) => Effect.Effect<TeamWriteResult, TeamFileStoreError>;

  readonly writeHumanProfile: (
    workspaceRoot: string,
    profile: HumanProfile,
    options?: {
      readonly fileSlug?: string;
      readonly commitMessage?: string;
      readonly commit?: boolean;
    },
  ) => Effect.Effect<TeamWriteResult, TeamFileStoreError>;

  readonly writeAgentProfile: (
    workspaceRoot: string,
    profile: AgentProfile,
    options?: {
      readonly fileSlug?: string;
      readonly commitMessage?: string;
      readonly commit?: boolean;
    },
  ) => Effect.Effect<TeamWriteResult, TeamFileStoreError>;
}

export class TeamFileStore extends Context.Service<TeamFileStore, TeamFileStoreShape>()(
  "t3/team/Services/TeamFileStore",
) {}
