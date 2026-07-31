import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  providerConfigWithAgentBinding,
  providerInstanceHasAgentBinding,
  readAgentforgeAgentIds,
} from "./agentforgeBindings";

describe("AgentForge provider-instance bindings", () => {
  it("adds and removes agent ids without dropping unrelated provider config", () => {
    const initial = {
      homePath: "~/.codex_work",
      agentforge: {
        agentIds: ["agent_reviewer"],
        note: "local only",
      },
    };

    const bound = providerConfigWithAgentBinding(initial, "agent_aria", true);
    expect(readAgentforgeAgentIds(bound)).toEqual(["agent_reviewer", "agent_aria"]);
    expect(bound.homePath).toBe("~/.codex_work");
    expect((bound.agentforge as { note?: string }).note).toBe("local only");

    const unbound = providerConfigWithAgentBinding(bound, "agent_reviewer", false);
    expect(readAgentforgeAgentIds(unbound)).toEqual(["agent_aria"]);
    expect(unbound.homePath).toBe("~/.codex_work");
  });

  it("detects bindings by provider instance id", () => {
    const instanceId = ProviderInstanceId.make("codex_work");
    const providerInstances = {
      [instanceId]: {
        driver: ProviderDriverKind.make("codex"),
        config: providerConfigWithAgentBinding({}, "agent_aria", true),
      },
    } satisfies Record<ProviderInstanceId, ProviderInstanceConfig>;

    expect(providerInstanceHasAgentBinding(providerInstances, instanceId, "agent_aria")).toBe(true);
    expect(providerInstanceHasAgentBinding(providerInstances, instanceId, "agent_reviewer")).toBe(
      false,
    );
  });
});
