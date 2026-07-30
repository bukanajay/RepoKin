/**
 * LocalIdentityResolver — resolve the local human identity from git config.
 *
 * Anchors AgentForge human membership on `user.name` / `user.email` (PRD FR-1.3).
 * Never invents an identity from the OS user.
 *
 * @module LocalIdentityResolver
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface LocalGitIdentity {
  readonly name: string | null;
  readonly email: string | null;
}

export interface LocalIdentityResolverShape {
  /**
   * Resolve git user.name / user.email for the repository containing `cwd`.
   * Cached per git top-level (or cwd when not a git repo).
   */
  readonly resolve: (cwd: string) => Effect.Effect<LocalGitIdentity>;
}

export class LocalIdentityResolver extends Context.Service<
  LocalIdentityResolver,
  LocalIdentityResolverShape
>()("t3/team/Services/LocalIdentityResolver") {}
