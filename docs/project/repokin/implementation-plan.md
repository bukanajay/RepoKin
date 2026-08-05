# RepoKin — Implementation Plan (R1–R3)

**Companion to:** [prd.md](./prd.md) (v0.3 "The Workplace") · [fork-policy.md](./fork-policy.md)
**Date:** 2026-08-04
**Status:** supersedes the M0–M3 plan (all M0–M3 items landed locally; the
prior plan text lives in git history of this file). Open M1–M3 exit gates are
absorbed into R1.9.

---

## 0. Strategy: UI-complete first, fixtures where the backend isn't

The R1 build order inverts the M-series habit. We build the **entire Team
space UI** — including the R2/R3 screens (channels, board, work map) — in R1,
so the product's look, feel, and information architecture are locked and
reviewable early. Where the backend already exists (roster, presence,
inbox, activity — all landed in M0–M3), screens wire to **live data from day
one**. Where it does not (channels, tasks, work map), screens render from
**fixtures** that are progressively deleted as R2/R3 land the real domains.

Fixture rules — these are what keep "mock-first" from becoming "mock-forever":

1. **One seam per surface.** Every screen consumes data exclusively through a
   per-surface hook (`useTeamHomeData`, `useChannelData`, `useBoardData`, …)
   in its own file. Flipping fixture → live is an edit to that one hook; the
   rendering components never know the difference.
2. **Fixtures are quarantined and greppable.** All mock data lives in
   `apps/web/src/components/team/fixtures/`, every export prefixed
   `FIXTURE_`. `grep -rn "FIXTURE_" apps/web/src --include="*.tsx" -l`
   outside `fixtures/` must list exactly the surface hooks still on mock
   data — nothing else. That grep is the mock-debt report.
3. **Fixture-backed surfaces say so.** A visible `Preview` badge renders on
   any surface whose hook is fixture-backed. No silent fakery — a user (or a
   screenshot in review) can always tell design preview from live product.
4. **Fixtures never leak into the server or contracts.** Mocking is a web
   client concern only. Server code and `packages/contracts` gain no
   test-double pathways for this.
5. **Every fixture has a scheduled death.** See the tracker (§5). A milestone
   is not done while a fixture it was supposed to kill is alive.

Interaction stubs on fixture surfaces (drag a card, send a post) mutate local
component state only, so the design of the _interactions_ is also reviewable
in R1 — they just don't persist.

---

## 1. Conventions carried forward

From [AGENTS.md](../../../AGENTS.md) and the M-series, unchanged and binding:

- **Services vs Layers**: `Services/` holds `Context.Service` tags, `Layers/`
  holds implementations; the team domain mirrors `orchestration/`.
- **Contracts are schema only**, additive, in
  [`packages/contracts/src/team.ts`](../../../packages/contracts/src/team.ts)
  via the `./team` subpath — never the barrel.
- **Complexity at the adapter boundary; orchestration pure; UI dumb.**
- **Tests wait on receipts/drains, never sleeps.**
- **Migrations in the RepoKin range** (`1xx`, next free after
  `100_TeamMembers.ts`).
- **Additive-only file discipline** ([fork-policy.md §1](./fork-policy.md));
  bounded edits to upstream files are budgeted per touch-point (§6 there).
- **Presence never animates continuously.** Cardinal sin.
- **§7.4 PRD rule:** diverge freely in files upstream will never touch;
  diverge never in files it will.

New for the R series:

- **Social features are projections first** (PRD §9): before adding an event
  source, prove the feature cannot be projected from events we already emit.
- **Every new client surface lives under fork-owned paths**:
  `apps/web/src/routes/team.*` and `apps/web/src/components/team/**`.

---

## 2. R1 — The Team space (UI revamp)

**Goal:** the complete workplace UI. Live where plumbing exists, fixture
previews where it doesn't, Settings reduced to environment-local config.
**Estimate:** ~4–5 weeks. **Ships:** PRD §6.1, §6.5 (feed + inbox), §7.

### R1.1 Design foundation — `apps/web/src/components/team/`

The primitive kit everything else composes. Build these first, with
Storybook-style harness pages if useful, because every later screen is
assembled from them:

