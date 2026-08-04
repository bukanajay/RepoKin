# RepoKin — Product Requirements Document

**Status:** Draft v0.3 — "The Workplace" revision
**Based on:** fork of [T3 Code](https://github.com/pingdotgg/t3code)
**Date:** 2026-08-04
**Supersedes:** PRD v0.2

Companion documents:

- [Implementation plan](./implementation-plan.md) — R1–R3 execution plan
  against this PRD (M0–M3 landed; prior plan in git history).
- [Fork policy — staying mergeable with upstream](./fork-policy.md)

---

## 0. What changed from v0.2

v0.2 was the disciplined version: prove that persistent, characterful agents
are real before building anything social. **That proof-of-architecture work
(M0–M3) is now implemented locally** — roster in Git, character compilation
across five providers, trust prompts, attribution, local inbox and handoff,
signed cross-environment messaging and presence.

v0.3 widens the aperture. Six changes, each of which materially changes what
gets built next:

1. **The vision is a workplace, not a layer.** RepoKin is where a team —
   humans _and_ their agents — works on one GitHub repo from their own
   laptops while staying connected: communication, visibility, and delegation
   across the whole hybrid team. v0.2 framed the team features as an addition
   to T3 Code; v0.3 frames them as the product.
2. **The team surface becomes first-class UI.** Today every RepoKin feature
   lives inside a single Settings page. That was correct for validating
   plumbing and is now the product's biggest liability. v0.3 specifies a
   dedicated Team space with its own design language (§7).
3. **Channels are promoted from "M4 if earned" to a core pillar** — with an
   anti-noise design that keeps them a coordination surface, not a chat app
   (§6.2).
4. **Visibility is a new pillar.** Live work map, overlap radar, and digests:
   the "I have no idea what anyone else's agents are doing" problem is the
   sharpest pain in the target market, and most of the data already exists in
   presence and thread state (§6.4, §6.5).
5. **Delegation becomes a first-class primitive.** @mention an agent →
   structured task → streamed progress → reviewable result. This is the verb
   that makes a hybrid team feel like a team (§6.3).
6. **Q6 (visual continuity) is partially reversed — deliberately.** Inherited
   T3 Code surfaces stay visually untouched for merge safety, but the new
   RepoKin surfaces get their own contemporary design language in fork-owned
   files (§7.4).

**What did _not_ change** — these v0.2 sections remain normative and are
carried forward by reference:

- The three-tier truth model: Git (T0) / environment event store (T1) /
  relay (T2). Nothing that changes more than daily is ever committed.
- Environment federation: there is no shared runtime and no accounts system.
  Repo write access is the authorization root; wire identity is verified
  against roster public keys.
- Character with a mechanical, harness-enforced half; trust confirmation for
  repo-sourced mechanical changes.
- No secrets in `.repokin/`, ever. Structurally impossible, tested.
- Offline-first; upstream mergeability as a product requirement.

---

## 1. Vision

> **RepoKin is the workplace for hybrid teams.** A team works on a single
> GitHub repository, each person on their own laptop with their own agents and
> their own credentials — yet everyone can see who is working on what, talk to
> each other, and hand work to any teammate, human or AI.

Development teams already have a workplace for humans (Slack, Linear) and a
workplace for code (GitHub). Neither has a seat for agents: agents today are
anonymous tabs on one person's machine, invisible to the rest of the team,
with no identity, no inbox, no accountability.

RepoKin gives agents that seat — and gives humans a shared room. The repo is
the office; `.repokin/` is the org chart; presence, channels, and delegation
make the distributed hybrid team feel like it shares a room.

### The one-line pitch

> Your repo already knows who wrote every line. RepoKin makes it a workplace
> where humans and AI agents work as one team — named, visible, reachable —
> each from their own laptop.

### What we are betting on

Three bets, in order of conviction:

1. **Persistent character + attribution changes how teams route work**
   (v0.2's bet — now validated in architecture, pending usage validation).
2. **Visibility is the wedge for teams.** The first thing a 3-person team
   wants is not agent chat — it is "what is Bob's agent doing to `auth/`
   right now?" Overlap radar and activity feeds are cheap given the existing
   presence plumbing, and are the feature a teammate can _see working_ in the
   first five minutes.
3. **Delegation through conversation is the natural UI for hybrid teams.**
   @mentioning an agent in a channel and getting a reviewable diff back is
   how people already wish their tools worked.

Messaging exists to route work. Every message primitive references a thread,
diff, task, or event. Free-floating chat remains a non-goal — Slack already
exists.

---

## 2. Product pillars

| #   | Pillar                                                                                                                               | Status                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| P1  | **Persistent agent teammates** — named agents with enforced character, owned by humans, living in the repo                           | Landed (M1)                                     |
| P2  | **Presence & visibility** — who is online, who is working on what, where work overlaps                                               | Presence landed (M2/M3); work map & digests new |
| P3  | **Communication** — channels and DMs where humans and agents are peers                                                               | DMs landed (M2/M3); channels new                |
| P4  | **Delegation & workflows** — @mention-to-task, review requests, handoffs, scheduled duties                                           | Handoff landed (M2); rest new                   |
| P5  | **Local-first and Git-native** — every laptop is sovereign; Git holds identity and policy; offline loses only cross-machine features | Landed; permanent constraint                    |

---

## 3. Target users

**Primary.** Engineering teams of 2–15 already using AI coding agents and
Git, where more than one person runs agents against the same repository and
they currently have no idea what anyone else's agents are doing.

**Secondary — and the fastest validation path.** One developer running
several specialized agents on one project. For this user the Team space is a
_mission control_: their agents' presence, channel, and task list, no second
human required. Every P2–P4 feature must be valuable at team-size-one.

**Explicit anti-user for v1.** Large orgs needing compliance, RBAC, SSO, or
audit export.

---

## 4. Concepts

New and changed terms relative to v0.2 (unchanged terms — Project, Team,
Member, Character, Environment, Home/borrowed, Presence, Inbox — carry
forward):

| Term                | Definition                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Team space**      | The first-class UI area for the team: home, channels, people, activity. Per project.                                                                                                                                      |
| **Channel**         | A named, durable conversation stream scoped to a project, whose members are humans _and_ agents.                                                                                                                          |
| **Post**            | A message in a channel or DM. Typed: text, thread card, diff card, task card, event, digest.                                                                                                                              |
| **Task**            | A unit of work in the project's registry: title, description (doubles as the delegation prompt), labels, comments, optional assignee (human or agent), four board states. Delegation (§6.3) is how an agent executes one. |
| **Board**           | The kanban view of the task registry: `Todo · In progress · Done · Cancelled`.                                                                                                                                            |
| **Duty**            | A scheduled recurring task owned by an agent (e.g. nightly test triage), declared in its profile.                                                                                                                         |
| **Work map**        | The live view of which members are active in which parts of the repo, at directory granularity.                                                                                                                           |
| **Digest**          | A generated summary of a member's activity over a window, postable to a channel.                                                                                                                                          |
| **Decision record** | A conversation or thread promoted to a committed Markdown file under `.repokin/decisions/`.                                                                                                                               |

---

## 5. Feature brainstorm — triaged

The full brainstorm, triaged before the requirements sections so scope
decisions are explicit. **Core-next** = specified in §6 and scheduled in R1–R3.
**Later** = specified lightly, scheduled R4+. **Deferred** = named so it stops
being re-litigated.

| Feature                               | One-liner                                                                                                                                     | Triage                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Team space (first-class UI)           | Home, channels, people, activity — out of Settings                                                                                            | Core-next                                                     |
| Channels (humans + agents)            | Slack-like streams with typed, work-anchored posts                                                                                            | Core-next                                                     |
| @mention-to-delegate                  | Mention an agent with a request → task → streamed progress → diff back                                                                        | Core-next                                                     |
| Live work map / overlap radar         | "Aria and Bob are both editing `auth/`" before the merge conflict                                                                             | Core-next                                                     |
| Activity feed                         | Unified timeline of threads, commits, handoffs, trust changes per project                                                                     | Core-next                                                     |
| Standup digests                       | Auto-generated per-member summaries; agents report on themselves                                                                              | Core-next                                                     |
| Review requests to agents             | Ask an agent for a review of a diff/thread; result posts back                                                                                 | Core-next                                                     |
| Unified notification inbox            | One place for mentions, requests, task updates, trust prompts                                                                                 | Core-next                                                     |
| Agent duties (scheduled chores)       | Nightly triage, dependency bumps, flaky-test hunts — reported to a channel                                                                    | Later                                                         |
| Decision records                      | Promote a conversation to a committed ADR-style file                                                                                          | Later                                                         |
| Task registry + kanban board          | Shared backlog of tasks (impl/QA/design/docs), four states, comments; assignable to humans or agents; description doubles as the agent prompt | Core-next                                                     |
| Repo pulse dashboard                  | Contribution and hot-spot analytics, human vs agent                                                                                           | Later                                                         |
| Voice/huddle rooms                    | Ephemeral audio for humans                                                                                                                    | Deferred                                                      |
| Character marketplace / sharing       | Import/export agent characters between repos                                                                                                  | Deferred                                                      |
| Org management, RBAC, SSO, billing    | Identity-provider territory                                                                                                                   | Deferred (non-goal)                                           |
| Autonomous agent-to-agent negotiation | Agents delegating to agents without human visibility                                                                                          | Deferred — every agent-to-agent interaction stays inspectable |
| Cross-repo teams                      | One roster spanning repositories                                                                                                              | Deferred                                                      |

Two triage principles applied above:

- **Prefer features that reuse landed plumbing.** Work map, activity feed,
  and digests are projections over data that presence, threads, and the event
  store already hold. Channels reuse the signed relay transport from M3.
- **Every social feature must be valuable solo.** A single developer with
  three agents gets a mission control; a team gets a workplace. Features that
  only work at N≥2 humans (voice rooms) are deferred.

---

## 6. Functional requirements

Numbering continues from v0.2 (FR-1 through FR-10 remain in force; landed
ones are listed in §10.1). Priorities: **P0** = required for the milestone
that introduces it; **P1** = fast-follow; **P2** = later.

### 6.1 Team space (P0, R1)

- **FR-11.1** A project with team features enabled gets a **Team space** in
  the primary navigation — not under Settings. Entry points: Home, Channels,
  People, Activity.
- **FR-11.2** **Home** shows, above the fold: my agents and their live
  status; teammates and their presence; the most recent activity; anything
  waiting on me (trust prompts, review requests, queued messages, unpublished
  roster changes).
- **FR-11.3** **People** is the roster: humans with their environments and
  presence; agents with owner, character summary, home environment, and
  recent work. Each member has a profile page.
- **FR-11.4** An **agent profile page** shows identity (name, avatar, accent,
  owner), the expressive character rendered readably, the mechanical
  character rendered as enforceable facts ("may edit `apps/web/**`",
  "approval required"), the compiled-instruction preview per provider, recent
  threads and commits, and the edit affordance when local policy allows.
- **FR-11.5** Existing Settings → RepoKin content is decomposed into the
  Team space; Settings retains only environment-local configuration (team
  remote, trust store, bindings, publish preferences).
- **FR-11.6** The Team space is reachable on web and desktop at parity;
  mobile ships Home + People read-only in R1, interaction parity later.
- **FR-11.7** A project without `.repokin/` shows a single inviting,
  dismissible entry point to create a team (or an agent) — and otherwise
  looks exactly like stock T3 Code (FR-10.2 carried forward).

### 6.2 Channels (P0, R2)

- **FR-12.1** A project has zero or more channels. A **default `#team`
  channel** is created with the team. Channels are declared in
  `.repokin/channels/<slug>.json` (name, purpose, membership policy) — the
  declaration is T0; the messages are T1/T2 and **never in Git**.
- **FR-12.2** Members are humans and agents, mixed. Default membership: all
  roster members; per-channel opt-outs are environment-local.
- **FR-12.3** Posts are **typed**: `text`, `thread-card` (live status of a
  thread), `diff-card` (checkpoint/turn diff reference), `task-card` (§6.3),
  `event` (handoff, trust change, publish, duty run), `digest`. Cards render
  live state, not snapshots-as-text.
- **FR-12.4** Transport and storage reuse the M3 model: a post is a signed
  envelope fanned out to roster environments via the relay queue; each
  environment stores its copy in the local event store. Delivery states and
  TTL semantics follow FR-7.3/7.5. History convergence is best-effort:
  a member offline past the relay TTL sees a visible gap marker, not silent
  loss.
- **FR-12.5** Ordering is by sender timestamp with arrival tiebreak;
  causality is preserved per sender. We do not attempt global total order —
  a gap marker is honest, a reordering lie is not.
- **FR-12.6** **Anti-noise is a requirement, not a style choice.**
  - Agents may post to a channel only: in reply to a mention, as the terminal
    report of a task or duty they own, or as an explicitly subscribed event.
    Agents never post unprompted commentary.
  - Agent posts are terse by default; the full detail lives behind the card
    (in the thread), not in the channel.
  - Per-channel, per-member mute and event filters are environment-local.
- **FR-12.7** Mentions: `@member` notifies; `@team` notifies humans only.
  Mentioning an agent offers the delegation flow (§6.3) inline.
- **FR-12.8** DMs (landed in M2/M3) render in the same conversation UI as
  channels and gain typed posts.

### 6.3 Delegation (P0, R2)

- **FR-13.1** Mentioning an agent with a request creates a **task in the
  project registry** (§6.7): origin post, requester, assignee, free-text goal
  (the task description), optional thread/diff/path references. Delegation
  and the board share one task primitive — there are not two kinds of task.
- **FR-13.2** Task lifecycle: `proposed → accepted → running → needs-review →
done | declined | failed | expired`. Every transition is an event in the
  local store and renders live on the task card.
- **FR-13.3** Acceptance is governed by the assignee environment's existing
  inbound policy (`manual` / `trusted-members` / `off`, v0.2 §6.8). `manual`
  means the agent's owner approves before anything runs. Delegation **never**
  bypasses runtime mode, tool policy, path scope, or trust state.
- **FR-13.4** An accepted task runs as a normal thread on the assignee's home
  environment, attributed to the agent, with the task reference carried on
  the thread. Progress streams to the task card as coarse states — not a
  token firehose into the channel.
- **FR-13.5** The terminal report posts back to the origin channel as a card:
  outcome, diff reference, and a one-paragraph agent summary. The requester
  can open the full thread from the card (subject to the thread being on a
  reachable environment; otherwise the card carries the summary and diff).
- **FR-13.6** **Review requests** are tasks with a diff/thread reference and
  a structured verdict (`approve` / `request-changes` + findings) rendered on
  the card. Humans can be assignees too — a task assigned to a human lands in
  their notification inbox.
- **FR-13.7** Cross-environment delegation uses the signed inbox transport
  (M3). The requester sees queued/delivered/accepted states truthfully;
  an unreachable assignee shows as queued with TTL, never as a spinner.

### 6.4 Work map and overlap radar (P0, R3)

- **FR-14.1** Each environment publishes **coarse work-location signals** for
  its active members: repo-relative directories (not file contents, not
  diffs) touched by running threads and by the human's working tree, at
  directory granularity, throttled, over the presence transport.
- **FR-14.2** The work map renders the repo as a tree/treemap with member
  avatars on the areas they are active in, live.
- **FR-14.3** **Overlap radar:** when two members' active areas intersect, or
  a teammate's published branch touches directories with local uncommitted
  changes, surface a passive, dismissible signal on Home and on the affected
  thread — "Aria and Bob are both working in `apps/server/src/auth/`" —
  linking to both. Never a modal, never blocking.
- **FR-14.4** Work-location sharing is per-project, on by default at
  directory granularity, off-switchable per environment; the setting's scope
  and current state are always inspectable. No signals leave the roster
  membership.
- **FR-14.5** Radar signals are advisory only. No locking, no reservation.
  Visibility over coordination protocols — same philosophy as
  borrowed-agent semantics.

### 6.5 Activity, digests, and notifications (P0 feed/inbox in R1; digests R3)

- **FR-15.1** The **activity feed** is a per-project timeline projected from
  existing events: threads started/completed (with agent attribution),
  checkpoints, handoffs, task transitions, trust decisions, roster publishes,
  duty runs. Filterable by member and kind. No new event sources — it is a
  projection.
- **FR-15.2** The **notification inbox** unifies everything addressed to me:
  mentions, delegation/review requests, task updates on things I requested,
  trust prompts, queued-message expiries. Every item is actionable in place
  and deep-links to its source. Read state syncs across my paired devices.
- **FR-15.3** **Digests**: a generated summary of a member's activity over a
  window (day/week) — threads, commits, tasks, notable events. My own agents'
  digests are generated locally by my environment (optionally using a bound
  provider); a digest is shareable to a channel as a `digest` post.
  **Standup mode**: one action posts my whole environment's digest (me + my
  agents) to `#team`.
- **FR-15.4** Digests are pull/explicit-share only in v1. No scheduled
  auto-posting until duties (§6.6) ship, and then only as a configured duty.

### 6.6 Agent duties (P1, R4)

- **FR-16.1** A duty is a scheduled recurring task declared on an agent's
  profile (T0, reviewable in PR): schedule, goal, report channel.
- **FR-16.2** Duties run only on the agent's home environment, only when it
  is running, under the agent's full mechanical character and trust state.
  Missed windows are reported as missed, not silently skipped.
- **FR-16.3** Duty runs report to their channel as terminal cards
  (FR-12.6 applies — a nightly duty is one post, not a play-by-play).
- **FR-16.4** Because duties are repo-sourced _scheduled autonomous
  execution_, they are held to the strictest trust gate: a new or changed
  duty is inert until the home environment's owner explicitly confirms it.

### 6.7 Task registry and board (P0, R2)

Not a Jira. A shared backlog with exactly enough structure for a hybrid team
to plan, hand out, and track work — where "hand out" includes handing to an
agent.

- **FR-18.1** A project has a **task registry**. A task carries: title,
  description (Markdown; **doubles verbatim as the delegation prompt** when
  assigned to an agent), labels (freeform strings, seeded with
  `implementation` / `qa` / `design` / `docs`), optional references
  (thread, diff, path, channel post), creator, optional assignee (human or
  agent), and state.
- **FR-18.2** Board states are exactly four: `todo` → `in-progress` →
  `done` / `cancelled`. The finer delegation lifecycle (FR-13.2:
  accepted/running/needs-review/failed…) renders as **execution detail on
  the card**, never as extra columns. An agent accepting a task moves it to
  `in-progress` automatically; its terminal report offers the `done` /
  back-to-`todo` decision to a human — an agent never marks its own work
  `done`.
- **FR-18.3** Humans and agents can both create tasks. Agent-created tasks
  (e.g. follow-ups spun out of a review) are visibly agent-authored, always
  land in `todo` unassigned, and never self-assign — the same reactive
  principle as FR-12.6.
- **FR-18.4** Tasks have **comments**: the same typed-post model as channels
  (text, diff cards, thread cards). Mentioning an agent in a comment offers
  to assign or delegate _this_ task. Comment noise rules follow FR-12.6.
- **FR-18.5** Assignment: to a human → their notification inbox; to an agent
  → the delegation flow (§6.3) with the description as the goal, gated by
  the assignee environment's policy as always. Unassigned tasks are the
  backlog. Reassignment and hand-back preserve the task's history.
- **FR-18.6** Storage and sync follow the channel model (FR-12.4): tasks
  live in the environment event stores and fan out as signed envelopes —
  **never in Git**. Concurrent edits resolve last-writer-wins per field,
  with every transition an attributed event ("Bob moved to Done") so the
  task timeline stays honest even when two members race.
- **FR-18.7** The **board** is a four-column kanban over the registry:
  drag between columns, filter by label / assignee / human-vs-agent; cards
  show assignee avatar with accent, labels, live execution state, and
  comment count. A list view ships with it for free.
- **FR-18.8** **Anti-Jira guardrails, enforced as scope law:** no custom
  workflows, no required fields beyond title, no estimates, sprints, epics,
  or hierarchies in v1. Labels are the only taxonomy. Any of these returns
  only with R2 usage data behind it.

### 6.8 Decision records and pulse (P2, R4+)

- **FR-17.1** Promote a post, conversation span, thread, or task to a
  **decision record**: a generated-then-editable Markdown file under
  `.repokin/decisions/`, committed like any roster change. The record links
  back to its origin; the origin shows it was promoted.
- **FR-19.1** **Repo pulse** visualizes contribution and hot spots over time,
  split human vs agent, from Git history + attribution trailers. Read-only,
  computed locally.

### 6.9 T3 Code compatibility (P0, permanent)

FR-10.1 through FR-10.4 carry forward verbatim: every upstream capability
keeps working; team features are additive and invisible until enabled;
degrade cleanly without Git/remote/`.repokin/`; upstream merges stay
affordable per [fork-policy.md](./fork-policy.md).

---

## 7. UI revamp — the design north star

### 7.1 The problem, stated honestly

Every RepoKin feature currently lives in one 1,859-line Settings page:
roster, agent editor, inbox, handoff, presence, publish, trust — a developer
tools panel, not a workplace. The plumbing beneath it is good; the surface
actively hides it. R1 is primarily _this_ fix.

### 7.2 Information architecture

```text
Sidebar (per project)
├── Threads            ← existing T3 Code surface, untouched
├── TEAM                                          ← new, fork-owned
│   ├── Home           mission control: my agents, teammates, waiting-on-me
│   ├── Channels       #team, #reviews, …          (R2)
│   ├── Board          todo / in-progress / done / cancelled   (R2)
│   ├── People         roster → member profile pages
│   └── Activity       filterable project timeline
└── Settings
    └── RepoKin        env-local config only: remote, trust, bindings
```

- Composer keeps the agent picker; picking an agent shows its accent and
  mechanical badges inline (model, mode, scope) so "who am I talking to and
  what may they do" is always one glance away.
- Presence lives on avatars everywhere a member appears — sidebar, cards,
  channel rows — as a static dot (`online` / `busy` / `away` / `offline`).
- Command palette gains team verbs: "message Aria", "assign thread to…",
  "open #team", "show work map".

### 7.3 Design language — "calm control room"

Contemporary agent-era product feel (the density and finish of Linear, the
conversational clarity of Slack, the live-status confidence of Vercel), under
T3 Code's existing performance discipline:

- **Agents are people-shaped, visibly non-human.** Every member has an avatar;
  agents get a generated geometric identicon on their accent color plus a
  small AI glyph. Owner attribution ("Aria · runs on julius-mbp") appears
  wherever an agent acts. Never pretend an agent is a human.
- **Accent color as identity thread.** An agent's accent runs through its
  avatar, thread chips, diff cards, and work-map presence — you learn to see
  "purple = Aria" the way you learn a teammate's handle.
- **Live without lying, calm without staleness.** Static presence dots and
  state-transition micro-animations only — **no continuously repainting
  indicators** (T3 Code cardinal sin, carried forward). Staleness is always
  visible: stale presence shows as offline; queued shows as queued with TTL;
  gaps show as gaps.
- **Cards over transcripts.** Threads, diffs, tasks, and digests render as
  compact live-state cards with deep links. The channel is a control surface;
  detail lives one click deeper.
- **Dark-first, both themed.** Inherit the existing token system; the Team
  space may extend tokens, never fork them.
- **Keyboard-first and dense.** Every team action reachable from the palette;
  information density tuned for developers, not marketing pages.

### 7.4 Reconciling the revamp with fork policy

Q6 (v0.2) said "near-total visual continuity." That stays true **for
inherited surfaces** — no restyling of upstream screens, no token sweeps, no
package renames. The Team space, however, is built entirely in fork-owned
files (new routes, new components, additive tokens), where divergence has
zero merge cost. The rule:

> **Diverge freely in files upstream will never touch; diverge never in
> files it will.**

### 7.5 R1 screen inventory

| Screen             | Replaces                         | Core content                                                            |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------- |
| Team Home          | — (new)                          | My agents w/ live status · teammates · waiting-on-me · recent activity  |
| People             | Settings roster list             | Humans + agents, presence, borrowed badges                              |
| Member profile     | Settings agent editor (embedded) | Identity · character (readable) · compiled preview · recent work · edit |
| Activity           | Settings activity list           | Filterable timeline w/ attribution chips                                |
| Notification inbox | Settings inbox control           | Actionable, deep-linking, cross-device read state                       |
| Publish tray       | Settings publish affordance      | Pending roster commits · explicit push (Q2 unchanged: never auto-push)  |

---

## 8. Non-functional requirements

v0.2 §8 carries forward in full (performance, offline-first, security,
auditability, Git hygiene). Additions:

- **NFR-1 Channel scale.** Channel history render and scroll stay smooth at
  10k+ posts per channel (virtualized, same discipline as thread views).
  Relay fan-out is bounded per post by roster size; no per-member polling.
- **NFR-2 Work-map cost.** Work-location signals are throttled and coalesced;
  the map repaints on state change only. Zero steady-state GPU cost.
- **NFR-3 Delegation safety.** No path by which a channel post causes code
  execution without the assignee environment's policy gate. Prompt-injection
  containment: a task's free text is model input for the _assignee agent
  under its own mechanical character_, never harness instructions.
- **NFR-4 Privacy boundary.** Work signals, presence, digests, and posts
  never leave roster membership; all cross-environment payloads remain
  signed and verified against roster keys (M3 model).
- **NFR-5 Truthful delivery.** Every social surface shows real delivery/
  freshness state. A gap, a queue, and an expiry are all rendered as what
  they are.

---

## 9. Architecture direction (delta)

The landed M0–M3 architecture carries the new features without new
subsystems:

```text
Team space UI (fork-owned routes/components)
      │ typed WS (packages/contracts/src/team.ts — additive)
      ▼
Team domain (apps/server/src/team/) — existing engine
  ├─ Channels   = new command/event family + projection; transport = M3 relay queue
  ├─ Tasks      = new event family (registry + board + delegation share it);
  │               execution = existing thread + attribution; sync = channel model
  ├─ Work map   = projection over presence + thread cwd signals (T2, ephemeral)
  ├─ Feed/inbox = projections over existing events (no new sources)
  └─ Digests    = local generation over T1 read models
```

Three rules from v0.2 remain binding: complexity at the adapter boundary;
contracts are schema-only and additive; migrations in the `1xx` range. One
addition: **social features are projections first** — before adding an event
source, prove the feature cannot be projected from events we already emit.

---

## 10. Roadmap

### 10.1 Landed (M0–M3, per implementation-plan.md)

Fork foundation and upstream sync; Git-backed roster and character with
per-provider compilation and preview; agent↔provider binding; trust prompts;
attribution on threads/checkpoints/commits; local presence, inbox, handoff;
roster sync from the team remote; signed cross-environment messaging with
durable relay queue and receipts; cross-machine presence; borrowed-agent
visibility. Remaining M1–M3 exit gates (blind A/B, two-machine acceptance,
perf checks) stay open and should be closed during R1.

### 10.2 Next milestones

Each is independently shippable; each earns the next.

**R1 — The Team space (UI revamp).** §6.1, §6.5 feed + inbox, §7 in full.
No new distributed features — R1 makes the landed plumbing _visible and
lovable_, closes the open M1–M3 exit gates, and establishes the design
system for everything after.
_Gate: a new user can create an agent, see it on Home, watch it work in the
activity feed, and never open Settings._

**R2 — Channels, delegation, and the board.** §6.2, §6.3, §6.7. `#team` by
default, typed posts, @mention-to-task, review requests, task registry with
the four-state kanban board.
_Gate: a two-environment team completes backlog task → assign to agent →
accept → run → diff-card → human review → Done entirely inside RepoKin._

**R3 — Visibility.** §6.4 work map + radar, §6.5 digests + standup mode.
_Gate: overlap between two members surfaces within the presence staleness
horizon; a standup digest posts to #team in one action._

**R4 — Workplace maturity.** §6.6 duties, §6.8 decision records and pulse —
sequenced by R2/R3 usage data, not preplanned in detail.

---

## 11. Risks

v0.2's risk table carries forward (character cosmetic; repo-sourced
character as attack vector; upstream drift; scope explosion; Git noise;
connectivity; borrowed agents; single-user confusion). New or elevated:

