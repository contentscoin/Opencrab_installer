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
- Dashboard `Ops` tab for manual service start/restart, web UI restart, and update checks
- Dashboard `opencrab.sh` tab for opening the cloud OpenCrab page inside the desktop workspace
- Static packaged web UI so installers no longer unpack the full Next.js `node_modules` tree
- Live Codex CLI task log in the Agent tab, including setup steps, Codex progress, stderr, and final response
- Bundled `insane-search` research skill/engine for ontology-pack source collection through Codex tasks
- Bundled Multilingual-CLIP/OpenCLIP vision skill for image dataset analysis and image-based pack generation
- Codex-generated packs are saved as ZIP files, registered in the Ingest queue, and can be stored in a user-selected folder

## Upstream LocalCrab Update

This fork tracks the public LocalCrab/OpenCrab core while preserving the desktop installer's Docker/Neo4j orchestration. The upstream LocalCrab positioning and pack-format documentation is available here:

- [LocalCrab factory workflow](docs/localcrab-factory-workflow.md)
- [LocalCrab and OpenCrab SaaS relationship](docs/localcrab-opencrab-relationship.md)
- [OpenCrab Pack v1](docs/opencrab-pack-v1.md)

The desktop installer keeps the local Neo4j stack because Codex-driven ingest and pack validation use it directly.

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

Desktop dashboard controls:

- `Local` tab: shows the local graph workspace.
- `opencrab.sh` tab: opens cloud login in the system browser and connects the desktop app by validating a pasted or copied MCP URL, because OAuth providers commonly block embedded Electron frames.
- `Ops` tab: checks local service health, starts services, restarts graph services, restarts the web UI, checks GitHub Releases for updates, and opens the latest release page.

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
- `OPENCRAB_PYTHON`
- `OPENCRAB_PACK_WORK_DIR`
- `OPENCRAB_PACK_OUTPUT_DIR`
- `OPENCRAB_INGEST_RESEARCH_DEPTH`
- `OPENCRAB_INGEST_RESEARCH_FIELDS`
- `OPENCRAB_RESEARCH_SKILL_DIR`
- `OPENCRAB_RESEARCH_ENGINE_DIR`
- `OPENCRAB_VISION_SKILL_DIR`
- `OPENCRAB_VISION_ENGINE_DIR`
- `OPENCRAB_VISION_MODEL`
- `OPENCRAB_VISION_ENCODER`
- `OPENCRAB_VISION_PRETRAINED`

The task file redacts OpenCrab MCP tokens, but the child Codex process receives the real endpoint through environment variables so it can use the configured MCP bridge.

For local desktop runs, OpenCrab Desktop supplies the local API key to the dashboard and defaults `OPENCRAB_TIER` to `pro` unless the user overrides it. This keeps local text ingest from being blocked by the cloud free-tier source limit.

The Ingest tab can import plain text/evidence into the local `/api/ingest` endpoint, the configured OpenCrab Cloud MCP endpoint, or both. The selected source type and source id are stored as metadata, and cloud ingest calls the MCP `opencrab_ingest_text`-style tool through `tools/call`.

When `Research` is checked in the Agent tab, the task context also points Codex at the bundled `insane-search` skill and Python research engine. Use it for ontology-pack research, source discovery, blocked-page fallback fetching, public evidence collection, and entity/claim/source extraction before writing ingest files. Research outputs should be saved under `codex-workspace/opencrab_data/research` in packaged installs.

When `Vision` is checked in the Agent tab, the task context points Codex at the bundled `multilingual-clip-vision` skill and helper engine. Use it for image datasets, product/package images, screenshots, multilingual visual labels, and image-based ontology packs. Vision outputs should be saved under `codex-workspace/opencrab_data/vision`. Heavy model dependencies are optional; install them only when needed with `python -m pip install multilingual-clip torch open_clip_torch pillow numpy transformers`, or set `OPENCRAB_INSTALL_VISION_DEPS=1` during installer builds to bundle them.

