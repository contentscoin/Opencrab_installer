# Opencrab Installer

Desktop installer and local runtime orchestration for OpenCrab.

This repository is a public fork of the original OpenCrab source:

- Original source: [AlexAI-MCP/OpenCrab](https://github.com/AlexAI-MCP/OpenCrab)
- This installer fork: [contentscoin/Opencrab_installer](https://github.com/contentscoin/Opencrab_installer)
- OpenCrab cloud/MCP endpoint: [opencrab.sh](https://opencrab.sh)

For the full OpenCrab ontology, MCP tool, grammar, and backend documentation, use the original repository above. This README only documents the desktop installer work added in this fork.

## What This Fork Adds

This fork packages OpenCrab as a desktop application that can start the local runtime needed for ingest and graph work.

Added desktop pieces:

- Electron desktop shell in `apps/desktop`
- Windows NSIS installer build
- First-launch bootstrap for Docker Desktop and local data services
- Local orchestration for Neo4j, MongoDB, PostgreSQL, ChromaDB, FastAPI, and Next.js
- Desktop status/control HTTP server on `127.0.0.1:18273`
- OpenCrab MCP URL registration flow for `opencrab.sh`
- Codex skill/plugin asset generation for OpenCrab MCP usage
- Codex CLI task runner for Neo4j/ingest work, inspired by [Codexian](https://github.com/reallygood83/codexian)
- Initial seed/ingest bootstrap for local graph data
- Loading/error screen so startup progress is visible instead of a blank window
- Runtime supervisor that restarts local services if FastAPI, Next.js, or optional MCP helpers stop
- GitHub Release update notification prompt for newer installer versions

## Download

Installers are published on the GitHub Releases page:

[Download the latest release](https://github.com/contentscoin/Opencrab_installer/releases/latest)

Current release assets:

- Windows: `OpenCrab Setup <version>.exe`
- macOS: `.dmg` and `.zip` assets for Intel and Apple Silicon, built by GitHub Actions on a macOS runner.

## Prerequisites

The Windows installer is designed to set up the local service stack, but Docker Desktop is still the runtime used for Neo4j and the other data stores. macOS builds also use Docker Desktop for the local graph/data-service stack.

Expected runtime:

- Windows 10/11
- macOS 13+ for macOS installs
- Docker Desktop
- Internet access for the first bootstrap
- Available local ports:
  - `3000` for the web UI
  - `8080` for FastAPI
  - `18273` for desktop control
  - `7475` for Neo4j Browser
  - `7688` for Neo4j Bolt
  - `27018` for MongoDB
  - `5433` for PostgreSQL
  - `8002` for ChromaDB

If Docker Desktop is missing on Windows, the first app launch attempts to install/start it through `winget` where available. Some Windows machines still require Docker Desktop first-run approval or a restart. On macOS, install and start Docker Desktop manually before launching OpenCrab.

By default, Windows installers skip the heavy Docker/Neo4j bootstrap during installation and run it from the app on first launch. To force install-time bootstrap on a managed machine, launch the installer with `OPENCRAB_RUN_INSTALL_BOOTSTRAP=1`.

## How To Use

1. Download the Windows `.exe` or macOS `.dmg` from Releases.
2. Run the installer and wait until it completes. The installer copies the desktop app and defers Docker/Neo4j startup to first app launch so the install step stays fast.
3. Launch OpenCrab from the Start Menu or desktop shortcut.
4. Wait for the dashboard to open. Local Docker services, FastAPI, and initial graph ingest continue warming up in the background.
5. Use the dashboard for graph viewing, ingest, querying, and local service status.

Neo4j local access:

- Browser: `http://localhost:7475`
- Username: `neo4j`
- Password: `opencrab`
- Bolt URL: `bolt://localhost:7688`

OpenCrab local app endpoints:

- Dashboard: `http://127.0.0.1:3000/dashboard`
- API status: `http://127.0.0.1:8080/api/status`
- Desktop status: `http://127.0.0.1:18273/desktop/status`
- Local service status: `http://127.0.0.1:18273/desktop/services/status`

## opencrab.sh Integration

The desktop app is intended to connect a local OpenCrab workspace to an OpenCrab MCP endpoint from `opencrab.sh`.

The app can store an OpenCrab MCP URL in the user's local profile and use it for:

- checking the remote OpenCrab MCP endpoint
- listing available MCP tools
- creating local Codex skill instructions
- creating local plugin metadata
- installing a local MCP bridge script that forwards tool calls to the configured OpenCrab MCP URL

Security note:

- Personal MCP URLs and tokens are not meant to be committed or bundled into public installers.
- Release builds package `.env.example` as the default `.env`.
- User-specific MCP settings are written to the user's local profile, not to the repository.

## Codex Skill And Plugin Assets

The desktop integration can install OpenCrab assets for Codex-style agent environments:

- Skill: `opencrab-mcp`
- Local MCP bridge: `opencrab_mcp_bridge.mjs`
- Plugin metadata under the user's plugin directory
- Marketplace entry pointing at the local OpenCrab plugin

After installing those assets, restart Codex or start a fresh Codex session so the skill/plugin list can reload.

## Codex Task Runner

The Agent tab can also run local Codex CLI tasks against the OpenCrab workspace. This follows the same core pattern as Codexian: detect the authenticated Codex CLI, create a task context file, run `codex exec`, then read the final response from Codex.

Recommended local setup:

```bash
npm install -g @openai/codex
codex login
```

Task context files are written to the desktop app's user data directory under `codex-tasks`. For packaged installs, Codex writes generated ingest files under the writable `codex-workspace/opencrab_data/ingest` directory. In development mode, the repository root is used as the Codex workspace.

When `Neo4j` is checked in the Agent tab, OpenCrab Desktop starts the local Neo4j/data-service stack before invoking Codex and passes these environment variables to the Codex process:

- `NEO4J_URI`
- `NEO4J_USER`
- `NEO4J_PASSWORD`
- `OPENCRAB_MCP_URL`
- `OPENCRAB_MCP_API_KEY`
- `OPENCRAB_CODEX_TASK_FILE`

The task file redacts OpenCrab MCP tokens, but the child Codex process receives the real endpoint through environment variables so it can use the configured MCP bridge.

## Signing And Notarization

Release signing is documented in [docs/signing-notarization.md](docs/signing-notarization.md).

## Developer Commands

Build the web app:

```powershell
npm --prefix apps\web run build
```

Build the Windows installer:

```powershell
npm --prefix apps\desktop run dist:win
```

Build the macOS installer:

```bash
npm --prefix apps/desktop run dist:mac
```

Run the unpacked desktop app after packaging:

```powershell
apps\desktop\dist\win-unpacked\OpenCrab.exe
```

## Release Notes

### v1.0.0

- Adds Electron desktop app packaging.
- Adds Windows installer with Docker/Neo4j local service bootstrap.
- Adds OpenCrab MCP URL integration for `opencrab.sh`.
- Adds Codex skill/plugin asset generation.
- Starts Neo4j, MongoDB, PostgreSQL, ChromaDB, FastAPI, and Next.js from the desktop shell.
- Uses `next start` for packaged production UI.
- Shows startup progress while local services warm up.

### v1.0.1

- Adds a desktop supervisor that restarts FastAPI, Next.js, and an optional Neo4j MCP process if they exit unexpectedly.
- Adds a periodic local health monitor that re-runs the Docker/data-service startup path if containers or API health checks fail.
- Adds GitHub Release update checks and a desktop prompt when a newer installer is available.

### v1.0.2

- Adds macOS runtime support for the bundled Python virtual environment path.
- Adds macOS Electron Builder targets for DMG and ZIP outputs.
- Adds a GitHub Actions workflow that builds Intel and Apple Silicon macOS release assets on a macOS runner and uploads them to a release tag.

### v1.0.3

- Adds a Codex CLI task runner in the desktop control server and Agent tab.
- Adds Codexian-style Codex CLI discovery, Windows `codex.cmd` handling, task context files, and final-message capture.
- Adds signing and notarization guidance for macOS and Windows releases.

### v1.0.4

- Speeds up Windows installation by deferring Docker/Neo4j/data-service bootstrap from NSIS install time to first app launch.
- Opens the dashboard as soon as the web UI is ready while local graph services warm up in the background.
- Keeps an opt-in `OPENCRAB_RUN_INSTALL_BOOTSTRAP=1` path for managed installs that still want bootstrap during installation.

## Attribution

OpenCrab itself comes from [AlexAI-MCP/OpenCrab](https://github.com/AlexAI-MCP/OpenCrab). This fork focuses on installer, desktop runtime orchestration, OpenCrab MCP bridge assets, and public release packaging.