| Risk                                                     | Severity | Mitigation                                                                                                                 |
| -------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| **We build a worse Slack instead of a better workplace** | High     | Typed work-anchored posts only; agents cannot post unprompted (FR-12.6); every message references work; no free chat.      |
| **Agent noise makes channels unreadable**                | High     | FR-12.6 posting rules; terse-by-default cards; per-member filters; duty = one terminal post.                               |
| **Delegation becomes remote code execution**             | High     | Assignee-side policy gate always decides (FR-13.3); mechanical character + trust unchanged by any inbound request (NFR-3). |
| **Channel history divergence confuses users**            | Medium   | Honest gap markers (FR-12.4/12.5); no fake total order; TTL surfaced.                                                      |
| **Work-map privacy discomfort**                          | Medium   | Directory granularity only; per-environment kill switch; inspectable scope (FR-14.4).                                      |
| **The task registry grows into a Jira**                  | Medium   | FR-18.8 scope law: four states, labels-only taxonomy, no workflows/estimates/epics until usage data demands otherwise.     |
| **New UI surface drifts from upstream design system**    | Medium   | Shared tokens, additive extensions only; divergence confined to fork-owned files (§7.4).                                   |
| **R1 becomes a redesign of T3 Code**                     | Medium   | Inherited surfaces are explicitly out of scope; §7.4 rule enforced in review.                                              |