| Primitive       | Notes                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MemberAvatar`  | Humans: initials/photo. Agents: generated geometric identicon on accent color + small AI glyph. Sizes.                                                                                                         |
| `PresenceDot`   | Static dot, four states + stale→offline collapse. State-transition micro-animation only.                                                                                                                       |
| `MemberChip`    | Avatar + name + optional presence + optional `borrowed`/`on <env>` badge. Used in rows, cards, mentions.                                                                                                       |
| `AgentBadgeRow` | Mechanical facts as badges: model, runtime mode, path scope, tool policy summary.                                                                                                                              |
| `TeamCard`      | Base card: accent edge, header, live-state slot, deep-link affordance. Thread/diff/task/digest variants.                                                                                                       |
| `ActivityRow`   | Timeline row: actor chip, verb, object link, timestamp.                                                                                                                                                        |
| `PreviewBadge`  | The fixture marker (§0.3).                                                                                                                                                                                     |
| Theme tokens    | Additive CSS variables in a new `team/theme.css` imported from [`index.css`](../../../apps/web/src/index.css) (one-line bounded edit). Extends existing tokens; never redefines them. Dark-first, both themes. |

Accent-color derivation (agent identity thread, PRD §7.3) is a pure helper
shared with the existing composer agent picker.

### R1.2 Routes and shell

File-based TanStack routes, following the `settings.*` pattern:

```text
apps/web/src/routes/
  team.tsx                     # layout: Team nav rail + project scope
  team.index.tsx               # Home
  team.people.tsx              # roster
  team.people.$memberId.tsx    # member profile
  team.activity.tsx            # activity feed
  team.inbox.tsx               # notification inbox
  team.channels.tsx            # channel list          (fixture in R1)
  team.channels.$channelId.tsx # channel view          (fixture in R1)
  team.board.tsx               # kanban board          (fixture in R1)
  team.map.tsx                 # work map + radar      (fixture in R1)
