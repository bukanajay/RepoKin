import { useAtomValue } from "@effect/atom-react";
import type { ProviderInteractionMode, RuntimeMode, ServerProviderModel } from "@t3tools/contracts";
import { isProviderAvailable, ProviderDriverKind } from "@t3tools/contracts";
import type { AgentDuty, AgentProfile } from "@t3tools/contracts/team";
import { PlusIcon, SaveIcon, TrashIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { primaryServerProvidersAtom } from "../../state/server";
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
/** Sentinel for the "no model preference" option (empty Select values misbehave). */
const MODEL_DEFAULT = "__model_default__";

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
  hint?: string | undefined;
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
  const [driver, setDriver] = useState("");
  const [model, setModel] = useState("");
  const [duties, setDuties] = useState<AgentDuty[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  // One option per configured, available provider driver (codex, claude, grok …).
  const providerOptions = useMemo(() => {
    const byDriver = new Map<
      string,
      { driver: string; label: string; models: readonly ServerProviderModel[] }
    >();
    for (const provider of serverProviders) {
      if (!isProviderAvailable(provider) || byDriver.has(provider.driver)) continue;
      byDriver.set(provider.driver, {
        driver: provider.driver,
        label: provider.displayName ?? provider.driver,
        models: provider.models,
      });
    }
    return [...byDriver.values()];
  }, [serverProviders]);
  const modelOptions = useMemo(
    () => providerOptions.find((option) => option.driver === driver)?.models ?? [],
    [providerOptions, driver],
  );

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
      setDriver("");
      setModel("");
      setDuties([]);
    } else {
      setAgentId(agent.id);
      setName(agent.name);
      setOwnerId(agent.owner);
      setPersona(agent.character.persona ?? "");
      setExpertise(formatList(agent.character.expertise));
      setConventions(formatList(agent.character.conventions));
      setRuntimeMode(agent.character.runtimeMode ?? "approval-required");
      setInteractionMode(agent.character.interactionMode ?? "default");
      setDriver(agent.character.provider?.driver ?? "");
      setModel(agent.character.provider?.model ?? "");
      setDuties([...(agent.duties ?? [])]);
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
        ...(driver.trim().length === 0
          ? {}
          : {
              provider: {
                driver: ProviderDriverKind.make(driver),
                ...(model.trim().length === 0 ? {} : { model: model.trim() }),
              },
            }),
      },
      duties: duties
        .filter((duty) => duty.id.trim().length > 0 && duty.goal.trim().length > 0)
        .map((duty) => ({
          ...duty,
          id: duty.id.trim(),
          goal: duty.goal.trim(),
          reportChannelId: duty.reportChannelId.trim() || "team",
        })),
    });
    if (ok) {
      onSaved?.();
      onOpenChange(false);
      return;
    }
    setStatus("Save failed. Check the agent id, owner id, and persona.");
  };

  const addDuty = () => {
    setDuties((current) => [
      ...current,
      {
        id: `duty-${current.length + 1}`,
        goal: "",
        schedule: { kind: "daily", hourUtc: 9, minuteUtc: 0 },
        reportChannelId: "team",
        enabled: true,
      },
    ]);
  };

  const updateDuty = (index: number, patch: Partial<AgentDuty>) => {
    setDuties((current) =>
      current.map((duty, dutyIndex) => (dutyIndex === index ? { ...duty, ...patch } : duty)),
    );
  };

  const removeDuty = (index: number) => {
    setDuties((current) => current.filter((_, dutyIndex) => dutyIndex !== index));
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

          <Field
            label="Provider"
            hint={
              providerOptions.length === 0
                ? "No providers configured. Set one up in Settings."
                : "Which agent runs this member's delegated work."
            }
          >
            <Select
              value={driver === "" ? null : driver}
              onValueChange={(value) => {
                setDriver(value ?? "");
                setModel("");
              }}
            >
              <SelectTrigger
                className="w-full"
                aria-label="Provider"
                disabled={providerOptions.length === 0}
              >
                <SelectValue>
                  {providerOptions.find((option) => option.driver === driver)?.label ?? "Select…"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start">
                {providerOptions.map((option) => (
                  <SelectItem hideIndicator key={option.driver} value={option.driver}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>

          <Field label="Model" hint={driver === "" ? "Pick a provider first." : undefined}>
            <Select
              value={model === "" ? MODEL_DEFAULT : model}
              onValueChange={(value) => setModel(value === MODEL_DEFAULT ? "" : (value ?? ""))}
            >
              <SelectTrigger
                className="w-full"
                aria-label="Model"
                disabled={modelOptions.length === 0}
              >
                <SelectValue>
                  {modelOptions.find((option) => option.slug === model)?.name ?? "Provider default"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start">
                <SelectItem hideIndicator value={MODEL_DEFAULT}>
                  Provider default
                </SelectItem>
                {modelOptions.map((option) => (
                  <SelectItem hideIndicator key={option.slug} value={option.slug}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
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

          <div className="sm:col-span-2 flex flex-col gap-2 rounded-xl border border-border/70 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Duties (R4)
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="ms-auto"
                onClick={addDuty}
              >
                <PlusIcon className="size-3.5" />
                Add duty
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Scheduled work on the home environment. New or changed duties stay inert until you
              confirm them on the agent profile.
            </p>
            {duties.length === 0 ? (
              <p className="text-xs text-muted-foreground">No duties yet.</p>
            ) : (
              duties.map((duty, index) => (
                <div
                  key={`${duty.id}-${index}`}
                  className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-2 sm:grid-cols-2"
                >
                  <Field label="Duty id">
                    <Input
                      nativeInput
                      value={duty.id}
                      onChange={(event) => updateDuty(index, { id: event.currentTarget.value })}
                      placeholder="nightly-review"
                    />
                  </Field>
                  <Field label="Report channel">
                    <Input
                      nativeInput
                      value={duty.reportChannelId}
                      onChange={(event) =>
                        updateDuty(index, { reportChannelId: event.currentTarget.value })
                      }
                      placeholder="team"
                    />
                  </Field>
                  <Field label="Goal" className="sm:col-span-2">
                    <Textarea
                      value={duty.goal}
                      onChange={(event) => updateDuty(index, { goal: event.currentTarget.value })}
                      rows={2}
                      placeholder="What should this agent do each run?"
                    />
                  </Field>
                  <Field label="Schedule">
                    <Select
                      value={duty.schedule.kind}
                      onValueChange={(value) => {
                        if (value === "interval") {
                          updateDuty(index, {
                            schedule: { kind: "interval", everyMinutes: 60 },
                          });
                        } else if (value === "daily") {
                          updateDuty(index, {
                            schedule: { kind: "daily", hourUtc: 9, minuteUtc: 0 },
                          });
                        }
                      }}
                    >
                      <SelectTrigger className="w-full" aria-label="Duty schedule kind">
                        <SelectValue>
                          {duty.schedule.kind === "daily" ? "Daily (UTC)" : "Interval"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="start">
                        <SelectItem hideIndicator value="daily">
                          Daily (UTC)
                        </SelectItem>
                        <SelectItem hideIndicator value="interval">
                          Interval
                        </SelectItem>
                      </SelectPopup>
                    </Select>
                  </Field>
                  {duty.schedule.kind === "daily" ? (
                    <Field label="Hour UTC">
                      <Input
                        nativeInput
                        type="number"
                        min={0}
                        max={23}
                        value={String(duty.schedule.hourUtc)}
                        onChange={(event) =>
                          updateDuty(index, {
                            schedule: {
                              kind: "daily",
                              hourUtc: Math.min(
                                23,
                                Math.max(0, Number(event.currentTarget.value) || 0),
                              ),
                              minuteUtc:
                                duty.schedule.kind === "daily" ? duty.schedule.minuteUtc : 0,
                            },
                          })
                        }
                      />
                    </Field>
                  ) : (
                    <Field label="Every N minutes">
                      <Input
                        nativeInput
                        type="number"
                        min={5}
                        value={String(duty.schedule.everyMinutes)}
                        onChange={(event) =>
                          updateDuty(index, {
                            schedule: {
                              kind: "interval",
                              everyMinutes: Math.max(5, Number(event.currentTarget.value) || 5),
                            },
                          })
                        }
                      />
                    </Field>
                  )}
                  <div className="sm:col-span-2 flex justify-end">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => removeDuty(index)}
                    >
                      <TrashIcon className="size-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
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
