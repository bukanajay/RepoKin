/**
 * Provider-side helpers for compiled AgentForge character instructions.
 *
 * Keep string shaping here so adapter edits stay to small hook calls.
 *
 * @module ProviderCharacterInstructions
 */

export const normalizeAgentforgeCharacterInstructions = (
  instructions: string | undefined,
): string | undefined => {
  const trimmed = instructions?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const appendAgentforgeCharacterInstructions = (
  base: string,
  instructions: string | undefined,
): string => {
  const normalized = normalizeAgentforgeCharacterInstructions(instructions);
  return normalized ? `${base.trimEnd()}\n\n${normalized}` : base;
};

export const prependAgentforgePromptText = (
  input: string | undefined,
  instructions: string | undefined,
): string | undefined => {
  const normalized = normalizeAgentforgeCharacterInstructions(instructions);
  const text = input?.trim();
  if (!normalized) {
    return text && text.length > 0 ? text : undefined;
  }
  if (!text || text.length === 0) {
    return normalized;
  }
  return `${normalized}\n\n<user_prompt>\n${text}\n</user_prompt>`;
};
