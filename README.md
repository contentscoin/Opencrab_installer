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
- Initial seed/ingest bootstrap for local graph data
- Loading/error screen so startup progress is visible instead of a blank window

## Download

Installers are published on the GitHub Releases page:

[Download the latest release](https://github.com/contentscoin/Opencrab_installer/releases/latest)

Current Windows asset:

- `OpenCrab Setup 1.0.0.exe`

## Prerequisites

The Windows installer is designed to set up the local service stack, but Docker Desktop is still the runtime used for Neo4j and the other data stores.

Expected runtime:

- Windows 10/11
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

If Docker Desktop is missing, the installer bootstrap attempts to install/start it through `winget` where available. Some Windows machines still require Docker Desktop first-run approval or a restart.

## How To Use

1. Download `OpenCrab Setup 1.0.0.exe` from Releases.
2. Run the installer and wait until it fully completes. The bundled Python environment and web dependencies make first install noticeably large.
3. Launch OpenCrab from the Start Menu or desktop shortcut.
4. Wait for the startup screen to finish. The app starts Docker services, FastAPI, and the web UI.
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

## Developer Commands

Build the web app:

```powershell
npm --prefix apps\web run build
```

Build the Windows installer:

```powershell
npm --prefix apps\desktop run dist:win
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

## Attribution

OpenCrab itself comes from [AlexAI-MCP/OpenCrab](https://github.com/AlexAI-MCP/OpenCrab). This fork focuses on installer, desktop runtime orchestration, OpenCrab MCP bridge assets, and public release packaging.