When `Zip` is checked in the Agent tab, Codex is instructed to write pack artifacts under `codex-workspace/opencrab_data/packs/<task-id>`. After Codex finishes, OpenCrab Desktop automatically creates a `.zip` file in the selected Pack ZIP folder and adds it to the Ingest tab's queue. From there, open the folder or run `Ingest ZIP`; it uses the current Ingest target setting, so generated packs can go to local Neo4j-backed storage, OpenCrab Cloud, or both.

Before running a Codex task, the Agent tab also has an `Ingest research` setting. Choose the depth (`Quick`, `Standard`, `Deep`, or `Exhaustive`), adjust the manual source/evidence/search/social counts, and select which ontology threads Codex should collect before building ingest files: subject, resource, evidence, concept, claim, community, outcome, lever, and policy. These settings are injected into the Codex task file and environment so generated packs include a research matrix, source metadata, confidence notes, and the selected data-value fields.

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

### v1.0.5

- Adds a dashboard `Ops` tab for checking updates, opening the release page, starting services, restarting graph services, and restarting the web UI.
- Adds desktop control API routes for manual update checks and restart actions.
- Adds a dashboard `opencrab.sh` tab so the cloud OpenCrab page is visible next to the local graph workspace.

### v1.0.6

- Speeds up Windows installation by packaging the dashboard as static web output instead of unpacking the full Next.js runtime and `node_modules`.
- Serves the packaged dashboard from the Electron main process and proxies `/desktop/*` calls to the active desktop control server.
- Keeps the development flow on Next.js dev server while using the lighter static server only for packaged builds.

### v1.0.7

- Changes Codex CLI tasks from a blocking request into a background task with a pollable status endpoint.
- Adds live Agent tab messages for user prompt, setup steps, Codex stdout/stderr progress, errors, and final response.
- Keeps recent Codex task history in the desktop control server so the UI can continue showing progress while a task is running.

### v1.0.8

- Bundles the `insane-search` skill and Python engine for ontology-pack research workflows.
- Adds a `Research` toggle to Codex tasks and injects the research skill path, engine path, Python command, and output directory into the task context.
- Installs the research skill into generated Codex/Claude/project/plugin assets alongside the OpenCrab MCP skill.
- Packages research runtime dependencies into the bundled Python environment before installer builds.

### v1.0.9

- Adds a `multilingual-clip-vision` skill and helper engine for image dataset analysis and image-based OpenCrab pack generation.
- Adds a `Vision` toggle to Codex tasks and injects the vision skill path, engine path, model defaults, Python command, and output directory into the task context.
- Installs the vision skill into generated Codex/Claude/project/plugin assets alongside the OpenCrab MCP and research skills.
- Keeps heavy vision dependencies optional by default, with `OPENCRAB_INSTALL_VISION_DEPS=1` available for builds that intentionally bundle them.

### v1.0.10

- Adds a selectable Pack ZIP folder for Codex-generated ontology packs.
- Adds automatic ZIP packaging for Codex pack staging directories after a task completes.
- Adds a generated pack Ingest queue in the Ingest tab with open-folder and `Ingest ZIP` actions.
- Persists generated pack records and ZIP output settings in the desktop user data directory.

### v1.0.11

- Adds an `Ingest research` control before Codex task execution.
- Lets users choose research depth from quick to exhaustive before creating packs.
- Lets users select required ontology threads for generated ingest values: subject, resource, evidence, concept, claim, community, outcome, lever, and policy.
- Injects the selected research scope into Codex task files and process environment so generated ZIP packs include clearer research matrices and evidence metadata.

### v1.0.12

- Fixes dashboard API-key auto-detection in packaged desktop builds by loading the local key from the desktop control server.
- Fixes the Ingest tab request body to match the FastAPI `/api/ingest` schema (`text`, `source_id`, and `metadata`).
- Changes the desktop default local tier to `pro` so local ingest is not blocked by the cloud free-tier one-source limit.

### v1.0.13

