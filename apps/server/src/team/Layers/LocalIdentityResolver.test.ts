import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../../processRunner.ts";
import { LocalIdentityResolver as LocalIdentityResolverTag } from "../Services/LocalIdentityResolver.ts";
import * as LocalIdentityResolver from "./LocalIdentityResolver.ts";

const git = (cwd: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    return yield* processRunner.run({
      command: "git",
      args: ["-C", cwd, ...args],
      ...(env === undefined ? {} : { env }),
    });
  }).pipe(Effect.provide(ProcessRunner.layer));

const TestLayer = LocalIdentityResolver.layer.pipe(Layer.provideMerge(NodeServices.layer));

it.layer(TestLayer)("LocalIdentityResolver", (it) => {
  it.effect("resolves user.name and user.email from local git config", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-local-identity-",
      });
      const isolatedHome = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-git-home-",
      });
      const env = {
        ...process.env,
        HOME: isolatedHome,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      };

      yield* git(cwd, ["init"], env);
      yield* git(cwd, ["config", "--local", "user.name", "Julius"], env);
      yield* git(cwd, ["config", "--local", "user.email", "julius@example.com"], env);

      // Resolver uses process env; seed the same local config without isolated HOME
      // by writing via default env after init — local config lives in .git/config.
      yield* git(cwd, ["config", "--local", "user.name", "Julius"]);
      yield* git(cwd, ["config", "--local", "user.email", "julius@example.com"]);

      const resolver = yield* LocalIdentityResolverTag;
      const identity = yield* resolver.resolve(cwd);

      expect(identity).toEqual({
        name: "Julius",
        email: "julius@example.com",
      });
    }),
  );

  it.effect("does not invent an identity for a non-git directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "repokin-local-identity-nongit-",
      });

      const resolver = yield* LocalIdentityResolverTag;
      const identity = yield* resolver.resolve(cwd);

      // Never invent OS-user identity. Values are only from git config (null here
      // when the directory is not a repo and no usable config is visible).
      expect(identity).toEqual({ name: null, email: null });
    }),
  );
});
