# AgentForge — Implementation Plan

**Companion to:** [prd.md](./prd.md) · [fork-policy.md](./fork-policy.md)
**Date:** 2026-07-30
**Status:** M0-M3 implemented locally; external and live acceptance gates remain

This plan is ordered so that each milestone is shippable and each one _earns_
the next. Effort estimates assume one to two engineers who know the codebase;
double them for the first month while Effect and the orchestration pattern are
still unfamiliar.

---

## Conventions this plan follows

Taken from [AGENTS.md](../../../AGENTS.md), because ignoring them is how a fork
becomes unmergeable and a codebase becomes unrecognizable:

- **Services vs Layers.** `Services/` holds `Context.Service` tags, `Layers/`
  holds implementations. The team domain mirrors
  [`orchestration/`](../../../apps/server/src/orchestration/) exactly.
- **Contracts are schema only.** No runtime logic in
  `packages/contracts`.
- **Complexity at the adapter boundary.** Orchestration stays pure, UI stays
  dumb.
- **Tests wait on receipts, never on sleeps.** The server is event-sourced and
  emits typed receipts; a test that needs a timeout is wrong.
- **Hit every surface.** Web, desktop, mobile; five providers; local, remote,
  and tunnel connection modes. Every provider-shaped change needs a per-adapter
  decision, including "not supported here."
- **Additive-only file discipline.** See [fork-policy.md §1](./fork-policy.md).

---

## M0 — Fork foundation

**Goal:** be able to build without drifting from upstream.
**Estimate:** ~1 week. **Ships:** nothing user-visible.
**Status:** mostly landed on `forge` (2026-07-30). Remaining: push `forge`,
set default branch on GitHub, and verify a manual sync-workflow dispatch.

### M0.1 Branch model and sync automation

1. ~~Add the `upstream` remote, create `forge` from `main`.~~ **Done locally.**
   Still need: push `forge`, set `forge` as the fork's default branch on GitHub.
2. ~~Add `.github/workflows/sync-upstream.yml`~~ **Done** — weekly + manual
   dispatch; FF `main` from upstream; open merge PR into `forge`.
3. ~~Enable `rerere`~~ **Done** in local repo config + sync workflow.
4. ~~Adjust CI to run on `forge` and `forge/**`~~ **Done**.

**Done when:** a manual dispatch of the sync workflow opens a green PR.

### M0.2 Branding indirection

5. ~~Set `APP_BASE_NAME` / product name to AgentForge~~ **Done** (web branding,
   desktop packaging `productName`, desktop `APP_BASE_NAME`, electron launcher
   display name). Package names / paths stay `@t3tools/*`.
