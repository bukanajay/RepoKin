/**
 * LocalIdentityResolver live layer — git config user.name / user.email.
 *
 * @module LocalIdentityResolverLayer
 */
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../../processRunner.ts";
import {
  LocalIdentityResolver,
  type LocalGitIdentity,
  type LocalIdentityResolverShape,
} from "../Services/LocalIdentityResolver.ts";

const DEFAULT_CACHE_CAPACITY = 256;
const DEFAULT_POSITIVE_CACHE_TTL = Duration.minutes(1);
const DEFAULT_NEGATIVE_CACHE_TTL = Duration.minutes(1);

export interface LocalIdentityResolverOptions {
  readonly cacheCapacity?: number;
  readonly positiveCacheTtl?: Duration.Input;
  readonly negativeCacheTtl?: Duration.Input;
}

const emptyIdentity: LocalGitIdentity = { name: null, email: null };

const readGitConfigValue = Effect.fn("LocalIdentityResolver.readGitConfigValue")(function* (
  cwd: string,
  key: "user.name" | "user.email",
) {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const result = yield* processRunner
    .run({
      command: "git",
      args: ["-C", cwd, "config", "--get", key],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);

  if (result._tag === "None" || result.value.code !== 0) {
    return null;
  }

  const value = result.value.stdout.trim();
  return value.length > 0 ? value : null;
});

const resolveGitTopLevel = Effect.fn("LocalIdentityResolver.resolveGitTopLevel")(function* (
  cwd: string,
) {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const result = yield* processRunner
    .run({
      command: "git",
      args: ["-C", cwd, "rev-parse", "--show-toplevel"],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);

  if (result._tag === "None" || result.value.code !== 0) {
    return cwd;
  }

  const topLevel = result.value.stdout.trim();
  return topLevel.length > 0 ? topLevel : cwd;
});

const resolveIdentityAtRoot = Effect.fn("LocalIdentityResolver.resolveAtRoot")(function* (
  root: string,
): Effect.fn.Return<LocalGitIdentity, never, ProcessRunner.ProcessRunner> {
  const name = yield* readGitConfigValue(root, "user.name");
  const email = yield* readGitConfigValue(root, "user.email");
  if (name === null && email === null) {
    return emptyIdentity;
  }
  return { name, email };
});

export const make = Effect.fn("LocalIdentityResolver.make")(function* (
  options: LocalIdentityResolverOptions = {},
) {
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const identityCache = yield* Cache.makeWith<string, LocalGitIdentity>(
    (cacheKey) =>
      resolveIdentityAtRoot(cacheKey).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
      ),
    {
      capacity: options.cacheCapacity ?? DEFAULT_CACHE_CAPACITY,
      timeToLive: Exit.match({
        onSuccess: (value) =>
          value.name === null && value.email === null
            ? (options.negativeCacheTtl ?? DEFAULT_NEGATIVE_CACHE_TTL)
            : (options.positiveCacheTtl ?? DEFAULT_POSITIVE_CACHE_TTL),
        onFailure: () => Duration.zero,
      }),
    },
  );

  const resolve: LocalIdentityResolverShape["resolve"] = Effect.fn("LocalIdentityResolver.resolve")(
    function* (cwd) {
      const cacheKey = yield* resolveGitTopLevel(cwd).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
      );
      return yield* Cache.get(identityCache, cacheKey);
    },
  );

  return LocalIdentityResolver.of({ resolve });
});

export const layer = Layer.effect(LocalIdentityResolver, make()).pipe(
  Layer.provide(ProcessRunner.layer),
);