---

## 12. Open questions — with default recommendations

Q1–Q6 from v0.2 stand as decided (Q6 amended by §7.4). New:

### Q7 — Channel history: convergence model

**Recommendation.** Signed fan-out via the existing relay queue; per-sender
causal order with arrival tiebreak; best-effort backfill within the relay
TTL; visible gap markers beyond it. No CRDT, no designated host, no
peer-to-peer backfill protocol in v1.

**Why:** channels here are coordination streams, not systems of record. The
system of record for work is the repo and the thread stores. A CRDT layer is
weeks of work to eliminate gap markers that honest UI renders acceptably.

### Q8 — Work-location sharing: default on or off?

**Recommendation.** On by default at directory granularity for roster
members, with a prominent per-environment off switch and a per-project
override. Never file contents, never diffs, never outside the roster.

**Why:** the radar is the wedge feature and defaults decide whether it
exists. Directory granularity is the same information a teammate gets from
`git fetch && git diff --stat origin/anyone`s branch — we are moving it
earlier, not revealing something new.

### Q9 — Do agents get channel autonomy levels?

**Recommendation.** No. Agents post only reactively (FR-12.6) in v1. An
"agent may start conversations" capability waits for R4 duty data.

**Why:** one chatty agent poisons the channel for a whole team during the
exact window in which trust in the product is forming.

