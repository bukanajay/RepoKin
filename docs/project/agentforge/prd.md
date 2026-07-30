# AgentForge — Product Requirements Document

**Status:** Draft v0.2 (refined) — implementation started on `forge`
**Based on:** fork of [T3 Code](https://github.com/pingdotgg/t3code)
**Date:** 2026-07-30
**Supersedes:** PRD v0.1

Companion documents:

- [Implementation plan](./implementation-plan.md)
- [Fork policy — staying mergeable with upstream](./fork-policy.md)

---

## 0. What changed from v0.1

v0.1 was directionally right. This revision changes six things, each of which
materially changes what gets built:

1. **Git is not the source of truth for identity — it is the source of truth for
   the _roster and the keys_.** The distinction matters because T3 Code has no
   multi-human user model at all. See §3.
2. **"Team member" across machines means _environment federation_, not user
   accounts.** An agent is a process on someone's machine holding someone's
   provider credentials. There is no shared runtime to join. See §3.2.
3. **Character must have mechanical effects, not just prose.** Model, runtime
   mode, interaction mode, and tool policy are part of character. Otherwise
   character is cosmetic and the differentiator evaporates. See §6.3.
4. **Repo-sourced character is an attack surface.** A PR that edits an agent's
   tool policy edits what your machine will do unattended. v0.1 did not mention
   this. It is a P0 requirement, not a v2 hardening pass. See §8.3.
5. **The MVP is smaller.** Persistent named agents with real character and
   attribution, on one machine, is the whole first release. Presence, messaging,
   and cross-machine are separately-earned milestones. See §10.
6. **Upstream mergeability is a product requirement with a real cost model**,
   not a footnote. It constrains where code may be written. See
   [fork-policy.md](./fork-policy.md).

---

## 1. Vision

Software teams should be able to treat AI coding agents as **persistent, named,
opinionated team members** rather than anonymous sessions.

An agent has a durable identity and character — its expertise, conventions,
model, guardrails, and voice — and that identity lives in the Git repository
next to the code it works on. Because the repository is the shared artifact a
team already agrees on, it is also the natural registry of who is on the team,
human or otherwise.

AgentForge is T3 Code plus a Git-native team layer.

### The one-line pitch

> Your repo already knows who wrote every line. AgentForge makes it know _who
> your agents are_ — and lets them work like colleagues instead of tabs.

### What we are betting on

The bet is **not** that agent-to-agent chat is valuable. The bet is that
**persistent character plus attribution** changes how teams work: you learn that
"Aria reviews for accessibility and is picky about test coverage" the same way
you learn it about a human, and you route work accordingly. Messaging and
cross-machine presence are how that bet scales to a team, but they are not the
bet itself. We should be honest about this ordering internally, because it
determines what we cut when we are late.

---

## 2. Goals and non-goals

### Goals

| #   | Goal                                                                       | How we know it worked                                                                   |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| G1  | Agents persist across sessions with character that changes their output    | Same prompt to two agents produces recognizably different work                          |
| G2  | The roster (humans + agents) lives in the repo and is reviewable like code | `git log .agentforge/` reads like a team history                                        |
| G3  | Character is mechanically enforced, not just suggested                     | Character sets model, runtime mode, and tool policy — verifiable without reading output |
| G4  | Work is attributable to a specific agent                                   | Threads, checkpoints, and commits name the agent                                        |
| G5  | Team members on different machines can discover and reach each other       | Roster from remote; messages delivered when both online, queued when not                |
| G6  | Offline-first: everything single-machine works with no network             | Airplane mode loses only cross-machine features                                         |
| G7  | Upstream T3 Code fixes and features keep flowing in                        | Weekly upstream merge lands with bounded conflict cost                                  |
| G8  | No regression to T3 Code's core experience                                 | Latency, multi-provider support, and remote access unchanged                            |

### Non-goals

Unchanged from v0.1, plus three additions:

- Replacing GitHub/GitLab as the code host.
- A general-purpose multi-agent framework unrelated to software development.
- Sub-second presence accuracy from Git alone.
- Fully decentralized identity with no optional relay.
- Automatic merging or unsupervised autonomous multi-agent coding.
- **(new)** Multi-tenant accounts, org management, SSO, or billing. Repository
  write access is our authorization root. We are not building an identity
  provider.
- **(new)** Syncing provider credentials or subscriptions between machines. Each
  environment authenticates its own providers. This is already a T3 Code
  non-goal and stays one.
- **(new)** Storing conversation history in Git. See open question Q5 (§12).

---

## 3. The architectural correction that shapes everything

### 3.1 Three tiers of truth

v0.1 correctly said "Git for identity, ephemeral channel for presence." The
sharper framing that should drive design review:

| Tier                     | Store                       | Holds                                                                | Change rate | Exists today?                                                                                 |
| ------------------------ | --------------------------- | -------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| **T0 — Repository**      | Git, committed, reviewed    | Roster, character, ownership, policy, public keys                    | Days        | Precedent: `t3.json` ([`t3ProjectFile.ts`](../../../packages/contracts/src/t3ProjectFile.ts)) |
| **T1 — Environment**     | Local SQLite, event-sourced | Agent↔provider bindings, thread ownership, inbox, audit log, secrets | Seconds     | Yes — [`orchestration/`](../../../apps/server/src/orchestration/)                             |
| **T2 — Relay / tailnet** | Ephemeral, signed           | Presence, live endpoints, message transport                          | Sub-second  | Yes — [`AgentAwarenessRelay.ts`](../../../apps/server/src/relay/AgentAwarenessRelay.ts)       |

**Design rule:** a fact belongs in the lowest-latency tier that can hold it, and
in Git _only_ if a teammate should be able to review the change in a PR.

Practical consequence: nothing that changes more than once a day is ever written
to Git. Presence, endpoints, message bodies, and session state are all T1/T2.

### 3.2 There is no shared runtime — this is environment federation

The most important fact about the codebase that v0.1 does not account for:

> **T3 Code has no concept of a second human.** An _environment_ is one T3
> server on one machine, owned by one operator, reached by paired devices
> ([`auth/`](../../../apps/server/src/auth/),
> [`docs/architecture/remote.md`](../../architecture/remote.md)). "Remote" means
> reaching _your own_ machine from elsewhere — not reaching a teammate's.

So "the team can see each other" does not mean logging into a shared service. It
means **environment A talks to environment B**, each still owning its own
providers, filesystem, and credentials. An agent named `Aria` is not a cloud
entity; it is a configured provider instance running inside exactly one
environment at a time.

This yields a clean and — importantly — implementable trust model:

- **The repository is the key directory.** Each member profile in
  `.agentforge/` carries the **public key of the environment** that member
  operates from. T3 Code already generates and persists an environment keypair
  for relay auth (`getOrCreateEnvironmentKeyPairFromSecretStore` in
  [`cloud/environmentKeys.ts`](../../../apps/server/src/cloud/environmentKeys.ts)).
- **Push access to the repo is membership.** If you can commit your profile to
  the default branch, you are on the team. If you cannot, you are not. We do not
  invent a second authorization system.
- **Wire identity is verified against the repo, not asserted.** An inbound
  message claiming to be from `julius@example.com` is only accepted if it is
  signed by the key that `.agentforge/humans/julius.json` says it should be.

This also means a _stale roster is a security-relevant condition_, not just a UX
one: revoking a member is a commit that removes their key. We should say so in
the UI.

### 3.3 Where an agent actually runs

An agent profile in Git describes an agent. It does not run it. Running requires
provider credentials, which are environment-local and never leave the machine.

Therefore each agent profile declares:

- `owner` — the human member who is accountable for it.
- `homeEnvironment` — the environment id where it normally runs.

Another environment may run the same agent only in **borrowed mode**, which
requires explicit local opt-in and is surfaced everywhere as
`Aria (borrowed, on julius-mbp)`. Two environments running the same agent
simultaneously is legal but always visible — we do not attempt distributed
locking over Git.

---

## 4. Target users

**Primary.** Engineering teams of 2–15 already using AI coding agents and Git,
where more than one person runs agents against the same repository and they
currently have no idea what anyone else's agents are doing.

**Secondary.** Individual developers running several specialized agents against
one project — the "I want a reviewer, an implementer, and a docs writer with
different settings" user. **This user is our fastest validation path and the M1
release targets them specifically**, because they need zero cross-machine work.

**Explicit anti-user for v1.** Large orgs needing compliance, RBAC, or audit
export. We will not serve them well and should not pretend to.

---

## 5. Concepts

Extends the existing [encyclopedia](../../reference/encyclopedia.md). New terms
belong there too once implemented.

| Term                | Definition                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Project**         | Unchanged from T3 Code: an environment-local workspace record rooted at a directory. For AgentForge it must be a Git repository. |
| **Team**            | The set of members declared in `.agentforge/` on a project's team remote.                                                        |
| **Member**          | A human or agent in the roster. Identified by `MemberId`.                                                                        |
| **Human member**    | A person. Identity anchored on `git config user.email`, enriched with display name, avatar, and environment public keys.         |
| **Agent member**    | A persistent agent: name, owner, character, provider binding, home environment.                                                  |
| **Character**       | The structured, versioned definition of how an agent behaves — prose _and_ mechanical settings. See §6.3.                        |
| **Team remote**     | The Git remote whose default branch holds the canonical roster. One per project.                                                 |
| **Environment**     | Unchanged: one T3 server, one machine, one operator's credentials. Now also a _cryptographic identity_ in the team.              |
| **Home / borrowed** | Whether an agent is running in its declared home environment or somewhere else.                                                  |
| **Presence**        | `online` / `busy` / `away` / `offline`, per member per environment. Never committed to Git.                                      |
| **Inbox**           | A member's durable queue of inbound messages and requests. Environment-local.                                                    |
| **Thread**          | Unchanged, extended with an owning agent.                                                                                        |

---

## 6. Functional requirements

Priorities: **P0** = required for M1 release. **P1** = M2/M3. **P2** = M4+.

### 6.1 Git foundation (P0)

- **FR-1.1** On project create/open, verify `git` is available. If missing, block
  team features with actionable instructions; do **not** block T3 Code's
  existing single-user flow. A non-Git project remains a valid T3 Code project.
- **FR-1.2** Offer `git init` for a non-repository directory. Never run it
  silently.
- **FR-1.3** Derive the local human identity from `git config user.name` and
  `user.email`. Allow enrichment, never silent invention. If Git identity is
  unset, prompt — do not guess from the OS user.
- **FR-1.4** All roster data lives under `.agentforge/` at the repository root
  (§7).
- **FR-1.5** Roster reads from the team remote's default branch **without
  touching the working tree** — via `git show <remote>/<branch>:<path>` against a
  periodically fetched ref. Checking out or merging to read the roster is
  forbidden; it would stomp on in-progress work.
- **FR-1.6** Roster writes are ordinary commits on the current branch. Publishing
  is explicit (see Q2, §12). No background pushes to a shared default branch.

### 6.2 Member profiles (P0)

- **FR-2.1** Human profile: member id, display name, Git email(s), optional
  avatar and bio, environment public keys, optional pronouns.
- **FR-2.2** Agent profile: member id, name, owner, character, preferred
  provider driver + model, home environment, capabilities, avatar/accent.
- **FR-2.3** **No secrets in profiles, ever.** API keys, tokens, and any
  `ProviderInstanceEnvironmentVariable` marked `sensitive`
  ([`providerInstance.ts`](../../../packages/contracts/src/providerInstance.ts))
  are environment-local and must be structurally impossible to serialize into a
  profile. Enforced by schema shape and a test, not by convention.
- **FR-2.4** Unknown fields in a profile round-trip verbatim, so a teammate on a
  newer build does not lose data when an older build rewrites the file. This
  mirrors the existing `ProviderInstanceConfig` forward-compatibility rule.
- **FR-2.5** Roster refresh happens on project open, on window focus, and on a
  low-frequency interval (default 10 min), with manual refresh available.
  Fetching is `git fetch <remote> <branch>` only — never `pull`.

### 6.3 Character (P0) — the differentiator

Character is a versioned structured object with two halves.

**Expressive half** (influences the model, unverifiable):

- `persona` — free prose, the agent's voice and disposition.
- `expertise` — domains and stacks.
- `conventions` — coding style and review preferences.
- `communication` — terseness, formality, how it reports.

**Mechanical half** (enforced by the harness, verifiable):

- `provider` — driver + model preference.
- `runtimeMode` — `approval-required` or `full-access`
  ([runtime-modes.md](../../architecture/runtime-modes.md)).
- `interactionMode` — `default` or `plan`.
- `toolPolicy` — MCP servers and tool families allowed/denied.
- `pathScope` — repository globs the agent may modify.

Requirements:

- **FR-3.1** Character compiles into a per-driver instruction bundle at the
  **adapter boundary** — Codex through
  [`CodexDeveloperInstructions.ts`](../../../apps/server/src/provider/CodexDeveloperInstructions.ts),
  Claude through the `systemPrompt` path in
  [`ClaudeAdapter.ts`](../../../apps/server/src/provider/Layers/ClaudeAdapter.ts),
  and an explicit decision for Cursor, Grok, and OpenCode — including "not
  supported here," which must then be visible in the UI.
- **FR-3.2** The mechanical half is applied by the harness at session start
  regardless of whether the model honors the prose. **This is what keeps
  character from being cosmetic**, and it is the direct mitigation for the
  headline risk in §11.
- **FR-3.3** Character is versioned (`characterVersion`) and evolves additively.
- **FR-3.4** The user can preview the exact compiled instruction text for an
  agent on a given provider before running it. Character that cannot be
  inspected cannot be debugged.
- **FR-3.5** Character changes take effect on the next session, not mid-turn.

### 6.4 Attribution (P0)

- **FR-4.1** Every thread records the agent that ran it. Threads already carry
  `session.providerInstanceId`; the agent binding projects from that.
- **FR-4.2** Commits produced by an agent carry a trailer identifying it (e.g.
  `Co-Authored-By: Aria <aria@agents.local>` plus an `X-AgentForge-Agent` id
  trailer). This works with GitHub today and costs almost nothing.
- **FR-4.3** Checkpoints and turn diffs are attributable to the agent that
  produced them.
- **FR-4.4** The roster view shows each agent's recent work.

Attribution is deliberately P0 despite being unglamorous: it is the feature that
makes a multi-agent repository legible, and it is cheap.

### 6.5 Trust and safety for repo-sourced character (P0)

- **FR-5.1** When a project's `.agentforge/` is first seen, or when any
  **mechanical** field changes, the change requires explicit local confirmation
  before it takes effect. Expressive-only changes apply silently.
- **FR-5.2** The confirmation prompt shows a diff of what changed, in plain
  language ("Aria may now edit files outside `docs/`" — not a JSON blob).
- **FR-5.3** Trust decisions are environment-local and per project.
- **FR-5.4** An unconfirmed agent still runs, but with the _previously trusted_
  mechanical settings, or with safe defaults if never trusted. It never silently
  escalates.

Rationale: `.agentforge/` is pulled from a shared branch. Without this, a merged
PR can flip an agent to `full-access` on every teammate's machine. This is the
same class of risk that editors handle with workspace trust; we handle it the
same way and ship it with M1.

### 6.6 Presence (P1)

- **FR-6.1** States `online` / `busy` / `away` / `offline`, per member per
  environment.
- **FR-6.2** Agent presence derives from existing session state — the phases in
  [`agentAwareness.ts`](../../../packages/shared/src/agentAwareness.ts) already
  express `starting`/`running`/`waiting_for_approval`/`waiting_for_input`/
  `completed`/`failed`/`stale`. **Extend this; do not invent a parallel model.**
- **FR-6.3** Human presence derives from an app being connected plus recent
  input.
- **FR-6.4** Presence is never committed to Git. Ever. Non-negotiable.
- **FR-6.5** Presence has a visible staleness horizon; a member whose last
  heartbeat is older than the horizon shows as `offline`, not as their last
  known state. Lying spinners are a T3 Code cardinal sin.

### 6.7 Messaging (P1)

- **FR-7.1** Humans can message humans and agents; agents can message humans and
  agents, subject to local policy (§6.8).
- **FR-7.2** Direct messages in M2; project channels in M4 if earned.
- **FR-7.3** Messages to an offline or busy target are queued durably and
  delivered on availability, with a TTL after which they expire visibly.
- **FR-7.4** Message bodies live in the environment-local event store and are
  transported by the relay. They are **not** written to Git (Q5, §12).
- **FR-7.5** Delivery state is visible: queued / delivered / read / expired.

### 6.8 Permissions (P1)

Deliberately minimal. Three per-agent inbound policy levels, environment-local:

- `manual` — every inbound request from another member needs human approval.
  **Default.**
- `trusted-members` — auto-accept from members in the roster; still fully logged.
- `off` — no inbound.

Plus: an agent acts only with its own environment's credentials, never another
human's. Cross-member actions are _requests_ landing in an inbox, never direct
execution. No capability system in v1.

### 6.9 Collaboration primitives (P1–P2)

- **FR-9.1** Assign or claim a thread for an agent.
- **FR-9.2** Hand off a thread between agents, or agent↔human, preserving
  history and recording the handoff.
- **FR-9.3** "Request review" — a structured request landing in the target's
  inbox with a thread/diff reference.
- **FR-9.4** A team activity view: what every member is working on right now.

### 6.10 T3 Code compatibility (P0)

- **FR-10.1** Every existing capability keeps working: five providers, sessions,
  checkpoints, remote access, web/desktop/mobile.
- **FR-10.2** Team features are additive. A user who never creates an agent sees
  a product that behaves like T3 Code.
- **FR-10.3** Team features degrade cleanly, not loudly, when the project is not
  a Git repo, has no remote, or has no `.agentforge/`.
- **FR-10.4** Upstream changes keep merging. See
  [fork-policy.md](./fork-policy.md).

---

## 7. Repository data model

```text
.agentforge/
  team.json                 # team-level config: schema version, policy defaults
  humans/
    <member-slug>.json
  agents/
    <agent-slug>.json
```

One file per member — not a single roster file — so that two people adding
members concurrently do not conflict. This is the main reason to reject a single
`members.json`.

Slugs are derived and stable: humans from the Git email local-part plus a
disambiguator, agents from their name. The `id` field inside the file is
authoritative; the filename is a convenience.

**Agent profile (illustrative):**

```json
{
  "$schema": "https://agentforge.dev/schema/agent.json",
  "schemaVersion": 1,
  "id": "agent_01J8XQ2K",
  "name": "Aria",
  "type": "agent",
  "owner": "human_julius",
  "homeEnvironment": "env_9f3a...",
  "avatar": { "accentColor": "#7C5CFF" },
  "character": {
    "characterVersion": 1,
    "persona": "Direct, allergic to speculative abstraction...",
    "expertise": ["typescript", "effect", "accessibility"],
    "conventions": ["prefers inferred types", "tests alongside source"],
    "communication": { "verbosity": "terse", "reportsWith": "diff-first" },
    "provider": { "driver": "claudeAgent", "model": "..." },
    "runtimeMode": "approval-required",
    "interactionMode": "default",
    "toolPolicy": { "allow": ["fs.read", "fs.write", "git.read"], "deny": ["net.*"] },
    "pathScope": ["apps/web/**", "packages/client-runtime/**"]
  },
  "createdAt": "2026-07-30T...",
  "updatedAt": "2026-07-30T..."
}
```

**Human profile (illustrative):**

```json
{
  "schemaVersion": 1,
  "id": "human_julius",
  "type": "human",
  "displayName": "Julius",
  "gitEmails": ["julius@example.com"],
  "environments": [{ "environmentId": "env_9f3a...", "label": "julius-mbp", "publicKey": "..." }]
}
```

Note what is absent: no ports, no URLs, no presence, no tokens, no message
history. Live endpoints are resolved through the relay; the profile carries only
the public key needed to verify what the relay delivers.

**Schema publication.** Both files ship a JSON Schema at a stable URL, following
the `t3.json` precedent — annotations on the encoded side so they survive into
the published schema. This makes profiles editable in any editor with schema
support, which matters because power users will hand-edit them.

---

## 8. Non-functional requirements

### 8.1 Performance

- No regression to thread-open, turn-start, or scroll performance. The roster is
  read from a cached ref and never blocks the UI.
- `git fetch` for roster refresh runs off the interaction path, is coalesced, and
  is skipped entirely when the project is not visible.
- Presence rides the existing relay publish path and adds no new steady-state
  WebSocket traffic per member beyond a bounded heartbeat.
- T3 Code's stated performance discipline applies: no continuously repainting
  presence indicators, no per-member polling.

### 8.2 Offline-first

Creating agents, editing character, running them, attribution, and local
handoff all work with no network. Losing the network loses exactly: remote
roster freshness, cross-machine presence, and cross-machine delivery — each
degrading to a visible stale/queued state.

### 8.3 Security

- Repository write access is the authorization root (§3.2).
- Wire identity is verified against roster public keys; unsigned or
  unverifiable messages are dropped, not shown as "unknown sender."
- Mechanical character changes require local trust confirmation (§6.5).
- Secrets never enter the repository (FR-2.3).
- Agents never act with another human's credentials.
- Endpoint exposure remains controlled by existing T3 Code remote-access
  settings; the team layer adds no new listening surface.

### 8.4 Auditability

Every inter-member message, handoff, accepted request, and trust decision is an
event in the local event store — the system is already event-sourced, so this is
close to free. Export is P2.

### 8.5 Git hygiene

- Roster commits are meaningful and infrequent; presence and messages never
  touch Git.
- A team-layer commit touches only `.agentforge/`, never mixes with code
  changes.
- Commit messages are readable in `git log` without tooling
  (`chore(team): add agent Aria`).

---

## 9. Architecture direction

Build strictly additively on T3 Code's existing shape. The team layer is a new
domain that follows the same command → decider → event → projection pattern the
orchestration domain already uses, and reuses the existing relay rather than
inventing transport.

```text
┌──────────────────────────────────────────────────────────┐
│ Clients (web / desktop / mobile)                         │
│   Roster · Agent editor · Presence · Inbox               │
└───────────────┬──────────────────────────────────────────┘
                │ typed WS (packages/contracts/src/team.ts)
┌───────────────▼──────────────────────────────────────────┐
│ Server — new Team domain (apps/server/src/team/)         │
│                                                           │
│  TeamFileStore ──── reads/writes .agentforge/  (T0, Git) │
│  LocalIdentityResolver ── git config user.*              │
│  RosterSync ──────── git fetch + git show (no checkout)  │
│  CharacterCompiler ─ character → per-driver bundle       │
│  TeamEngine ──────── commands/events/projection (T1)     │
│  InboxReactor ────── durable queue, delivery, TTL        │
│  TeamPresence ────── extends AgentAwareness (T2)         │
└───────────────┬──────────────────────────────────────────┘
                │ existing seams, unchanged
┌───────────────▼──────────────────────────────────────────┐
│ ProviderService · adapters · GitManager · Relay          │
└──────────────────────────────────────────────────────────┘
```

Three existing seams carry most of the weight, which is why this is tractable:

1. **`ProviderInstanceId`** is already a user-defined routing key supporting
   multiple independently-configured instances of one driver, with
   `displayName`, `accentColor`, and an opaque `config` payload preserved
   verbatim across versions. An agent's runtime _is_ a provider instance. We are
   adding identity and character on top of a multi-instance system that already
   exists.
2. **`AgentAwarenessRelay`** already publishes per-thread activity state to the
   relay with signed proofs and an aggregate view. Presence is an extension of
   a working mechanism, not a new subsystem.
3. **`t3.json` + `T3ProjectFileLoader`** already establish the pattern for a
   checked-in, schema-published, repo-committed project file. `.agentforge/`
   follows it.

The corresponding constraint: **complexity belongs at the adapter boundary.**
Character compilation is per-driver and lives there. The team domain stays pure
and the UI stays dumb.

---

## 10. Roadmap

Each milestone is independently shippable and independently _valuable_. If we
stop after any of them, we have a coherent product.

### M0 — Fork foundation (~1 week)

Branch model, upstream sync automation, branding indirection, fork policy
documented and enforced in review. Detail in
[fork-policy.md](./fork-policy.md).

**Ships:** nothing user-visible. **Earns:** the ability to build without
drifting away from upstream.

### M1 — Persistent agents with character (the MVP, ~4–6 weeks)

Git-backed roster, human identity from Git config, agent creation with
character, character compiled into prompts and enforced mechanically, trust
prompt, attribution on threads and commits, roster UI on web + desktop, roster
read-only on mobile. **Single environment. No presence. No messaging.**

**Ships:** the product's actual thesis, for the secondary (solo power user)
persona.
**Validates:** does distinct character visibly change output, and do people
create more than one agent and keep them?

If M1 does not validate, **stop and reconsider** — the team layer's value is
downstream of character being real.

### M2 — Local presence and inbox (~3–4 weeks)

Team domain event store, presence for local members, durable inbox, direct
messages between the human and local agents, thread assignment and handoff.

**Ships:** coordination for one person running several agents.

### M3 — Cross-environment (~5–7 weeks)

Roster sync from the team remote, environment-to-environment signed messaging
over the relay, cross-machine presence, offline queue with TTL, borrowed-agent
semantics.

**Ships:** the actual team product. Also the milestone with the most unknowns
(NAT, relay capacity, key rotation) — plan for it to slip.

### M4 — Inter-agent workflows (open-ended)

Review requests, richer agent-to-agent protocols, permission refinement, audit
export, channels, mobile parity.

---

## 11. Risks

| Risk                                                             | Severity | Mitigation                                                                                                                                                        |
| ---------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Character is cosmetic** — prose in a prompt that models ignore | High     | The mechanical half (model, runtime mode, tool policy, path scope) is harness-enforced and verifiable (FR-3.2). Character has teeth even if the prose is ignored. |
| **Repo-sourced character as an attack vector**                   | High     | Trust confirmation on mechanical changes, shipped in M1 (§6.5).                                                                                                   |
| **Upstream drift makes merges unaffordable**                     | High     | Additive-only file discipline, no broad rebrand, weekly automated merge. [fork-policy.md](./fork-policy.md).                                                      |
| **Scope explosion**                                              | High     | Milestones gated on validation; M1 explicitly excludes presence and messaging.                                                                                    |
| **Git noise and conflicts**                                      | Medium   | Per-member files, no presence in Git, explicit publish, `.agentforge/`-only commits.                                                                              |
| **Cross-machine connectivity**                                   | Medium   | Reuse existing relay/Tailscale/tunnel work rather than inventing P2P. Deferred to M3 so it does not block value.                                                  |
| **Two environments running one agent**                           | Medium   | Home/borrowed semantics with visible labeling; no distributed locking attempted.                                                                                  |
| **Agents messaging each other produces noise, not work**         | Medium   | Agent-to-agent is M4, gated on M2/M3 usage data. Default inbound policy is `manual`.                                                                              |
| **Team features confuse the 100k existing single-user base**     | Medium   | Additive and invisible until a project has `.agentforge/` (FR-10.2).                                                                                              |
| **We are building a chat app instead of a coding tool**          | Medium   | Messaging exists to route work; every message primitive must reference a thread, diff, or task. No free-floating chat in v1.                                      |

---

## 12. Open questions — with default recommendations

These are **decisions, not options**. Each is the recommended default; overriding
one is fine but should be a deliberate call, not a drift.

### Q1 — Character schema and versioning

**Recommendation.** A single integer `characterVersion`, additive-only evolution,
unknown fields preserved verbatim on rewrite — exactly the forward-compatibility
contract `ProviderInstanceConfig` already documents for forks. Store as **JSON,
not Markdown**: it must be machine-validated, diffable per field, and safely
partially-updatable. Render prose fields as Markdown in the UI. Cap `persona` at
~2000 characters — a character that needs an essay is a `CLAUDE.md`, not a
character.

**Why:** a migration framework for character is premature; additive evolution
plus verbatim preservation handles years of change and lets teammates on
different builds coexist, which is the actual failure mode.

### Q2 — How aggressively should lifecycle events auto-push?

**Recommendation.** **Never auto-push.** Commit locally, batched, on explicit
save. Surface a persistent "3 team changes to publish" affordance that runs the
push when clicked. Offer an opt-in "auto-publish" setting for solo users, off by
default, and never available for the default branch of a repo with more than one
member.

**Why:** a roster change is a permission change (§6.5). Silently pushing
permission changes to a shared default branch is hostile in a team and will get
the product banned from real repos. It also makes the fork's Git behavior
predictable, which matters enormously for trust. Teams that want review get it
for free — the change rides their normal PR flow.

### Q3 — Permission model for agent-to-agent and agent-to-repo

**Recommendation.** Repository write access is the authorization root. Beyond
that, exactly three per-agent inbound policy levels (`manual` / `trusted-members`
/ `off`), defaulting to `manual`, evaluated **locally by the receiving
environment**. Cross-member actions are requests into an inbox — never remote
execution. Agent-to-repo authority is bounded by `pathScope` and `runtimeMode`
from character, enforced by the harness.

**Why:** a capability/ACL system is the single easiest way to burn six weeks and
ship nothing. Three levels covers the real cases, and "the receiving environment
always decides" means a compromised or malicious peer cannot escalate.

### Q4 — Multiple remotes and fork workflows

**Recommendation.** Exactly one **team remote** per project, stored as an
explicit project setting. Default it by the same preference order
`RepositoryIdentityResolver` already uses (`upstream`, then `origin`), but
**always show it and let the user change it** — never silently infer. Fork
workflows then work without special casing: read the roster from the team
remote's default branch, write to your own fork, open a PR. That falls directly
out of Q2.

**Why:** inferring the team remote is exactly the kind of magic that breaks
confusingly for triangular workflows, which is precisely the population most
likely to try this product.

### Q5 — How much messaging history lives in Git?

**Recommendation.** **None.** Messages live in the environment-local
event-sourced store; the relay is transport only. Git holds identity, character,
and policy.

**Why:** messages in Git means a merge conflict per conversation, unbounded repo
growth, DMs cloned onto every laptop forever, and no way to delete anything. The
one legitimate case — "this conversation produced a decision worth keeping" — is
served better by an explicit _promote to decision record_ action that writes a
normal file, which is a P2 nicety, not the storage model.

### Q6 — Branding: continuity or divergence?

**Recommendation.** **Keep near-total visual and UX continuity. Diverge only on
name and mark.** Change the display name through the existing
[`branding.ts`](../../../apps/web/src/branding.ts) indirection
(`APP_BASE_NAME` already reads from injected desktop branding) plus desktop
packaging config. **Do not rename packages** (`@t3tools/*` stays), do not
rename directories, do not sweep strings.

**Why:** two reasons, both decisive. Product: continuity is an asset — T3 Code's
UI is a differentiator we are inheriting, and a large existing user base already
knows it. Engineering: a broad rebrand is the single most expensive thing we
could do to merge cost, because it touches files upstream also touches, forever,
for zero user value. If the team layer succeeds, a visual identity of our own is
an M4+ investment made deliberately — not an M0 reflex.

**Settled:** the product name is **AgentForge**, and the repository was renamed
to [`bukanajay/AgentForge`](https://github.com/bukanajay/AgentForge) on
2026-07-30. GitHub redirects the previous `agent-fordge` URL, so existing clones
and links keep working; local clones should still update their remote.

---

## 13. Success metrics

Replacing v0.1's qualitative list with measurable ones.

**M1 — is character real?**

- ≥60% of active projects have ≥2 agents at day 30.
- ≥50% of turns run under a non-default character.
- ≥40% of agents created are still in use 14 days later (persistence, not
  novelty).
- Blind A/B: reviewers correctly identify which of two agents produced a diff
  ≥70% of the time. _This is the honest test of the entire thesis._
- Zero P0 regressions; p95 thread-open latency within 5% of upstream.

**M2 — does coordination help?**

- ≥30% of multi-agent projects use handoff or assignment weekly.
- Median inbox items acted on, not dismissed, >50%.

**M3 — does the team layer hold?**

- Roster staleness p50 < 5 minutes, p95 < 15 minutes.
- Cross-machine delivery success >99% when both sides online within TTL.
- ≥2 humans active in ≥25% of team-enabled projects (otherwise we built a
  single-player feature with extra steps).

**Continuous — fork health**

- Upstream merged at least weekly.
- Merge conflict resolution < 2 hours per sync in steady state.
- Zero upstream features lost to divergence.

---

## 14. What we are explicitly deferring

Stated plainly so it does not get re-litigated every planning cycle:

- Channels and group chat (M4, gated on DM usage).
- Agent-to-agent autonomous protocols (M4, gated on M3).
- Audit export, compliance, RBAC (unscheduled).
- Web-hosted team service or accounts (non-goal).
- Automatic conflict resolution between agents' work (non-goal for v1).
- Character marketplace or sharing (interesting, unscheduled — note that
  `.agentforge/` being plain JSON in a repo makes this nearly free later, which
  is a good reason not to build it now).
