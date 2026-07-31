import type { AgentId, CompiledCharacterMechanics } from "@t3tools/contracts/team";

export type TrustedMechanicsByProject = Readonly<Record<string, Readonly<Record<string, string>>>>;

export type CharacterTrustStatus = "trusted" | "untrusted" | "changed";

export function readTrustedMechanicalHash(input: {
  readonly trustedMechanics: TrustedMechanicsByProject;
  readonly projectKey: string;
  readonly agentId: AgentId;
}): string | undefined {
  return input.trustedMechanics[input.projectKey]?.[input.agentId];
}

export function evaluateCharacterTrust(input: {
  readonly trustedMechanics: TrustedMechanicsByProject;
  readonly projectKey: string;
  readonly agentId: AgentId;
  readonly mechanicalHash: string;
}): CharacterTrustStatus {
  const trustedHash = readTrustedMechanicalHash(input);
  if (trustedHash === undefined) {
    return "untrusted";
  }
  return trustedHash === input.mechanicalHash ? "trusted" : "changed";
}

export function trustMechanicalHash(input: {
  readonly trustedMechanics: TrustedMechanicsByProject;
  readonly projectKey: string;
  readonly agentId: AgentId;
  readonly mechanicalHash: string;
}): Record<string, Record<string, string>> {
  return {
    ...input.trustedMechanics,
    [input.projectKey]: {
      ...(input.trustedMechanics[input.projectKey] ?? {}),
      [input.agentId]: input.mechanicalHash,
    },
  };
}

export function summarizeMechanicalSettings(
  mechanics: CompiledCharacterMechanics,
): readonly string[] {
  const summary = [
    `Runtime: ${mechanics.runtimeMode}`,
    `Interaction: ${mechanics.interactionMode}`,
  ];
  if (mechanics.provider) {
    summary.push(
      `Provider: ${mechanics.provider.driver}${
        mechanics.provider.model ? ` / ${mechanics.provider.model}` : ""
      }`,
    );
  }
  if (mechanics.pathScope && mechanics.pathScope.length > 0) {
    summary.push(`Path scope: ${mechanics.pathScope.join(", ")}`);
  }
  if (mechanics.toolPolicy?.allow && mechanics.toolPolicy.allow.length > 0) {
    summary.push(`Allowed tools: ${mechanics.toolPolicy.allow.join(", ")}`);
  }
  if (mechanics.toolPolicy?.deny && mechanics.toolPolicy.deny.length > 0) {
    summary.push(`Denied tools: ${mechanics.toolPolicy.deny.join(", ")}`);
  }
  return summary;
}
