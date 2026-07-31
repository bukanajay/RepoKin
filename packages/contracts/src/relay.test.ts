import { describe, expect, it } from "vite-plus/test";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { RelayApi } from "./relay.ts";

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });

  it("exposes the environment-authenticated team message delivery endpoint", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.paths["/v1/team/messages"]?.post?.summary).toBe(
      "Deliver a signed team message envelope",
    );
    expect(document.paths["/v1/team/messages"]?.post?.security).toEqual([
      { environmentBearer: [] },
    ]);
  });

  it("exposes the environment-authenticated team message poll endpoint", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.paths["/v1/team/messages"]?.get?.summary).toBe(
      "Poll and drain signed team messages queued for this environment",
    );
    expect(document.paths["/v1/team/messages"]?.get?.security).toEqual([{ environmentBearer: [] }]);
  });
});
