# RepoKin fork policy — staying mergeable with upstream T3 Code

**Upstream:** `https://github.com/pingdotgg/t3code`
**This fork:** `https://github.com/bukanajay/RepoKin`
**Status:** active (M0 applied on `forge`)

RepoKin must keep receiving upstream fixes and features indefinitely.
Upstream is highly active — 2,198 commits with the most recent landing the day
before this fork's snapshot. At that cadence, merge cost is not a one-time
migration problem; it is a **permanent tax we pay every week**, and it is set
almost entirely by decisions we make in the first month.

This document is the set of rules that keep that tax small. It is meant to be
enforced in code review, not admired.

---

## 1. The one rule

> **Add files. Do not edit them.**

Every line we write in a file upstream also maintains is a line we may have to
re-resolve on every sync, forever. Every line we write in a file upstream has
never heard of merges cleanly, always, at zero cost.

This is not a style preference. It is the difference between a fork that stays
current for years and one that silently freezes six months from now because
nobody wants to do the merge anymore.

**Corollary:** when we must touch an upstream file, the change should be as
close to _one line_ as we can make it — a registration, an import, a hook call —
with the actual logic living in our own file. A one-line conflict is a
30-second resolution. A 200-line inline feature is an afternoon.

---

## 2. Branch model

```text
upstream/main ──────────────────────────────►   (pingdotgg/t3code)
      │
      │ mirror, never commit directly
      ▼
   origin/main ─────────────────────────────►   pure upstream mirror
      │
      │ merge (weekly, automated PR)
      ▼
  origin/forge ────────────────────────────►    RepoKin trunk
      │
      ├── forge/m1-agent-roster
      ├── forge/m1-character-compiler
      └── ...                                    feature branches
```

- **`main` is a pure mirror of `upstream/main`.** Never commit to it. Its only
  job is to be a clean, always-fast-forwardable copy so that merges have an
  honest base and `git log main..forge` always answers "what is ours?"
- **`forge` is our trunk.** Releases ship from here. All RepoKin work merges
  here.
- Feature branches branch from `forge` and merge back with squash.

