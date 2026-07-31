import type { ProviderInstanceConfig, ProviderInstanceId } from "@t3tools/contracts";

export const AGENTFORGE_PROVIDER_CONFIG_KEY = "agentforge";
export const AGENTFORGE_PROVIDER_AGENT_IDS_KEY = "agentIds";

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

export function readAgentforgeAgentIds(config: unknown): readonly string[] {
  const root = readObject(config);
  const agentforge = readObject(root[AGENTFORGE_PROVIDER_CONFIG_KEY]);
  const rawAgentIds = agentforge[AGENTFORGE_PROVIDER_AGENT_IDS_KEY];
  return Array.isArray(rawAgentIds)
    ? rawAgentIds.filter((value): value is string => typeof value === "string")
    : [];
}

export function providerConfigWithAgentBinding(
  config: unknown,
  agentId: string,
  bound: boolean,
): Record<string, unknown> {
  const root = readObject(config);
  const agentforge = readObject(root[AGENTFORGE_PROVIDER_CONFIG_KEY]);
  const currentAgentIds = readAgentforgeAgentIds(config);
  const nextAgentIds = bound
    ? Array.from(new Set([...currentAgentIds, agentId]))
    : currentAgentIds.filter((candidate) => candidate !== agentId);

  return {
    ...root,
    [AGENTFORGE_PROVIDER_CONFIG_KEY]: {
      ...agentforge,
      [AGENTFORGE_PROVIDER_AGENT_IDS_KEY]: nextAgentIds,
    },
  };
}

export function providerInstanceHasAgentBinding(
  providerInstances: Readonly<Record<ProviderInstanceId, ProviderInstanceConfig>>,
  instanceId: ProviderInstanceId,
  agentId: string,
): boolean {
  return readAgentforgeAgentIds(providerInstances[instanceId]?.config).includes(agentId);
}