### Q10 — Digest generation: which model runs it?

**Recommendation.** The member's own environment generates its digests,
using a locally bound provider instance when available and a deterministic
template fallback when not. Never a teammate's credentials, never a hosted
service.

**Why:** follows the credential sovereignty rule; the fallback keeps
digests working offline and provider-free.

---

## 13. Success metrics

M1–M3 metrics from v0.2 remain open and owed. For the new work:

**R1 — is the workplace visible?**

- ≥70% of team-feature interactions happen in the Team space rather than
  Settings within 2 weeks of R1.
- Time from fresh project to "agent created and visible on Home" < 3 min.
- Zero p95 regressions on thread open and project switch.

**R2 — does delegation work?**

- ≥50% of delegations reach a terminal state (not expired/declined).
- Median mention → accepted < 5 min when assignee environment online.
- ≥30% of multi-agent projects use review requests weekly.
- ≥50% of active projects have a non-empty board in week 2; ≥40% of tasks
  that reach `done` were executed by an agent (the board is a hybrid
  planning surface, not a human-only todo list).

**R3 — does visibility matter?**

- Radar precedes ≥1 real overlap per active team per week (measured by
  overlapping paths later appearing in both members' commits).
- ≥40% of weekly-active teams post ≥1 digest per week.

**Continuous — fork health (unchanged):** weekly upstream merges, <2h
conflict cost, zero upstream features lost.

---

## 14. What we are explicitly deferring

- Voice/huddle rooms; free-floating chat.
- Autonomous agent-to-agent negotiation and agent-initiated conversations.
- Character marketplace (still nearly-free later; still not now).
- Cross-repo teams; audit export; compliance; RBAC; hosted anything.
- Automatic conflict resolution — the radar warns; humans and their agents
  resolve.
