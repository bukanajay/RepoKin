import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import type { MemberId, MemberPresenceState } from "@t3tools/contracts/team";

export type AgentAwarenessPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "stale";

export interface AgentAwarenessState {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly repokinAgentId: string | null;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: AgentAwarenessPhase;
  readonly headline: string;
  readonly detail?: string;
  readonly modelTitle: string;
  readonly updatedAt: string;
  readonly deepLink: string;
}

export interface ProjectThreadAwarenessInput {
  readonly environmentId: EnvironmentId;
  readonly project: Pick<OrchestrationProjectShell, "title">;
  readonly thread: Pick<
    OrchestrationThreadShell,
    | "id"
    | "title"
    | "modelSelection"
    | "session"
    | "latestTurn"
    | "updatedAt"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "repokinAgentId"
  >;
}

export const TEAM_PRESENCE_STALENESS_MS = 30_000;

export interface TeamMemberPresence {
  readonly memberId: MemberId;
  readonly environmentId: EnvironmentId;
  readonly state: MemberPresenceState;
  readonly updatedAt: string;
  readonly staleAfterMs: number;
  readonly threadId: ThreadId | null;
  readonly headline: string;
  readonly detail?: string;
}

export function buildAgentAwarenessDeepLink(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): string {
  return `/threads/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
}

export function projectThreadAwareness(
  input: ProjectThreadAwarenessInput,
): AgentAwarenessState | null {
  const { environmentId, project, thread } = input;
  const phase = resolveThreadAwarenessPhase(thread);
  if (!phase) {
    return null;
  }

  const detail = detailForPhase(phase, thread);
  return {
    environmentId,
    threadId: thread.id,
    repokinAgentId: thread.repokinAgentId ?? null,
    projectTitle: project.title,
    threadTitle: thread.title,
    phase,
    headline: headlineForPhase(phase),
    ...(detail === undefined ? {} : { detail }),
    modelTitle: thread.modelSelection.model,
    updatedAt: thread.updatedAt,
    deepLink: buildAgentAwarenessDeepLink({ environmentId, threadId: thread.id }),
  };
}

export function memberPresenceStateForAwarenessPhase(
  phase: AgentAwarenessPhase,
): Exclude<MemberPresenceState, "offline"> {
  switch (phase) {
    case "starting":
    case "running":
    case "waiting_for_approval":
    case "waiting_for_input":
      return "busy";
    case "completed":
      return "online";
    case "failed":
    case "stale":
      return "away";
  }
}

export function resolveMemberPresenceState(input: {
  readonly phase: AgentAwarenessPhase;
  readonly updatedAt: string;
  readonly nowMs: number;
  readonly staleAfterMs?: number;
}): MemberPresenceState {
  const staleAfterMs = input.staleAfterMs ?? TEAM_PRESENCE_STALENESS_MS;
  const updatedAtMs = Date.parse(input.updatedAt);
  if (!Number.isFinite(updatedAtMs) || input.nowMs - updatedAtMs > staleAfterMs) {
    return "offline";
  }
  return memberPresenceStateForAwarenessPhase(input.phase);
}

export function projectAgentThreadPresence(input: {
  readonly memberId: MemberId;
  readonly awareness: AgentAwarenessState;
  readonly nowMs: number;
  readonly staleAfterMs?: number;
}): TeamMemberPresence {
  const staleAfterMs = input.staleAfterMs ?? TEAM_PRESENCE_STALENESS_MS;
  const state = resolveMemberPresenceState({
    phase: input.awareness.phase,
    updatedAt: input.awareness.updatedAt,
    nowMs: input.nowMs,
    staleAfterMs,
  });
  return {
    memberId: input.memberId,
    environmentId: input.awareness.environmentId,
    state,
    updatedAt: input.awareness.updatedAt,
    staleAfterMs,
    threadId: state === "offline" ? null : input.awareness.threadId,
    headline: state === "offline" ? "Offline" : input.awareness.headline,
    ...(state === "offline" || input.awareness.detail === undefined
      ? {}
      : { detail: input.awareness.detail }),
  };
}

function resolveThreadAwarenessPhase(
  thread: ProjectThreadAwarenessInput["thread"],
): AgentAwarenessPhase | null {
  if (thread.hasPendingApprovals) {
    return "waiting_for_approval";
  }
  if (thread.hasPendingUserInput) {
    return "waiting_for_input";
  }
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return "failed";
  }
  if (thread.session?.status === "starting") {
    return "starting";
  }
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
    return "running";
  }
  if (thread.latestTurn?.state === "completed") {
    return "completed";
  }
  // A turn that finished can still read as "interrupted" here: session
  // teardown settles still-running turns by session status, and that write
  // can race the turn.completed one. completedAt survives the race — a turn
  // that has a completion timestamp finished, whatever the state column says.
  // Without this, quick finish-then-teardown threads resolve to null
  // persistently and get tombstoned instead of published as completed.
  if (thread.latestTurn?.state === "interrupted" && thread.latestTurn.completedAt !== null) {
    return "completed";
  }
  // Threads whose turns never produce a checkpoint (no code changes) have no
  // materialized latestTurn in the shell at all, and the session-set
  // projection clears latest_turn_id the moment the session settles. The
  // session status is then the only surviving completion signal: a live
  // session at "ready"/"idle" with nothing pending and nothing running means
  // the agent finished and is waiting for the next prompt — Done.
  if (thread.session?.status === "ready" || thread.session?.status === "idle") {
    return "completed";
  }
  return null;
}

function headlineForPhase(phase: AgentAwarenessPhase): string {
  switch (phase) {
    case "starting":
      return "Starting agent";
    case "running":
      return "Agent is working";
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Waiting for input";
    case "completed":
      return "Agent finished";
    case "failed":
      return "Agent failed";
    case "stale":
      return "Update delayed";
  }
}

function detailForPhase(
  phase: AgentAwarenessPhase,
  thread: ProjectThreadAwarenessInput["thread"],
): string | undefined {
  if (phase === "failed") {
    return thread.session?.lastError ?? undefined;
  }
  if (phase === "completed") {
    return "Review the completed task.";
  }
  if (phase === "running" && thread.session?.providerName) {
    return `${thread.session.providerName} is active.`;
  }
  return undefined;
}
