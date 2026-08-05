# RepoKin day-one recipe

Practical path from a RepoKin desktop build to solo use, remote phone control,
and a small hybrid team. No separate cloud agent server required.

## What you need

| Piece                   | Role                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **macOS desktop app**   | Hosts the local server, UI, and projects                                                     |
| **Provider CLI(s)**     | Codex / Claude Code / Cursor / Grok / OpenCode — installed **on the host Mac** and logged in |
| **Optional: Tailscale** | Stable private network so iOS (and teammates) can reach the host away from home Wi‑Fi        |
| **Optional: iOS app**   | Remote control for the same environment (does not run agents itself)                         |

Credentials stay on the machine that runs the server. RepoKin never ships
provider API keys to phones or other laptops.

## 1. Build or install the macOS app

### From this repo (local release DMG)

```bash
# From the repository root
vp i
vp run build:desktop

# Unsigned local DMG for Apple Silicon (typical personal Mac)
pnpm dist:desktop:dmg:arm64
# or: node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64
```

Artifact lands under `dist/` (name shape: `RepoKin-<version>-arm64.dmg`).
Open the DMG and drag **RepoKin (Alpha)** to Applications.

Product metadata:

- App name: **RepoKin (Alpha)** (or Nightly / Dev)
- Bundle id: `com.repokin.app`
- Dock / disk icon: RepoKin mark (`assets/repokin/`)

### Dev loop (no DMG)

```bash
vp run dev:desktop
```

Shows as **RepoKin (Dev)** with the same icon pipeline.

## 2. First open on the host Mac

1. Launch **RepoKin**.
2. Install and authenticate at least one provider CLI (on this Mac):

   | Provider    | Login                                       |
   | ----------- | ------------------------------------------- |
   | Codex       | `codex login`                               |
   | Claude Code | `claude auth login`                         |
   | Cursor      | `agent login` (CLI provides `cursor-agent`) |
   | Grok Build  | `grok login`                                |
   | OpenCode    | `opencode auth login`                       |

3. Add a project (folder with a git repo).
4. Optional RepoKin team layer: open **Team** in the sidebar, create an agent
   under **People**. Env-local settings (remote, bindings, trust, duties) live
   under **Settings → RepoKin**.

You can use the product fully at this step with **no network access** and no
extra server deploy.

## 3. Remote control from iOS (same environment)

Agents still run on the Mac. The phone is a paired client.

1. On the Mac, open **Settings → Connections**.
2. Turn **Network access** on (backend restarts on all interfaces).
3. Prefer **Tailscale** on the Mac and the phone (recommended off-LAN).
   - Optional: enable **Tailscale HTTPS** in Connections for HTTPS pairing URLs.
4. **Create Link** (or run `npx t3 pair` / `npx t3 pair --tailscale` against a
   running server) and open/scan the pairing URL on iOS.
5. In the mobile app, the environment appears after pairing; open projects and
   drive threads from there.

Same-Wi‑Fi LAN pairing works without Tailscale; away-from-home needs Tailscale
or another private mesh / tunnel.

## 4. Teammates

### A. They control _your_ host (shared environment)

Share a pairing link (and keep the Mac / host online). They install desktop or
mobile clients and pair to your endpoint. Their agents use **your** machine’s
providers and filesystem.

### B. Each person has their own laptop (hybrid team)

1. Each person installs RepoKin desktop on **their** Mac and logs in **their**
   provider CLIs.
2. Share the git repo; use `.repokin/` roster + Team features for channels,
   board, presence, and duties.
3. Cross-environment messaging uses the signed relay model when configured —
   still not a multi-tenant cloud runtime.

### C. Always-on shared box (optional)

Run a headless server on a Mac mini / Linux host (`npx t3 serve`, optionally
Tailscale Serve). Pair everyone to that host. Provider CLIs must be
authenticated **on that host**.

## 5. What you do _not_ need

- A separate SaaS deploy for coding agents
- Putting API keys on the phone
- Opening the server to the public internet (prefer Tailscale / private mesh)

## 6. Version / update tips

- Keep desktop and server artifacts from the same monorepo build when possible.
- User data for this fork lives under Application Support **RepoKin (Alpha)**
  (legacy **T3 Code (Alpha)** folders are still preferred if present so old
  installs do not lose settings).
- Server state defaults to `~/.t3/userdata` unless `T3CODE_HOME` is set.

## Checklist

- [ ] DMG installed (or `dev:desktop` running)
- [ ] Dock icon shows RepoKin mark, window title says RepoKin
- [ ] Provider CLI logged in on host
- [ ] Project open; can start a thread
- [ ] (Optional) Network access + Tailscale + iOS paired
- [ ] (Optional) Teammates either paired to host or running their own desktop
- [ ] (Optional) Team → agent + duty confirm for RepoKin team features