Setup:

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream
git branch forge main && git push -u origin forge
```

Then set `forge` as the default branch on the fork so PRs target it by default.

> **Note on `RepositoryIdentityResolver`.** T3 Code prefers a remote named
> `upstream` over `origin` when identifying a repository
> ([`RepositoryIdentityResolver.ts`](../../../apps/server/src/project/RepositoryIdentityResolver.ts)).
> Adding an `upstream` remote here means the app, when opened on its own
> repository, will report `pingdotgg/t3code` as the identity. That is harmless
> today but will look wrong once the team layer picks a team remote — which is
> exactly why PRD Q4 requires the team remote to be an explicit, visible setting
> rather than inferred.

---

## 3. Sync cadence and mechanics

**Weekly, automated.** A scheduled CI job fast-forwards `main` from
`upstream/main` and opens a merge PR into `forge`.

```bash
# what the job does
git fetch upstream --prune
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout -b sync/upstream-$(date +%Y-%m-%d) forge
git merge main                       # merge, never rebase
```

**Merge, never rebase.** Rebasing our trunk onto a moving upstream rewrites our
history, breaks every open branch, and re-resolves the same conflicts repeatedly.
Merging resolves each conflict exactly once and `git rerere` remembers it.

Enable rerere once, for everyone:

```bash
git config --global rerere.enabled true
```

**If a weekly sync is skipped, the next one is harder than two of them.** Treat a
red sync PR as a build break, not a chore.

**Do not vendor, do not squash upstream.** Keeping upstream's real commits is
what makes `git bisect` and blame work across the merge boundary.

---

## 4. Where RepoKin code goes

New, ours-only — merge cost zero:

| Concern            | Location                                          |
| ------------------ | ------------------------------------------------- |
| Team contracts     | `packages/contracts/src/team.ts`                  |
| Team server domain | `apps/server/src/team/**`                         |
| Team UI (web)      | `apps/web/src/components/team/**`                 |
| Team client logic  | `packages/client-runtime/src/team/**`             |
| Team UI (mobile)   | `apps/mobile/**/team/**`                          |
| Fork docs          | `docs/project/agentforge/**`                      |
| Migrations         | `apps/server/src/persistence/Migrations/1xx_*.ts` |

**Migration numbering.** Upstream is at `034` and counting. If we allocate `035`,
upstream's next migration collides — a genuinely painful conflict, since
migrations are ordered and already applied on users' machines. **RepoKin
migrations start at `100`.** This buys ~66 upstream migrations of headroom and
makes ownership obvious at a glance.

**Contracts subpath export.** `packages/contracts` uses explicit `exports` map
entries (`.`, `./settings`, `./relay`). Add `./team` the same way and import
`@t3tools/contracts/team` — that is a 4-line addition to `package.json` rather
than an edit to `index.ts`, and it keeps team schemas entirely out of upstream's
main barrel.

---

## 5. The seams upstream already gave us

T3 Code was written with forks in mind, and three existing extension points let
us build most of M1 with **near-zero edits to upstream files**. Using them is not
optional cleverness; it is the plan.

### 5.1 Provider instances are already multi-instance and fork-extensible

[`providerInstance.ts`](../../../packages/contracts/src/providerInstance.ts)
states the contract explicitly: `ProviderDriverKind` is an _open_ branded slug
specifically so forks can add drivers, and `ProviderInstanceConfig.config` is
`Schema.Unknown` **preserved verbatim** across version changes so unknown
payloads round-trip without loss.

That means an agent's runtime binding and any local per-agent config can ride
inside an existing settings structure with **no upstream schema change at all**.
Namespace our payload (`config.agentforge`) and it survives upstream upgrades,
downgrades, and users bouncing between our build and stock T3 Code.

### 5.2 The relay already publishes agent activity

[`AgentAwarenessRelay.ts`](../../../apps/server/src/relay/AgentAwarenessRelay.ts)
already signs and publishes per-thread activity state, with an aggregate view
and per-device fan-out. Presence (PRD §6.6) extends this rather than adding a
subsystem — and the phase vocabulary in
[`agentAwareness.ts`](../../../packages/shared/src/agentAwareness.ts) is already
the right shape.

### 5.3 `t3.json` is the precedent for checked-in project config

[`t3ProjectFile.ts`](../../../packages/contracts/src/t3ProjectFile.ts) and
[`T3ProjectFileLoader.ts`](../../../apps/server/src/project/T3ProjectFileLoader.ts)
establish everything `.agentforge/` needs: a repo-root file, a published JSON
Schema, annotations on the encoded side, trimming and validation on decode.
Copy the pattern rather than inventing one; it also means upstream improvements
to that pattern are cheap for us to adopt.

---

## 6. Unavoidable upstream touch points — and the budget for each

Some edits genuinely cannot be additive. These are the expected ones. Anything
not on this list should be challenged in review.

| File                                          | Why                       | Keep it to                                   |
| --------------------------------------------- | ------------------------- | -------------------------------------------- |
| `packages/contracts/package.json`             | export `./team`           | 4 lines                                      |
| `apps/server/src/serverLayers` (layer wiring) | register team services    | 1–3 lines                                    |
| `apps/server/src/ws.ts`                       | route team requests       | 1 line, delegating to our router             |
| `apps/web` route/nav registration             | surface the team panel    | 1–3 lines                                    |
| Provider adapters (Codex, Claude, …)          | inject compiled character | 1 call into `CharacterCompiler`, per adapter |
| `apps/web/src/branding.ts`                    | app name                  | constants only                               |

**Adapter injection is the most valuable line-budget discipline in the whole
project.** Character compilation must live in
`apps/server/src/team/CharacterCompiler.ts`; the adapter's job is to call it and
splice the result into its own instruction path. If character logic starts
growing inside `ClaudeAdapter.ts` or `CodexDeveloperInstructions.ts`, every
upstream change to those files becomes our problem. This also happens to be what
[AGENTS.md](../../../AGENTS.md) already asks for — complexity at the adapter
boundary, orchestration pure.

---

## 7. Branding: the biggest avoidable cost

**Do not sweep the codebase for "T3".**

A broad rebrand touches hundreds of files upstream also edits, produces conflicts
forever, and delivers no user value. Instead:

- Change display strings through
  [`branding.ts`](../../../apps/web/src/branding.ts) — `APP_BASE_NAME` already
  reads from injected desktop branding, so the indirection exists.
- Change the installed app name through desktop packaging config only.
- **Keep `@t3tools/*` package names, directory names, and internal identifiers.**
  Nobody sees them. They are not worth a single merge conflict.

Full visual divergence is an M4+ decision to make deliberately if the product
earns it. See PRD Q6.

---

## 8. Contributing back

Anything that is genuinely a T3 Code improvement — a bug fix, a provider fix, a
performance win we find while working — should go **upstream first** as a PR to
`pingdotgg/t3code`, then come back to us through the normal weekly sync.

Two reasons, in order of importance:

1. Code upstream accepts is code we never merge again. Every fix we keep private
   is a permanent line item on the tax bill.
2. Upstream is explicit that they are mostly not accepting contributions right
   now, and that small fixes may be considered while big features will not
   ([README](../../../README.md)). So: send the small fixes, keep the team layer
   ours, and do not waste a round trip proposing RepoKin features upstream.

Never send RepoKin-specific code upstream. It is not their product.

---

## 9. Review checklist

Every RepoKin PR:

- [ ] Are all new files in RepoKin-owned paths?
- [ ] For each upstream file touched: is the change ≤ a few lines, and does the
      logic live in our file?
- [ ] Any new migration numbered ≥ `100`?
- [ ] Any secret, token, or `sensitive` env var at risk of reaching
      `.agentforge/`? (Should be structurally impossible — verify the test
      exists.)
- [ ] Does the feature degrade cleanly with no Git repo, no remote, or no
      `.agentforge/`?
- [ ] Does the single-user T3 Code experience still look untouched?
- [ ] Web, desktop, mobile: which surfaces apply, and is each handled or
      explicitly deferred? (See [AGENTS.md](../../../AGENTS.md) "Hit every
      surface".)
- [ ] Per-provider decision made for provider-shaped changes, including "not
      supported here"?

---

## 10. Failure modes to watch for

| Symptom                                     | What it means                                            | Fix                                                                   |
| ------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Sync PR sits open more than a few days      | Conflict cost has crossed the pain threshold             | Find the upstream file we over-edited and extract our logic out of it |
| Same conflict resolved repeatedly           | `rerere` is off, or someone rebased the trunk            | Turn on `rerere`; stop rebasing `forge`                               |
| Migration collision with upstream           | Someone ignored §4                                       | Renumber ours to ≥ 100 immediately                                    |
| Upstream feature "doesn't work in our fork" | We forked behavior inline instead of extending at a seam | Move the divergence to an additive layer                              |
| Nobody has synced in a month                | The tax compounded and everyone is avoiding it           | Sync in weekly slices, oldest first — never one giant merge           |