```

Project scoping follows the pattern the existing settings surface uses (a
project selector owned by the `team.tsx` layout, persisted per client);
promoting the project into the URL path is a follow-up decision once deep
links from the inbox demand it — noted, not blocking.

Bounded upstream edits (fork-policy budget, a few lines each):

- Sidebar entry for the Team space in
  [`AppSidebarLayout.tsx`](../../../apps/web/src/components/AppSidebarLayout.tsx).
- Command palette verbs ("open Team home", "open #team", "message …",
  "open board") in the palette's command registry.

### R1.3 Team Home — live

Wired to existing RPCs from
[`state/team.ts`](../../../packages/client-runtime/src/state/team.ts):
`teamReadRoster`, `teamReadLocalState` (presence, inbox, assignments,
activity), plus the publish-state atoms.

Above the fold (PRD FR-11.2): my agents with live status · teammates with
presence (+ environment label for remote) · waiting-on-me (trust prompts,
queued messages, unpublished roster changes) · recent activity. Empty state
doubles as onboarding: "create your first agent" (FR-11.7).

### R1.4 People and member profiles — live

Decompose the 1,859-line
[`RepoKinSettings.tsx`](../../../apps/web/src/components/settings/RepoKinSettings.tsx)
into `components/team/` pieces; the settings panel shrinks to env-local
config only (team remote, trust store, provider bindings, publish prefs).

Member profile page (FR-11.4): identity header · expressive character
rendered readably · mechanical character via `AgentBadgeRow` ("may edit
`apps/web/**`") · compiled-instruction preview per provider (existing
`teamPreviewInstructions`) · recent threads/commits (attribution projection)
· edit form (existing `teamUpsertAgent` flow) when local policy allows.

### R1.5 Activity feed — live, one additive read model

The feed is a projection over events we already store (team events, thread
attribution, trust decisions, publishes). Expected server work: one additive
read-model query (e.g. `team.readActivity` with cursor + filters) in the
existing engine/projector — no new event sources. Contracts additive.

### R1.6 Notification inbox — live

Unifies existing per-feature affordances: inbox messages (M2), trust
prompts (M1.5), queued/expired delivery states (M3), publish tray (Q2).
Every item actionable in place, deep-linking to its surface. Cross-device
read state rides the existing team command path (`team.dispatchCommand`).

### R1.7 Fixture previews — channels, board, work map

Full-fidelity screens per PRD §6.2/§6.7/§6.4 designs, rendering from
`fixtures/` with local-state interactions (compose a post, drag a card
across columns, hover the treemap) and `Preview` badges. This is where the
R2/R3 UI gets designed for real, on realistic data shapes: fixture types
mirror the _planned_ contract schemas so the R2 contract PR starts from
already-exercised shapes.

### R1.8 Mobile

Home + People, read-only, reusing the existing mobile roster work. Fixture
surfaces are **not** shipped on mobile — previews are a desktop/web review
tool.

### R1.9 Exit gates

- [ ] A new user can create an agent, see it on Home, watch it in the
      activity feed, and never open Settings (PRD R1 gate).
- [ ] Settings → RepoKin contains only env-local config; every removed
      capability has a home in the Team space.
- [ ] Fixture grep (§0.2) lists exactly: channels, board, work map hooks.
- [ ] The open M-series gates, closed here: blind character A/B (M1),
      mechanical settings verified on all five drivers (M1), two-machine
      roster/message acceptance (M3), no p95 regression on thread open and
      project switch, `.repokin/`-less project indistinguishable from stock.
- [ ] Upstream sync still merges; new surfaces produce zero conflicts.

---

## 3. R2 — Channels, delegation, and the board (fixtures → real)

**Goal:** kill the three biggest fixtures with real domains.
**Estimate:** ~5–6 weeks. **Gated on:** R1 shipped; contract shapes reviewed.

### R2.1 Contracts — additive families in `team.ts`

- Channel: `ChannelId`, channel declaration schema
  (`.repokin/channels/<slug>.json`, T0), post schema with the typed-post
  union (`text` / `thread-card` / `diff-card` / `task-card` / `event` /
  `digest`), delivery/gap read models.
- Task: `TaskId`, task schema (title, description-as-prompt, labels, refs,
  assignee, four states), lifecycle events, board read model.
- Commands/events named like the existing families
  (`team.channel.post`, `team.task.create`, `team.task.move`, …).

Fixture types from R1.7 are the starting point; divergences discovered in
review are fed back into the UI before the flip.

### R2.2 Server domain — decider/projector/engine extensions

- New event families in the existing `decider.ts` / `projector.ts` /
  `TeamEngine` — same serial dispatch, same receipts. Migration `101_…`
  for channel posts + tasks tables.
- **Transport reuse:** posts and task events fan out as signed envelopes on
  the existing `relay_team_messages` queue (`TeamRelayMessaging`), one
  envelope kind per family; verification against roster keys unchanged.
  Per-sender causal order + arrival tiebreak; gap markers where TTL was
  exceeded (PRD Q7).
- Last-writer-wins per field for concurrent task edits, every transition an
  attributed event (FR-18.6).

### R2.3 Delegation flow

- Mention → `team.task.create` (+ assignment) → assignee environment's
  policy gate (existing inbound policy) → on accept, task `in-progress` and
  a normal thread starts on the home environment, attributed, task ref on
  the thread (reuses `repokinAgentId` plumbing).
- Coarse progress states project onto the task card; the terminal report
  posts a `task-card`/`diff-card` back to the origin channel. Review
  requests are tasks with a diff ref + structured verdict (FR-13.6).
- **Safety invariants tested explicitly:** no inbound request bypasses
  runtime mode / tool policy / path scope / trust (NFR-3); an agent never
  self-assigns and never marks its own task `done` (FR-18.2/18.3).

### R2.4 The flips

Each flip = rewrite one hook (`useChannelData`, `useBoardData`) against live
atoms, delete its fixture file, drop the `Preview` badge. UI components
should not change; where they must, that is a finding about R1's seam, fixed
in the seam.

### R2.5 Exit gates

- [ ] PRD R2 gate: backlog task → assign to agent → accept → run →
      diff-card → human review → Done, across two environments, entirely
      in-product.
- [ ] Fixture grep returns only the work-map hook.
- [ ] Channel scroll smooth at 10k posts (NFR-1, virtualized).
- [ ] Agents cannot post unprompted — tested at the decider (FR-12.6).
- [ ] Offline-past-TTL member sees gap markers, not silent loss.

---

## 4. R3 — Visibility (work map, radar, digests)

**Goal:** the last fixture dies; the wedge features ship.
**Estimate:** ~3–4 weeks.

- **R3.1 Work signals.** Coarse directory-level activity from running
  threads + working tree, throttled/coalesced, published over the existing
  presence transport (T2, ephemeral, roster-scoped). Per-environment kill
  switch (FR-14.4). No new steady-state traffic beyond the bounded heartbeat.
- **R3.2 Work map + radar.** Treemap projection with member avatars; overlap
  detection as a pure function over signals + published-branch diffstat
  (`git fetch` + `diff --stat` against RepoKin-owned refs — never checkout);
  passive dismissible surfacing on Home and affected threads (FR-14.3).
  Flip `useWorkMapData`; delete the last fixture.
- **R3.3 Digests + standup mode.** Local generation over T1 read models;
  bound provider instance when available, deterministic template fallback
  (Q10). `digest` post kind already shipped in R2 contracts. One-action
  standup posts my environment's digest to `#team` (FR-15.3).
- **R3.4 Exit gates:** PRD R3 gates (overlap surfaces within staleness
  horizon; one-action standup) · fixture grep returns empty · zero
  steady-state GPU cost on the map (NFR-2).

---

## 4b. R4 — Duties (workplace maturity)

**Goal:** scheduled agent work that is repo-declared, home-env only, and
strictly trust-gated (PRD §6.6).
**Estimate:** first slice ~1 week.

### R4.1 Contracts

- `AgentDuty` + schedule (`interval` | `daily`) on `AgentProfile.duties`
  (T0, decoding default `[]`).
- Env-local confirmation store: `settings.repokin.confirmedDuties`
  (workspace → agent → duty → content hash). FR-16.4.

### R4.2 Runner

- `TeamDutyReactor`: home environment only; confirmed + schedule match →
  create board task + start agent thread (delegation model path) with duty
  goal as prompt; `TeamDelegationReportReactor` posts a `task-card` on
  settle (FR-16.3 / FR-12.6). Missed windows post an explicit miss event
  (FR-16.2).

### R4.3 UI

- Agent editor: declare / edit / remove duties.
- Member profile: confirm / revoke duties on this environment.

### R4.4 Multi-env verification (simulated)

- `multiEnv.simulation.test.ts`: two logical envs exchange signed channel
  posts (senderSeq + gaps) and work-signal snapshots (overlap projection)
  without two physical machines.

### R4.5 Decision records + pulse (FR-17 / FR-19)

- Promote channel posts → `.repokin/decisions/<slug>.md` (local write;
  optional commit).
- Team nav: Decisions list + Pulse (git history, human vs agent trailers,
  directory hotspots).

---

## 5. Mock-removal tracker

The §0 contract, in table form. R1 creates every row; later milestones only
delete rows. **A milestone with a live row it was meant to kill is not done.**

| Surface        | Fixture file           | Hook              | Dies in | Gate           |
| -------------- | ---------------------- | ----------------- | ------- | -------------- |
| Channel list   | `fixtures/channels.ts` | `useChannelsData` | R2      | R2.5 grep gate |
| Channel view   | `fixtures/posts.ts`    | `useChannelData`  | R2      | R2.5 grep gate |
| Board          | `fixtures/tasks.ts`    | `useBoardData`    | R2      | R2.5 grep gate |
| Work map/radar | `fixtures/workmap.ts`  | `useWorkMapData`  | R3      | R3.4 grep gate |

Everything else in the Team space is live from R1. No other surface may be
added to this table without a PRD change — fixtures are a bridge for these
four, not a general pattern.

---

## 6. Sequencing

```text
R1.1 primitives ─┬─► R1.3 Home ──────┬─► R1.9 gates ─► ship R1
R1.2 routes ─────┤   R1.4 People     │
                 │   R1.5 Activity   │
                 │   R1.6 Inbox      │
                 └─► R1.7 fixtures ──┘         (R1.7 parallels live screens)

R2.1 contracts ─► R2.2 domain ─┬─► R2.3 delegation ─► R2.4 flips ─► R2.5 gates
                               └───────────────────────┘ (board flip can lead)

R3.1 signals ─► R3.2 map+radar ─► R3.4 gates
R3.3 digests ────────────────────┘ (independent of signals)
```

- R1.1 gates everything visual; review the primitive kit early and hard.
- R1.7 fixture screens parallelize with the live screens once primitives
  exist — good second-track work.
- R2.1 contract review is the schema moment for channels _and_ tasks; do it
  once, properly, with the R1.7 fixture types on the table.

---

## 7. Risk register for execution

| Risk                                            | Watch for                                       | Response                                                                |
| ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Mock-forever drift                              | Fixture grep list not shrinking per milestone   | §5 tracker is a milestone gate, not advice                              |
| Fixture shapes diverge from real contracts      | R2.4 flips forcing component rewrites           | R2.1 starts from fixture types; divergences fixed in the seam, logged   |
| R1 becomes a T3 Code redesign                   | Diffs in upstream screen files                  | §7.4 PRD rule; sidebar + palette edits are the entire upstream budget   |
| Channel/board tables become a second Jira/Slack | Fields, workflows, or post kinds beyond the PRD | FR-18.8 / FR-12.6 are scope law; PR review checklist item               |
| Delegation safety regression                    | Any accept path skipping the policy gate        | Decider-level tests (R2.3) run per PR; NFR-3 named in review checklist  |
| Relay queue load from posts                     | Fan-out cost growing with roster × posts        | Bounded per-post fan-out; measure in R2; batching is the lever, not Git |
| Presence/map repaint cost                       | Continuous animation or per-member polling      | Cardinal sin; catch in review; NFR-2 gate                               |
| Upstream sync pain                              | Conflicts in `routes/` or components            | All new files fork-owned; weekly sync unchanged                         |

---

## 8. First week, concretely

1. **Day 1–2** — R1.1 primitive kit: tokens, `MemberAvatar` (identicon
   included), `PresenceDot`, `MemberChip`, `TeamCard`, on a harness page.
2. **Day 2** — R1.2 route skeleton + sidebar entry; empty screens navigable.
3. **Day 3–4** — R1.3 Team Home wired live to `teamReadRoster` /
   `teamReadLocalState`; the waiting-on-me rail.
4. **Day 5** — First fixture screen: the board (it is the most
   self-contained), with `PreviewBadge` and drag interactions on local
   state. **End of week one, the product demos as a workplace** — which is
   the point of the whole revamp.
