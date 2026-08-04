import type { Character } from "@t3tools/contracts/team";

/** Pure derivation of the mechanical-fact badges shown for an agent. */

export type AgentBadge = {
  key: "provider" | "runtime-mode" | "interaction-mode" | "path-scope" | "tool-policy";
  label: string;
  /** Full detail for tooltips when the label is a summary. */
  detail?: string;
};

const DRIVER_LABELS: Record<string, string> = {
  codex: "Codex",
  claudeAgent: "Claude Code",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
};

const RUNTIME_MODE_LABELS: Record<string, string> = {
  "approval-required": "Approval required",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

function summarizeList(values: readonly string[], noun: string): { label: string; detail: string } {
  const detail = values.join(", ");
  if (values.length === 1) return { label: values[0]!, detail };
  return { label: `${values.length} ${noun}`, detail };
}

export function deriveAgentBadges(character: Character): AgentBadge[] {
  const badges: AgentBadge[] = [];

  if (character.provider !== undefined) {
    const driverLabel = DRIVER_LABELS[character.provider.driver] ?? character.provider.driver;
    badges.push({
      key: "provider",
      label:
        character.provider.model !== undefined
          ? `${driverLabel} · ${character.provider.model}`
          : driverLabel,
    });
  }

  const runtimeMode = character.runtimeMode ?? "approval-required";
  badges.push({
    key: "runtime-mode",
    label: RUNTIME_MODE_LABELS[runtimeMode] ?? runtimeMode,
  });

  if (character.interactionMode !== undefined && character.interactionMode !== "default") {
    badges.push({ key: "interaction-mode", label: "Plan mode" });
  }

  const pathScope = character.pathScope ?? [];
  if (pathScope.length > 0) {
    const { label, detail } = summarizeList(pathScope, "path scopes");
    badges.push({ key: "path-scope", label: `May edit ${label}`, detail: `May edit: ${detail}` });
  }

  const allow = character.toolPolicy?.allow ?? [];
  const deny = character.toolPolicy?.deny ?? [];
  if (allow.length > 0 || deny.length > 0) {
    const parts: string[] = [];
    if (allow.length > 0) parts.push(`${allow.length} allowed`);
    if (deny.length > 0) parts.push(`${deny.length} denied`);
    const detailParts: string[] = [];
    if (allow.length > 0) detailParts.push(`Allowed: ${allow.join(", ")}`);
    if (deny.length > 0) detailParts.push(`Denied: ${deny.join(", ")}`);
    badges.push({
      key: "tool-policy",
      label: `Tools: ${parts.join(" / ")}`,
      detail: detailParts.join(" · "),
    });
  }

  return badges;
}
