<!--
AgentForge fork of T3 Code.

- Feature work targets `forge` (not `main`).
- `main` is a pure upstream mirror — never commit product work there.
- Prefer additive files under AgentForge-owned paths. See
  docs/project/agentforge/fork-policy.md
-->

## What Changed

<!-- Describe the change clearly and keep scope tight. -->

## Why

<!-- Explain the problem being solved and why this approach is the right one. -->

## UI Changes

<!-- If this PR changes UI, include clear before/after screenshots.
     If the change involves motion or interaction, include a short video.
     Delete this section if not applicable. -->

## Checklist

- [ ] This PR is small and focused
- [ ] I explained what changed and why
- [ ] I included before/after screenshots for any UI changes
- [ ] I included a video for animation/interaction changes

### AgentForge fork checklist

- [ ] New files live in AgentForge-owned paths (`apps/server/src/team/**`, `packages/contracts/src/team.ts`, `docs/project/agentforge/**`, etc.)
- [ ] Each upstream file touched is ≤ a few lines; logic lives in our file
- [ ] Any new migration is numbered ≥ `100`
- [ ] No secret, token, or `sensitive` env var can reach `.agentforge/`
- [ ] Feature degrades cleanly with no Git repo, no remote, or no `.agentforge/`
- [ ] Single-user T3 Code experience still looks untouched when team features are unused
- [ ] Web / desktop / mobile: each surface handled or explicitly deferred
- [ ] Provider-shaped changes: per-adapter decision made (including "not supported here")
