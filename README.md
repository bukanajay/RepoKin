# RepoKin

RepoKin is a multi-surface control center for coding agents. It lets you
run and control agents from the web, desktop, and mobile clients while keeping
the performance, remote access, and provider flexibility that made T3 Code
useful.

RepoKin is a fork of [T3 Code](https://github.com/pingdotgg/t3code). It
works with locally authenticated subscriptions and CLIs for Codex, Claude
Code, Cursor, Grok Build, and OpenCode. RepoKin is building a Git-native
team layer on top of that foundation, including persistent named agents,
agent character and policy, repository-based rosters, attribution, and team
presence and messaging.

## What RepoKin includes

- Web, Electron desktop, iOS, and Android clients
- A Node.js WebSocket server for local and remote control
- Provider adapters for Codex, Claude Code, Cursor, Grok Build, and OpenCode
- Remote-ready operation over local networks, Tailscale, and T3 Connect
- Project workspaces, checkpoints, terminal access, reviews, and agent status
- RepoKin's Git-native roster and persistent agent identity layer

The original T3 Code capabilities remain part of this fork. RepoKin is
intended to continue receiving upstream fixes and features while keeping its
team-specific work in the RepoKin layer.

## Install a provider

Before using RepoKin, install and authenticate at least one supported
provider:

- [Codex CLI](https://developers.openai.com/codex/cli): `codex login`
- [Claude Code](https://claude.com/product/claude-code): `claude auth login`
- [Cursor CLI](https://cursor.com/cli): `agent login`
- [Grok Build CLI](https://x.ai/cli): `grok login`
- [OpenCode](https://opencode.ai): `opencode auth login`

Each provider uses the credentials and subscription configured on the machine
where its CLI runs. RepoKin does not transfer provider credentials between
machines.

## Build and run locally

### Prerequisites

- Node.js `24.13.1` or newer in the Node 24 release line
- pnpm `11.10.0`
- [Vite+ (`vp`)](https://viteplus.dev/guide/)

Install Vite+ if it is not already available:

```bash
curl -fsSL https://vite.plus | bash
```

Then clone and install the workspace dependencies:

```bash
git clone https://github.com/bukanajay/RepoKin.git
cd RepoKin
vp i
```

Optional local configuration can be copied from `.env.example`:

```bash
cp .env.example .env
```

Most local development does not require additional environment variables.

### Development mode

Start the server and web client together with hot reload:

```bash
vp run dev
```

Open the one-time pairing URL printed in the terminal. By default, the web
client uses port `5733` and the server uses port `13773`; the startup output
is authoritative if those ports are already occupied.

For desktop development:

```bash
vp run dev:desktop
```

To run only one side of the browser stack:

```bash
vp run dev:server
vp run dev:web
```

To share a development instance over the machine's Tailscale network:

```bash
vp run dev --share
```

Do not set `VITE_HTTP_URL` or `VITE_WS_URL` for local development. The web
client is single-origin and Vite proxies the API and WebSocket paths to the
local server.

### Production build and local server

Build the workspace:

```bash
vp run build
```

Start the production server, which serves the built web client:

```bash
vp run start
```

### Desktop packages

Build a local macOS DMG (arm64 by default):

```bash
vp run dist:desktop:dmg
```

Other packaging commands are documented in
[`docs/internals/scripts.md`](./docs/internals/scripts.md).

## Documentation

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Remote access](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- [RepoKin product requirements](./docs/project/repokin/prd.md)
- [RepoKin implementation plan](./docs/project/repokin/implementation-plan.md)
- [Fork policy and upstream sync](./docs/project/repokin/fork-policy.md)
- [Architecture and internals](./docs/internals/overview.md)
- [Reference scripts](./docs/internals/scripts.md)

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[fork policy](./docs/project/repokin/fork-policy.md) before opening an
issue or pull request. RepoKin-specific features should remain isolated
from upstream code where possible so that upstream T3 Code improvements remain
easy to merge.

## Thanks

RepoKin would not exist without T3 Code. Thank you to Theo Browne, the
original author of T3 Code, and to the T3 Code contributors for creating an
open, performant, remote-ready foundation that we can extend for RepoKin.

- Original project: [T3 Code](https://github.com/pingdotgg/t3code)
- RepoKin: [github.com/bukanajay/RepoKin](https://github.com/bukanajay/RepoKin)
