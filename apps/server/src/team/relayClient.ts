/**
 * Shared plumbing for talking to the T3 Connect relay from the team domain:
 * reading link credentials from the secret store and building an
 * environment-authenticated relay client. Used by both TeamRelayMessaging
 * (M3.2) and TeamRelayPresence (M3.3) so neither duplicates the other.
 *
 * @module relayClient
 */
import { RelayApi } from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "../cloud/config.ts";

export interface TeamRelayConfig {
  readonly url: string;
  readonly issuer: string;
  readonly environmentCredential: string;
}

export const readTeamRelayConfig = (secrets: ServerSecretStore.ServerSecretStore["Service"]) =>
  Effect.gen(function* () {
    const readSecretString = (name: string) =>
      secrets
        .get(name)
        .pipe(
          Effect.map((bytes) =>
            Option.isSome(bytes) ? new TextDecoder().decode(bytes.value) : null,
          ),
        );
    const [url, issuer, environmentCredential] = yield* Effect.all([
      readSecretString(RELAY_URL_SECRET),
      readSecretString(RELAY_ISSUER_SECRET),
      readSecretString(RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
    ]);
    return url && environmentCredential
      ? ({ url, issuer: issuer ?? url, environmentCredential } satisfies TeamRelayConfig)
      : null;
  });

export const makeTeamRelayClient = (relayConfig: TeamRelayConfig) =>
  HttpApiClient.make(RelayApi, {
    baseUrl: relayConfig.url,
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.setHeader("authorization", `Bearer ${relayConfig.environmentCredential}`),
    ),
  }).pipe(Effect.provide(FetchHttpClient.layer));
