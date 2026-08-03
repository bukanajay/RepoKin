/**
 * Provider-side helpers for compiled RepoKin character instructions.
 *
 * Keep string shaping here so adapter edits stay to small hook calls.
 *
 * @module ProviderCharacterInstructions
 */

export const normalizeRepokinCharacterInstructions = (
  instructions: string | undefined,
): string | undefined => {
  const trimmed = instructions?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const appendRepokinCharacterInstructions = (
  base: string,
  instructions: string | undefined,
): string => {
  const normalized = normalizeRepokinCharacterInstructions(instructions);
  return normalized ? `${base.trimEnd()}\n\n${normalized}` : base;
};

export const prependRepokinPromptText = (
  input: string | undefined,
  instructions: string | undefined,
): string | undefined => {
  const normalized = normalizeRepokinCharacterInstructions(instructions);
  const text = input?.trim();
  if (!normalized) {
    return text && text.length > 0 ? text : undefined;
  }
  if (!text || text.length === 0) {
    return normalized;
  }
  return `${normalized}\n\n<user_prompt>\n${text}\n</user_prompt>`;
};