6. ~~Decide the product spelling and rename the GitHub repository to match.~~
   **Done 2026-07-30** — product name is **AgentForge**; the repository is
   [`bukanajay/AgentForge`](https://github.com/bukanajay/AgentForge). GitHub
   redirects the old `agent-fordge` URL. Remaining: local clone directories
   still carry the old spelling and should be renamed by their owners.

### M0.3 Ground rules in writing

7. ~~Land these three documents.~~ **Done** under `docs/project/agentforge/`.
8. ~~Add the review checklist to `.github/pull_request_template.md`.~~ **Done**.

---

## M1 — Persistent agents with character

**Goal:** the product thesis, on one machine. Named agents whose character
demonstrably changes their output, with attribution.
**Estimate:** ~4–6 weeks. **Ships:** the MVP for the solo power user.
**Explicitly excluded:** presence, messaging, anything cross-machine.

### M1.1 Contracts — `packages/contracts/src/team.ts`

**Status:** landed on `forge` (2026-07-30).

New file. Follow [`t3ProjectFile.ts`](../../../packages/contracts/src/t3ProjectFile.ts)
precisely: annotations on the encoded side so they survive into the published
JSON Schema, trimming and validation on decode.

Define:

- ~~`MemberId`, `AgentId`, `HumanId`~~ branded slugs
- ~~`Character`~~ expressive + mechanical halves, `characterVersion: 1`
- ~~`AgentProfile`, `HumanProfile`, `TeamFile`~~
- ~~`CompiledCharacter`~~ compiler output for adapters
- ~~Team commands, events, and read-model shapes~~ (thin for M1)

Then ~~add the `./team` subpath~~ to `packages/contracts/package.json` — not an
`index.ts` edit.

**Two invariants (tests in `team.test.ts`):**

- Profile schema has no field that can hold a secret; provider-instance
  sensitive env values cannot appear in profile serialization.
- Unknown fields survive decode → encode (`onExcessProperty: "preserve"`).

### M1.2 Repository store — `apps/server/src/team/`

**Status:** landed on `forge` (2026-07-30) and wired through typed WebSocket
RPCs, client-runtime atoms, the web/desktop AgentForge settings surface, and a
read-only mobile roster.

| File                                                        | Responsibility                                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~`Services/TeamFileStore.ts` + `Layers/TeamFileStore.ts`~~ | Read and write `.agentforge/`. Atomic writes; optional git commit scoped to pathspecs under `.agentforge/`. `readRosterFromRef` uses `git show` / `ls-tree` only. |
| ~~`Services/LocalIdentityResolver.ts` + layer~~             | `git config user.name` / `user.email` via ProcessRunner, cached per repo root.                                                                                    |
| ~~`TeamPaths.ts`~~                                          | Path construction and slug derivation. Pure.                                                                                                                      |

Behavior notes that matter:

- Reading the roster from a remote ref uses `git show <ref>:<path>` — **never**
  checkout, never merge, never `pull`. The user's working tree is theirs.
- A malformed profile is skipped with a surfaced warning, never fatal. One
  teammate's bad JSON must not break your roster.
- Writes touch only `.agentforge/`, and produce their own commit.

### M1.3 Character compiler — the heart of M1

**Status:** started on `forge` (2026-07-30). Landed the pure compiler, thin
service/layer, deterministic mechanical hash, and per-driver instruction preview
for Codex, Claude Code, Cursor, Grok, and OpenCode. Adapter/provider wiring is
landed for Codex, Claude Code, Cursor, Grok, and OpenCode. Typed preview API
exposure is in place through `team.previewInstructions`; roster read exposure is
in place through `team.readRoster`; local agent profile writes are exposed
through `team.upsertAgent`; all three have client-runtime atoms. Composer
selection now passes `agentforgeAgentId` through orchestration and provider
reactors so compiled instructions are supplied at provider session start and
send-turn time. M1.6 attribution polish is now landed locally.

`apps/server/src/team/CharacterCompiler.ts` (pure) plus a thin service for
adapter access.

```text
Character (from Git)
        │
        ├─ expressive half ──► instruction text, per driver
        └─ mechanical half ──► model, runtimeMode, interactionMode,
                               toolPolicy, pathScope
        ▼
  CompiledCharacter  ──► adapter splices instructions
                     └─► harness applies mechanics at session start
```

Per-driver decision table — every provider needs an answer, and "not supported"
is an answer that must then be visible in the UI:

| Driver   | Instruction path                                                                                   | M1 decision                             |
| -------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Codex    | [`CodexDeveloperInstructions.ts`](../../../apps/server/src/provider/CodexDeveloperInstructions.ts) | Full support                            |
| Claude   | `systemPrompt` in [`ClaudeAdapter.ts`](../../../apps/server/src/provider/Layers/ClaudeAdapter.ts)  | Full support                            |
| Cursor   | [`CursorAdapter.ts`](../../../apps/server/src/provider/Layers/CursorAdapter.ts)                    | Investigate; mechanical half at minimum |
| Grok     | [`GrokAdapter.ts`](../../../apps/server/src/provider/Layers/GrokAdapter.ts)                        | Investigate; mechanical half at minimum |
| OpenCode | [`OpenCodeAdapter.ts`](../../../apps/server/src/provider/Layers/OpenCodeAdapter.ts)                | Investigate; mechanical half at minimum |

The mechanical half is driver-independent and therefore works everywhere from
day one — which is precisely why it is the load-bearing part of the anti-cosmetic
argument.

**Adapter edits stay at one call each.** If character logic starts accumulating
inside an adapter, stop and move it back into the compiler
([fork-policy.md §6](./fork-policy.md#6-unavoidable-upstream-touch-points--and-the-budget-for-each)).

Also ship **instruction preview** (PRD FR-3.4): render the exact compiled text
for an agent on a chosen driver. Character you cannot inspect is character you
cannot debug, and this will be the single most-used feature during development.

### M1.4 Agent → runtime binding

**Status:** landed locally (2026-07-30). Settings → AgentForge stores local
agent bindings under `ProviderInstanceConfig.config.agentforge.agentIds`, and
the composer picker prefers that machine-local binding before falling back to an
agent profile's provider preference. Unavailable/error provider instances are
shown but cannot be saved as a binding.

An agent's runtime is a provider instance. The binding
(`agentId → providerInstanceId`) is **machine-specific and stays out of Git** —
it lives in local settings, namespaced under `config.agentforge` inside
`ProviderInstanceConfig`, which upstream already preserves verbatim for exactly
this kind of fork payload.

- Creating an agent optionally creates or adopts a provider instance.
- An agent whose driver is unavailable in this build shows as unavailable rather
  than failing — mirroring how upstream already degrades unknown drivers.

### M1.5 Trust prompt (PRD §6.5)

**Status:** landed locally (2026-07-30). Added environment-local
`settings.agentforge.trustedMechanics`, pure trust evaluation helpers, and a
Settings → AgentForge preview affordance, and composer send-flow prompt to mark
the currently compiled mechanical hash trusted for a workspace/agent. Provider
turns with untrusted or changed AgentForge mechanics are rejected before
provider session start. The current prompt summarizes the mechanical settings in
plain language; richer before/after copy can continue as UX polish outside the
M1 gate.

`apps/server/src/team/CharacterTrust.ts` + UI.

- Hash the **mechanical** half of each agent's character. Store trusted hashes
  per project, environment-locally.
- On first sight or on hash change, hold the new mechanical settings pending and
  prompt.
- The prompt renders a plain-language diff — "Aria may now edit files outside
  `docs/`", "Aria will now run without asking for approval" — not raw JSON.
- Pending-trust agents run with previously-trusted mechanics, or safe defaults
  (`approval-required`, no `pathScope` widening) if never trusted.

This is small, and it is the difference between a shareable roster and a supply
chain hole. It ships with M1, not after.

### M1.6 Attribution

- **Status:** landed locally (2026-07-30). `agentforgeAgentId` is projected
  onto thread rows from turn-start events, emitted in thread/shell snapshots,
  shown as a compact `@agent` chip in web thread rows, surfaced on checkpoint
  changed-file cards and turn-diff headers, and forwarded through web/mobile git
  actions for commit trailers.
- Add agent trailers to commits produced through
  [`GitManager.ts`](../../../apps/server/src/git/GitManager.ts) — the commit
  message construction path already exists and already takes a writing style.
  **Landed:** `AgentForge-Agent: <agentId>` trailer on attributed commits.

### M1.7 UI

**Web (primary):**

- [x] Team panel: roster of humans and agents, per-project.
- [x] Agent editor: local profile create/edit form for expressive character and
      enforced runtime defaults.
- [x] Instruction preview.
- [x] Agent picker in the composer: reads the active project roster and applies
      profile provider/runtime/interaction defaults to the current draft controls.
- [x] Publish affordance: local AgentForge saves create scoped commits and a
      persistent "team changes ready to publish" control pushes only when the
      user chooses it (PRD Q2). Default-branch pushes require confirmation.

**Desktop:** inherits web. Verify the trust prompt renders correctly in the
Electron shell.

**Mobile:** [x] read-only roster and agent detail, with project selection and an
explicit editing-unavailable state. Editing remains M4.

### M1.8 Testing

- Pure unit tests for `CharacterCompiler`, slug derivation, and trust hashing —
  these are where the logic actually lives, and they are cheap.
- Store tests against temporary Git repositories.
- Adapter tests asserting compiled instructions reach each provider's launch
  path.
- Round-trip tests for unknown-field preservation and secret exclusion.
- One integrated pass in a real client via the `test-t3-app` skill, once, after
  integration.

### M1 exit criteria

- [ ] Two agents with different characters produce recognizably different output
      on the same prompt — the blind A/B in [PRD §13](./prd.md#13-success-metrics).
- [ ] Mechanical settings verifiably applied on all five drivers.
- [x] Roster survives clone → edit → commit → clone elsewhere. Covered by an
      independent-clone Git integration test in `TeamFileStore.test.ts`.
- [ ] A project with no `.agentforge/` is indistinguishable from stock T3 Code.
- [ ] No p95 regression on thread open.
- [ ] Upstream sync still merges in under two hours.

---

## M2 — Local presence and inbox

**Goal:** coordination for one person running several agents.
**Estimate:** ~3–4 weeks. **Gated on:** M1 validating.

### M2.1 Team domain

**Status:** landed locally (2026-07-30). Landed typed M2 command/event/read
models in `packages/contracts/src/team.ts`, pure
`apps/server/src/team/decider.ts` / `projector.ts` /
`commandInvariants.ts`, SQLite `team_events` + `team_command_receipts`
migration `100_TeamMembers.ts`, `TeamEventStore`, command receipts, and
`Layers/TeamEngine.ts` with serial dispatch and idempotent command receipts.
The domain is exposed through typed WebSocket RPCs and client-runtime atoms;
web/desktop AgentForge settings render the inbox, assignments, and activity.

Mirror the orchestration pattern exactly — `decider.ts` (pure), `projector.ts`,
`commandInvariants.ts`, `Layers/TeamEngine.ts`. Reusing the shape means reusing
the team's intuition and the existing test ergonomics.

- Commands: `team.member.upsert`, `team.agent.assign`, `team.message.send`,
  `team.request.respond`.
- Events: the corresponding `*-ed` facts.
- Migrations start at **`100_TeamMembers.ts`**
  ([fork-policy.md §4](./fork-policy.md#4-where-agentforge-code-goes)).

### M2.2 Presence

**Status:** landed locally (2026-08-03). Extended
`packages/shared/src/agentAwareness.ts` with local member presence projection:
awareness phases map to `online` / `busy` / `away` / `offline`, with a
30-second staleness horizon. Settings → AgentForge now shows non-animated
presence chips for roster agents when thread shells are attributed with
`agentforgeAgentId`. Human app-presence follows FR-6.3: throttled web/desktop
pointer and keyboard activity, plus mobile foreground/touch activity, publish
an authenticated environment heartbeat. The existing 30-second staleness
horizon turns missing or stale activity into `offline`; durable team-domain
presence events are intentionally not required because presence is ephemeral.

Extend [`agentAwareness.ts`](../../../packages/shared/src/agentAwareness.ts)
rather than adding a parallel model. Map existing session phases onto
`online`/`busy`/`away`/`offline`, add a staleness horizon, and make sure the
indicator never animates continuously.

### M2.3 Inbox

**Status:** landed locally (2026-07-30). Added local inbox command/event
schemas and WebSocket RPCs, exposed `team.readLocalState` /
`team.dispatchCommand` through client runtime atoms, and added a visible
Settings -> AgentForge local inbox control for sending messages to the selected
agent and marking delivered messages read. Server-side delivery now uses
`TeamInboxDeliveryReactorLive` with presence-aware queued/delivered/expired
decisions and focused tests for domain transitions plus online delivery.
Messages without an explicit expiry receive a deterministic 24-hour TTL when
the queued event is decided, so offline messages cannot remain queued forever.

- Durable queue in the team event store, drained by a reactor built on
  [`DrainableWorker`](../../../packages/shared/src/DrainableWorker.ts) so tests
  can wait on drains instead of sleeping.
- Delivery states: queued / delivered / read / expired, with TTL.
- Local delivery only in M2 — no relay yet.

### M2.4 Handoff

**Status:** landed locally (2026-07-30). The local team domain records
`team.agent.assign` as a durable assignment plus `thread.assigned` activity.
Settings -> AgentForge now exposes a local handoff control that selects a
project thread, assigns it to the selected agent, refreshes the team read model,
and shows current assignments plus recent team activity.

Assign or claim a thread for an agent; hand off preserving history; record the
handoff as an activity so it shows in the timeline.

### M2 exit criteria

- [ ] Presence reflects real agent state within 2s locally, with no visible
      repaint cost.
- [x] Messages to a busy agent queue and deliver on idle. Covered by the
      drainable delivery-reactor test without sleeps or polling.
- [x] Handoff preserves the thread reference and is visible as
      `thread.assigned` in the activity timeline.

---

## M3 — Cross-environment

**Goal:** the actual team product.
**Estimate:** ~5–7 weeks, **with the widest error bars in the plan** — NAT,
relay capacity, and key rotation are all genuinely unknown until we are in them.
Plan for slip; do not let M1 or M2 depend on this landing on time.

### M3.1 Roster sync

`apps/server/src/team/Layers/RosterSync.ts`:

**Status:** landed locally (2026-07-30). Added the explicit `teamRemote` save
path, manual Settings -> AgentForge roster sync, upstream-then-origin suggestion
helper, default-branch resolution, fetch into AgentForge-owned refs, and
`git show`/`ls-tree` roster reads from the fetched ref without checkout. Roster
sync is also retained by visible VCS status subscriptions: one coalesced poller
per cwd, off the interaction path, and gated by `BackgroundPolicy` scoped work.

- Periodic `git fetch <teamRemote> <defaultBranch>` — coalesced, off the
  interaction path, skipped when the project is not visible.
- Read profiles from the fetched ref with `git show`. Working tree untouched.
- Team remote is an **explicit visible setting**, defaulted by the
  `upstream`-then-`origin` order but never silently inferred (PRD Q4).

### M3.2 Signed environment-to-environment messaging

**Status:** landed locally (2026-07-31). `SignedMessaging.ts` signs and
verifies envelopes using the environment keypair from `environmentKeys.ts` and
the signed-proof pattern from `AgentAwarenessRelay.ts`. The relay gained a
durable `relay_team_messages` queue (`infra/relay/src/teamMessages/`) behind
`deliverTeamMessage` (POST) and `pollTeamMessages` (GET), both
environment-authenticated; `deliverTeamMessage` rejects envelopes whose
claimed sender doesn't match the caller's authenticated environment.
`TeamRelayMessaging.ts` forwards a locally queued message through the relay
when its recipient is a roster agent whose `homeEnvironment` differs from
this environment, or a human with exactly one unambiguous linked remote
environment (M3.4 changed the local delivery bookkeeping around this — see
below); a 10s poll loop verifies inbound envelopes against the owning
project's roster and dispatches accepted ones into the local team engine,
dropping unverifiable ones without surfacing them. Human recipients with one
linked remote environment route there directly. For humans with multiple
linked environments, recent app activity selects the destination only when
exactly one environment is active; ambiguous presence remains queued, and the
relay cycle reconsiders it when presence changes.
Message and receipt proofs remain valid for the same 24-hour window as the
offline relay queue; the focused suite verifies consumption after several
offline hours rather than only immediately after signing.

- Reuse the environment keypair from
  [`environmentKeys.ts`](../../../apps/server/src/cloud/environmentKeys.ts) and
  the signed-proof pattern already used by
  [`AgentAwarenessRelay.ts`](../../../apps/server/src/relay/AgentAwarenessRelay.ts).
- Verify every inbound envelope against the public key the roster declares for
  that member. Unverifiable messages are **dropped**, not surfaced as "unknown
  sender" — a rejected message the user never sees is correct; a spoofable one
  they do see is not.
- Extend the relay with an environment-to-environment envelope endpoint.

### M3.3 Cross-machine presence

**Status:** landed locally (2026-08-03). Rather than fan out the full
`RelayAgentActivityAggregateState` (project/thread titles) across account
boundaries, the relay exposes a coarser `getEnvironmentPresence` query over
the same underlying activity rows: only phase and its timestamp, per
requested environment id — the same minimal-exposure default the local
(M2.2) presence model already uses. `TeamRelayPresence` polls it every 10s
for every roster agent's home environment seen across open projects and
caches the result; `TeamPresenceResolver` now falls back to that cache when
a member has no local thread activity and its roster profile's
`homeEnvironment` differs from this one. `team.readLocalState` returns a
`presences` list (resolved for every project member, local or remote) so the
web UI doesn't need its own copy of the resolution logic; Settings ->
AgentForge shows the owning human's roster environment label next to a
remote agent's presence chip, e.g. `Busy (on julius-mbp)`.

Human presence uses a separate minimal relay heartbeat keyed only by the
authenticated environment id and `activeAt`; it carries no project, thread, or
input data. Web/desktop and mobile report recent interaction without a timer
animation. `TeamPresenceResolver` maps linked human environments to the same
`online` / `offline` read model, and multiple-device message routing proceeds
only when one active destination is unambiguous.

Fan out through the existing relay aggregate
(`RelayAgentActivityAggregateState`), scoped to roster members. Presence carries
the environment id so the UI can show `Aria (on julius-mbp)`.

### M3.4 Offline queue and borrowed agents

**Status:** landed locally (2026-08-03). The relay's `relay_team_messages`
queue is swept on the existing 5-minute cron alongside the agent-activity
prune. `TeamRelayMessaging` does not mark a forwarded message "delivered" on
relay hand-off — handing off only means the recipient environment _can_ pick
it up. After the recipient durably accepts and verifies the message, it signs
a delivery receipt with its environment key and queues that receipt back to
the original sender environment. The sender verifies the recipient's current
roster key, checks the signed sender/recipient tuple against its queued local
message, and only then dispatches `team.message.deliver`. Wrong-key and
tampered receipts are dropped. Messages and receipts share the queue's
24-hour validity window, and messages without an explicit expiry now receive
that TTL in the local event domain.

The relay queue and human-presence tables ship with generated Postgres
migration `20260802175214_agentforge_team_transport`; the earlier TypeScript
schema alone was not deployable. A process-local forwarded-message set prevents
the 10-second retry scan from flooding the relay while still allowing messages
that were initially unroutable, or failed a transient send, to be retried. The
same cycle retries receipts from persisted inbound-message provenance until the
relay accepts them, so a transient receipt-send failure does not strand the
sender in `queued` after recipient acceptance.

Fixing the earlier optimistic state surfaced a real bug: since M3.3 made
`TeamPresenceResolver` resolve a non-null presence for remote-home agents,
`TeamInboxDeliveryReactor` would otherwise have started marking their messages
"delivered" locally the moment the relay reported them online — wrong, since
only `TeamRelayMessaging` can actually get a message to a remote agent. It
checks the recipient's roster `homeEnvironment` and only ever "wait"s or
"expire"s a remote-home agent's message itself.

Borrowed-agent visibility ships without any new state: M1.4's local
agent-to-provider binding is already an explicit, environment-local opt-in,
so a roster agent whose `homeEnvironment` differs from here _and_ that has a
local binding here is being run from this machine right now. Settings ->
AgentForge shows a "Borrowed here" badge for exactly that case — no new
relay endpoint, no new settings key, no locking, no enforcement; unbinding
the agent (already-existing UI) is the "way out."

- Queue with TTL and visible expiry.
- Home vs borrowed semantics with explicit local opt-in and permanent labeling.
  No distributed locking — visibility instead.

### M3 exit criteria

- [ ] Two machines, one repo: both rosters converge within the staleness target.
- [ ] Messages deliver when both online; queue and deliver later when not.
- [x] A forged message signed by the wrong key is rejected — with a test.
- [x] Revoking a member by removing their profile actually cuts them off — with
      a focused signed-envelope test.

---

## M4 — Inter-agent workflows

Open-ended, and deliberately unplanned in detail until M3 usage data exists.
Candidates in rough priority order: review requests, richer agent-to-agent
protocols, channels, audit export, mobile editing parity, permission
refinement.

**Do not start M4 items opportunistically during M1–M3.** They are the most
fun to build and the least validated, which is exactly the combination that
kills roadmaps.

---

## Sequencing and parallelism

```text
M0 ──► M1.1 contracts ──┬──► M1.2 store ────┬──► M1.6 attribution ──┐
                        ├──► M1.3 compiler ─┤                       ├──► M1.7 UI ──► ship
                        └──► M1.4 binding ──┴──► M1.5 trust ────────┘
```

- M1.1 gates everything; write it first and get the schema review done early.
- M1.2, M1.3, and M1.4 genuinely parallelize.
- M1.7 needs M1.2 and M1.3 only — UI work can start against fixtures as soon as
  the contracts land.
- M2 and M3 are strictly sequential after M1.

---

## Risk register for execution

| Risk                                  | Watch for                                        | Response                                                                      |
| ------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Character logic leaks into adapters   | Adapter diffs growing past a few lines           | Extract to `CharacterCompiler` immediately; this is the fork's main tax lever |
| Contracts become a merge battleground | Conflicts in `packages/contracts` on sync        | All team schema in `team.ts`; subpath export, never the barrel                |
| Migration collision                   | Upstream ships a migration in our range          | Ours start at `100`                                                           |
| Roster sync stomps the working tree   | Any `git pull`/`checkout` in team code           | `git fetch` + `git show` only — make it a review checklist item               |
| Presence repaints and burns GPU       | Any continuous animation in a presence indicator | T3 Code cardinal sin; catch it in review                                      |
| Secrets reach `.agentforge/`          | Any profile field that could hold a credential   | Schema-level impossibility plus the M1.1 test                                 |
| M3 slips                              | NAT and relay unknowns                           | M1 and M2 ship value without it; do not couple them                           |
| Scope creep into M4                   | "While we're here…"                              | The milestone gates exist for this                                            |

---

## First week, concretely

If this plan is accepted, the first five working days:

1. **Day 1** — M0.1 branch model and the sync workflow. Verify a manual sync
   opens a clean PR.
2. ~~**Day 1** — Decide the product spelling; rename the repo.~~ **Done.**
3. **Day 2–3** — M1.1 `packages/contracts/src/team.ts`, the `./team` subpath
   export, and the two invariant tests. Review the schema properly before
   anything depends on it.
4. **Day 3–4** — M1.2 `TeamFileStore` and `LocalIdentityResolver` against a
   temporary repository fixture.
5. **Day 5** — Spike `CharacterCompiler` against Codex and Claude only, and get
   the instruction preview working. **The fastest possible answer to "does
   character actually change output?" is worth more than a week of scaffolding**
   — and if the answer is no, this plan changes.
