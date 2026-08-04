import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import type { AgentProfile } from "@t3tools/contracts/team";
import { SaveIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { useTeamRosterActions } from "./useTeamRosterActions";

const RUNTIME_MODE_OPTIONS: ReadonlyArray<{ value: RuntimeMode; label: string }> = [
  { value: "approval-required", label: "Approval required" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "auto", label: "Auto" },
  { value: "full-access", label: "Full access" },
];

const INTERACTION_MODE_OPTIONS: ReadonlyArray<{ value: ProviderInteractionMode; label: string }> = [
  { value: "default", label: "Default" },
  { value: "plan", label: "Plan" },
];

const DEFAULT_OWNER_ID = "human_local";

function formatList(values: readonly string[] | undefined): string {
  return values?.join("\n") ?? "";
}

function parseList(value: string): readonly string[] | undefined {
  const values = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return values.length === 0 ? undefined : values;
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("grid content-start gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint !== undefined ? <span className="text-xs text-muted-foreground/80">{hint}</span> : null}
    </label>
  );
}

type AgentEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing profile to edit, or null to create a new agent. */
  agent: AgentProfile | null;
  onSaved?: () => void;
};

/**
 * Create/edit an agent's identity and character — moved from Settings into the
 * Team space (R1.4). Writes are local-only; publishing stays in Settings.
 */
export function AgentEditorDialog({ open, onOpenChange, agent, onSaved }: AgentEditorDialogProps) {
  const { saveAgent } = useTeamRosterActions();
  const isCreating = agent === null;

  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState(DEFAULT_OWNER_ID);
  const [persona, setPersona] = useState("");
  const [expertise, setExpertise] = useState("");
  const [conventions, setConventions] = useState("");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("approval-required");
  const [interactionMode, setInteractionMode] = useState<ProviderInteractionMode>("default");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (agent === null) {
      setAgentId("");
      setName("");
      setOwnerId(DEFAULT_OWNER_ID);
      setPersona("");
      setExpertise("");
      setConventions("");
      setRuntimeMode("approval-required");
      setInteractionMode("default");
    } else {
      setAgentId(agent.id);
      setName(agent.name);
      setOwnerId(agent.owner);
      setPersona(agent.character.persona ?? "");
      setExpertise(formatList(agent.character.expertise));
      setConventions(formatList(agent.character.conventions));
      setRuntimeMode(agent.character.runtimeMode ?? "approval-required");
      setInteractionMode(agent.character.interactionMode ?? "default");
    }
    setStatus(null);
  }, [agent, open]);

  const canSave =
    agentId.trim().length > 0 &&
    name.trim().length > 0 &&
    ownerId.trim().length > 0 &&
    persona.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setStatus("Saving…");
    const expertiseValues = parseList(expertise);
    const conventionValues = parseList(conventions);
    const ok = await saveAgent({
      agentId,
      name,
      ownerId,
      character: {
        characterVersion: 1,
        persona: persona.trim(),
        ...(expertiseValues === undefined ? {} : { expertise: expertiseValues }),
        ...(conventionValues === undefined ? {} : { conventions: conventionValues }),
        runtimeMode,
        interactionMode,
      },
    });
    if (ok) {
      onSaved?.();
      onOpenChange(false);
      return;
    }
    setStatus("Save failed. Check the agent id, owner id, and persona.");
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup className="max-w-xl overflow-hidden">
        <AlertDialogHeader className="shrink-0">
          <AlertDialogTitle>{isCreating ? "Create agent" : `Edit ${agent.name}`}</AlertDialogTitle>
          <AlertDialogDescription>
            Configure the identity and behavior this agent uses across its conversations. Saved
            locally to <code>.repokin</code> — publish from Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 items-start gap-x-4 gap-y-4 overflow-y-auto px-6 py-1 sm:grid-cols-2">
          <Field
            label="Agent ID"
            hint={isCreating ? "Stable id, e.g. agent_research." : "IDs cannot change."}
          >
            <Input
              nativeInput
              value={agentId}
              disabled={!isCreating}
              onChange={(event) => setAgentId(event.currentTarget.value)}
              placeholder="agent_research"
            />
          </Field>

          <Field label="Name">
            <Input
              nativeInput
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Aria"
            />
          </Field>

          <Field
            label="Owner ID"
            hint="Human member accountable for this agent."
            className="sm:col-span-2"
          >
            <Input
              nativeInput
              value={ownerId}
              onChange={(event) => setOwnerId(event.currentTarget.value)}
              placeholder="human_local"
            />
          </Field>

          <Field label="Runtime">
            <Select
              value={runtimeMode}
              onValueChange={(value) => {
                if (RUNTIME_MODE_OPTIONS.some((option) => option.value === value)) {
                  setRuntimeMode(value as RuntimeMode);
                }
              }}
            >
              <SelectTrigger className="w-full" aria-label="Runtime mode">
                <SelectValue>
                  {RUNTIME_MODE_OPTIONS.find((option) => option.value === runtimeMode)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start">
                {RUNTIME_MODE_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>

          <Field label="Mode">
            <Select
              value={interactionMode}
              onValueChange={(value) => {
                if (INTERACTION_MODE_OPTIONS.some((option) => option.value === value)) {
                  setInteractionMode(value as ProviderInteractionMode);
                }
              }}
            >
              <SelectTrigger className="w-full" aria-label="Interaction mode">
                <SelectValue>
                  {
                    INTERACTION_MODE_OPTIONS.find((option) => option.value === interactionMode)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start">
                {INTERACTION_MODE_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>

          <Field label="Persona" className="sm:col-span-2">
            <Textarea
              value={persona}
              onChange={(event) => setPersona(event.currentTarget.value)}
              rows={3}
              placeholder="How this agent approaches its work."
            />
          </Field>

          <Field label="Expertise" hint="One per line.">
            <Textarea
              value={expertise}
              onChange={(event) => setExpertise(event.currentTarget.value)}
              rows={4}
            />
          </Field>

          <Field label="Conventions" hint="One per line.">
            <Textarea
              value={conventions}
              onChange={(event) => setConventions(event.currentTarget.value)}
              rows={4}
            />
          </Field>
        </div>

        <AlertDialogFooter className="shrink-0 sm:items-center sm:justify-between">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground max-sm:hidden">
            {status ?? ""}
          </span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button disabled={!canSave || status === "Saving…"} onClick={() => void handleSave()}>
              <SaveIcon className="size-3.5" />
              {isCreating ? "Create agent" : "Save changes"}
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