- Opens external HTTP/HTTPS links from the desktop shell in the system browser instead of an Electron child window.
- Adds explicit `Login in Browser` and `Open opencrab.sh` actions to the cloud tab.
- Keeps the embedded `opencrab.sh` view as a preview while avoiding OAuth login attempts inside the iframe.

### v1.0.14

- Pulls in the latest upstream LocalCrab pack/export docs and OpenCrab Pack v1 contract.
- Adds `opencrab export-neo4j-pack` for exporting a verified Neo4j graph snapshot into `neo4j/opencrab_ingest.jsonl`.
- Improves hybrid retrieval for Korean relation questions, BM25 anchors, graph expansion, and reranking consensus.
- Preserves the desktop installer's Docker/Neo4j orchestration instead of switching the fork to upstream local-only storage.

### v1.0.15

- Replaces the embedded `opencrab.sh` login frame with a browser-first cloud connection panel to avoid OAuth/403 iframe blocks.
- Changes the default login action to open `opencrab.sh` in the system browser instead of pretending the site supports desktop OAuth callbacks.
- Adds `Connect Copied MCP URL`, which reads an OpenCrab MCP URL from the clipboard, validates it with `tools/list`, and stores it for Codex/agent assets.
- Adds the same copied-MCP connection path to the Agent tab.

### v1.0.16

- Fixes Codex pack tasks for keyword-only requests such as `골프공` by routing them to keyword-first public research instead of the blocked-URL bypass engine.
- Adds a bundled `engine.keyword_research` helper for Wikipedia, Wikidata, and OpenAlex source discovery.
- Updates Codex task instructions so `insane-search` is only used with concrete URLs and never with placeholder values like `<URL>`.
- Improves Playwright fallback errors so missing browser dependencies do not dump Node module stack traces or trap the task in repeated retries.

### v1.0.17

- Adds a real OpenCrab Cloud ingest path through the configured MCP endpoint using `tools/call`.
- Shows MCP tool count and whether an ingest-capable tool is available in the Cloud and Agent panels.
- Adds an Ingest target selector: `Local + OpenCrab Cloud`, `Local only`, or `OpenCrab Cloud only`.
- Sends generated Codex ZIP packs to the selected ingest target, not only the local API.

### v1.0.18

- Makes the right dashboard panel resizable and persists the selected width.
- Adds explicit MCP retesting and clearer connection result messages.
- Expands ingest targets to Local API, Local MCP, OpenCrab Cloud MCP, and combined target flows.
- Raises research presets and adds manual source, evidence, search round, and social-source controls for Codex pack generation.
- Uses full desktop Codex access on Windows to avoid `CreateProcessWithLogonW failed: 1326` sandbox failures, while keeping the live task chat log.

### v1.0.19

- Names Codex-generated pack ZIP files from the user request instead of task ids.
- Stores a clean pack display name separately from the unique ZIP filename.
- Uses the pack display name as the ingest title and records it in pack metadata.

### v1.0.20

- Prepares a desktop-side keyword research seed before launching Codex so pack tasks are not blocked by Codex CLI shell execution on Windows.
- Enables Codex native web search for research tasks and instructs Codex to use prepared seed files instead of retrying failed shell setup commands.
- Collapses repeated Windows `CreateProcessWithLogonW failed: 1326` shell errors into a single readable progress message.
- Expands keyword research variants for Korean pack prompts such as `골프공 브랜드팩` and fixes Windows UTF-8 output for the research helper.

## Attribution

OpenCrab itself comes from [AlexAI-MCP/OpenCrab](https://github.com/AlexAI-MCP/OpenCrab). This fork focuses on installer, desktop runtime orchestration, OpenCrab MCP bridge assets, and public release packaging.

The bundled `insane-search` research skill and engine come from [fivetaku/insane-search](https://github.com/fivetaku/insane-search) under the MIT license, included here to support OpenCrab ontology-pack research workflows.

The image package workflow is based on [FreddeFrallan/Multilingual-CLIP](https://github.com/FreddeFrallan/Multilingual-CLIP), which is distributed under the MIT license, and uses compatible CLIP/OpenCLIP image encoders when the optional vision runtime is installed.
