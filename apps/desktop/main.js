const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const treeKill = require('tree-kill');
const {
  registerProtocolHandler,
  startControlServer,
  userEnvPath,
} = require('./desktop-integrations');

const ENV_FILE_KEYS = new Set([
  'OPENCRAB_API_KEY',
  'OPENCRAB_TIER',
  'OPENCRAB_MCP_URL',
  'OPENCRAB_MCP_API_KEY',
  'OPENCRAB_OAUTH_AUTHORIZE_URL',
  'OPENCRAB_OAUTH_CLIENT_ID',
  'OPENCRAB_OAUTH_TOKEN_URL',
  'NEO4J_MCP_SERVER_COMMAND',
  'NEO4J_MCP_SERVER_ARGS',
  'NEO4J_MCP_SERVER_HEALTH_URL',
  'LOG_LEVEL',
]);

function getInitialRootDir() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
}

function shouldLoadEnvKey(key) {
  return ENV_FILE_KEYS.has(key) || key.startsWith('OPENCRAB_DESKTOP_');
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!shouldLoadEnvKey(key)) {
      continue;
    }

    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadEnvFiles(rootDir) {
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(rootDir, '.env'));
}

loadEnvFiles(getInitialRootDir());

const API_PORT = 8080;
const WEB_PORT = 3000;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const DATA_SERVICES = ['neo4j', 'mongodb', 'postgres', 'chromadb'];
const SERVICE_MONITOR_INTERVAL_MS = 30000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_RELEASE_API_URL = 'https://api.github.com/repos/contentscoin/Opencrab_installer/releases/latest';
const UPDATE_RELEASE_PAGE_URL = 'https://github.com/contentscoin/Opencrab_installer/releases/latest';
const LOADING_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCrab</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, Segoe UI, Arial, sans-serif; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b1020;
        color: #e8edf7;
      }
      main {
        width: min(520px, calc(100vw - 48px));
        display: grid;
        gap: 18px;
      }
      h1 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 0; }
      p { margin: 0; color: #aeb8ca; line-height: 1.5; }
      .bar {
        height: 6px;
        overflow: hidden;
        border-radius: 999px;
        background: #20283c;
      }
      .bar::before {
        content: "";
        display: block;
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: #69c3ff;
        animation: slide 1.25s ease-in-out infinite;
      }
      @keyframes slide {
        0% { transform: translateX(-110%); }
        100% { transform: translateX(260%); }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenCrab is starting</h1>
      <p>Starting Neo4j, the local API, and the desktop workspace. First launch can take a little longer while services warm up.</p>
      <div class="bar" aria-hidden="true"></div>
    </main>
  </body>
</html>`;

let mainWindow;
const processes = [];
const managedServices = new Map();
let activeServiceEnv = null;
let ensureLocalServicesPromise = null;
let isQuitting = false;
let serviceMonitorInterval = null;
let serviceMonitorRunning = false;
let updateCheckInterval = null;
let lastNotifiedUpdateVersion = '';

function getRootDir() {
  return getInitialRootDir();
}

function getPythonPath(rootDir) {
  return path.join(rootDir, '.venv', 'Scripts', 'python.exe');
}

function getDesktopPorts() {
  return {
    neo4jHttp: process.env.OPENCRAB_DESKTOP_NEO4J_HTTP_PORT || process.env.NEO4J_HTTP_HOST_PORT || '7475',
    neo4jBolt: process.env.OPENCRAB_DESKTOP_NEO4J_BOLT_PORT || process.env.NEO4J_BOLT_HOST_PORT || '7688',
    mongodb: process.env.OPENCRAB_DESKTOP_MONGODB_PORT || process.env.MONGODB_HOST_PORT || '27018',
    postgres: process.env.OPENCRAB_DESKTOP_POSTGRES_PORT || process.env.POSTGRES_HOST_PORT || '5433',
    chroma: process.env.OPENCRAB_DESKTOP_CHROMA_PORT || process.env.CHROMA_HOST_PORT || '8002',
  };
}

function getControlPort() {
  return Number(process.env.OPENCRAB_DESKTOP_CONTROL_PORT || '18273');
}

function buildServiceEnv(controlPort = getControlPort()) {
  const ports = getDesktopPorts();
  const localApiKey = process.env.OPENCRAB_API_KEY || 'local-opencrab-key';
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME: process.env.OPENCRAB_DESKTOP_COMPOSE_PROJECT_NAME || 'opencrab_local',
    STORAGE_MODE: 'docker',
    OPENCRAB_API_KEY: localApiKey,
    OPENCRAB_MCP_URL: process.env.OPENCRAB_MCP_URL || '',
    OPENCRAB_MCP_API_KEY: process.env.OPENCRAB_MCP_API_KEY || '',
    OPENCRAB_TIER: process.env.OPENCRAB_TIER || 'free',
    OPENCRAB_CORS_ORIGINS: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
    NEO4J_HTTP_HOST_PORT: ports.neo4jHttp,
    NEO4J_BOLT_HOST_PORT: ports.neo4jBolt,
    MONGODB_HOST_PORT: ports.mongodb,
    POSTGRES_HOST_PORT: ports.postgres,
    CHROMA_HOST_PORT: ports.chroma,
    NEO4J_URI: process.env.OPENCRAB_DESKTOP_NEO4J_URI || `bolt://localhost:${ports.neo4jBolt}`,
    NEO4J_USER: process.env.NEO4J_USER || 'neo4j',
    NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || 'opencrab',
    MONGODB_URI: process.env.OPENCRAB_DESKTOP_MONGODB_URI || `mongodb://root:opencrab@localhost:${ports.mongodb}/opencrab?authSource=admin`,
    MONGODB_DB: process.env.MONGODB_DB || 'opencrab',
    POSTGRES_URL: process.env.OPENCRAB_DESKTOP_POSTGRES_URL || `postgresql://opencrab:opencrab@localhost:${ports.postgres}/opencrab`,
    CHROMA_HOST: process.env.OPENCRAB_DESKTOP_CHROMA_HOST || 'localhost',
    CHROMA_PORT: ports.chroma,
    NEXT_PUBLIC_API_URL: API_URL,
    NEXT_PUBLIC_OPENCRAB_API_KEY: localApiKey,
    NEXT_PUBLIC_DESKTOP_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
  };
}

function log(name, message) {
  const line = `[${new Date().toISOString()}] [${name}] ${message}`;
  console.log(line);
  try {
    const baseDir = app.isReady()
      ? app.getPath('userData')
      : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'opencrab-desktop');
    fs.mkdirSync(baseDir, { recursive: true });
    fs.appendFileSync(path.join(baseDir, 'opencrab-desktop.log'), `${line}\n`, 'utf8');
  } catch {
    // File logging must never block app startup.
  }
}

const hasSingleInstanceLock = registerProtocolHandler(app, getInitialRootDir(), log, () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitCommandLine(value) {
  const matches = value.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) || [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ''));
}

function areStoresHealthy(data) {
  const stores = data?.stores || {};
  return ['graph', 'vector', 'docs', 'sql'].every((name) => {
    const status = stores[name];
    return status && status.available === true && status.healthy === true;
  });
}

function isMcpInfo(data) {
  return data && (data.name === 'opencrab' || data.status === 'ok' || typeof data.transport === 'string');
}

function redactMcpUrl(url) {
  return url.replace(/(\/api\/mcp\/)[^/?#]+/, '$1<token>');
}

function isManagedServiceRunning(serviceKey) {
  const entry = managedServices.get(serviceKey);
  return Boolean(entry?.proc && entry.proc.exitCode === null && !entry.proc.killed);
}

function scheduleManagedRestart(serviceKey, entry, code) {
  if (isQuitting || !entry?.restart) {
    return;
  }

  const uptimeMs = Date.now() - entry.startedAt;
  const restartCount = uptimeMs < 15000 ? entry.restartCount + 1 : 0;
  const delayMs = Math.min(60000, 3000 + restartCount * 5000);

  managedServices.set(serviceKey, { ...entry, proc: null, restartCount });
  log('Supervisor', `${entry.name} exited with code ${code}; restarting in ${Math.round(delayMs / 1000)}s`);

  setTimeout(async () => {
    if (isQuitting || isManagedServiceRunning(serviceKey)) {
      return;
    }

    if (entry.shouldSkipRestart && await entry.shouldSkipRestart()) {
      log('Supervisor', `${entry.name} restart skipped because service is already healthy`);
      return;
    }

    spawnManaged(entry.command, entry.args, entry.options, entry.name, {
      serviceKey,
      restart: true,
      restartCount,
      shouldSkipRestart: entry.shouldSkipRestart,
    });
  }, delayMs);
}

function spawnManaged(command, args, options, name, lifecycle = {}) {
  log(name, `starting: ${command} ${args.join(' ')}`);
  const proc = spawn(command, args, {
    shell: false,
    windowsHide: true,
    ...options,
  });

  processes.push(proc);
  const serviceKey = lifecycle.serviceKey || '';

  if (serviceKey) {
    managedServices.set(serviceKey, {
      command,
      args,
      options,
      name,
      proc,
      restart: lifecycle.restart === true,
      restartCount: lifecycle.restartCount || 0,
      shouldSkipRestart: lifecycle.shouldSkipRestart,
      startedAt: Date.now(),
    });
  }

  proc.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) log(name, text);
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) log(`${name} ERR`, text);
  });

  proc.on('close', (code) => {
    log(name, `exited with code ${code}`);
    if (serviceKey) {
      const entry = managedServices.get(serviceKey);
      if (entry?.proc === proc) {
        scheduleManagedRestart(serviceKey, entry, code);
      }
    }
  });

  return proc;
}

function runOnce(command, args, options, name) {
  return new Promise((resolve, reject) => {
    log(name, `running: ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      shell: true,
      windowsHide: true,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (text.trim()) log(name, text.trim());
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (text.trim()) log(`${name} ERR`, text.trim());
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${name} exited with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

function captureOnce(command, args, options) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: true,
      windowsHide: true,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      resolve({ code: -1, stdout, stderr: stderr || error.message });
    });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function waitForTcp(host, port, name, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1500);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });

    if (connected) {
      log(name, `ready on ${host}:${port}`);
      return;
    }

    await delay(1000);
  }

  throw new Error(`${name} did not become ready on ${host}:${port}`);
}

async function waitForJson(url, validate, name, timeoutMs = 120000, init = undefined, displayUrl = url) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};

      if (response.ok && validate(data)) {
        log(name, `ready: ${displayUrl}`);
        return data;
      }

      lastError = `${response.status} ${text.slice(0, 200)}`;
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }

    await delay(1000);
  }

  throw new Error(`${name} did not become ready at ${displayUrl}: ${lastError}`);
}

async function waitForContainerHealthy(containerName, name, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';

  while (Date.now() < deadline) {
    const result = await captureOnce(
      'docker',
      ['inspect', '--format={{.State.Health.Status}}', containerName],
      {},
    );
    lastStatus = (result.stdout || result.stderr || '').trim();

    if (result.code === 0 && lastStatus === 'healthy') {
      log(name, `container healthy: ${containerName}`);
      return;
    }

    await delay(2000);
  }

  throw new Error(`${name} container did not become healthy: ${lastStatus}`);
}

async function waitForNeo4jBolt(rootDir, env, timeoutMs = 180000) {
  const python = getPythonPath(rootDir);
  if (!fs.existsSync(python)) {
    log('Neo4j', `Python virtualenv not found for Bolt check: ${python}`);
    return;
  }

  const code = [
    'import os',
    'from neo4j import GraphDatabase',
    'driver = GraphDatabase.driver(os.environ["NEO4J_URI"], auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"]))',
    'driver.verify_connectivity()',
    'driver.close()',
  ].join('; ');
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    const result = await captureOnce(python, ['-c', code], { cwd: rootDir, env, shell: false });
    if (result.code === 0) {
      log('Neo4j', `Bolt ready at ${env.NEO4J_URI}`);
      return;
    }

    lastError = (result.stderr || result.stdout || '').trim();
    await delay(2000);
  }

  throw new Error(`Neo4j Bolt did not become ready: ${lastError}`);
}

async function waitForHttp(url, name, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        log(name, `ready: ${url}`);
        return;
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }

    await delay(1000);
  }

  throw new Error(`${name} did not become ready: ${lastError}`);
}

async function fetchWithTimeout(url, timeoutMs = 5000, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readApiStatus() {
  try {
    const response = await fetchWithTimeout(`${API_URL}/api/status`, 5000);
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    return {
      ok: response.ok && data.ok === true,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function isApiHealthy() {
  const status = await readApiStatus();
  return Boolean(status.ok && areStoresHealthy(status.data));
}

async function isWebHealthy() {
  try {
    const response = await fetchWithTimeout(`${WEB_URL}/dashboard`, 5000);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForExistingFastApi(timeoutMs = 15000) {
  try {
    await waitForJson(
      `${API_URL}/api/status`,
      (data) => data && data.ok === true && areStoresHealthy(data),
      'FastAPI',
      timeoutMs,
    );
    return true;
  } catch {
    return false;
  }
}

async function inspectContainer(name, env) {
  const result = await captureOnce('docker', ['inspect', name], { env });
  if (result.code !== 0) {
    return {
      name,
      running: false,
      healthy: false,
      status: 'missing',
      error: (result.stderr || result.stdout || '').trim(),
    };
  }

  try {
    const inspected = JSON.parse(result.stdout)[0];
    const state = inspected?.State || {};
    const healthStatus = state.Health?.Status || '';
    return {
      name,
      running: state.Running === true,
      healthy: healthStatus ? healthStatus === 'healthy' : state.Running === true,
      status: healthStatus || state.Status || 'unknown',
    };
  } catch (error) {
    return {
      name,
      running: false,
      healthy: false,
      status: 'unknown',
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function getLocalServicesStatus(env = activeServiceEnv || buildServiceEnv()) {
  const containerNames = {
    neo4j: 'opencrab-neo4j',
    mongodb: 'opencrab-mongodb',
    postgres: 'opencrab-postgres',
    chromadb: 'opencrab-chromadb',
  };
  const entries = await Promise.all(
    Object.entries(containerNames).map(async ([service, container]) => [
      service,
      await inspectContainer(container, env),
    ]),
  );
  const containers = Object.fromEntries(entries);
  const api = await readApiStatus();
  const containersHealthy = Object.values(containers).every((item) => item.running && item.healthy);
  const apiHealthy = Boolean(api.ok && areStoresHealthy(api.data));

  return {
    ok: containersHealthy && apiHealthy,
    api: {
      ok: apiHealthy,
      status: api.status,
      stores: api.data?.stores || {},
      error: api.error || '',
    },
    containers,
    neo4j: {
      browserUrl: `http://localhost:${env.NEO4J_HTTP_HOST_PORT}`,
      boltUrl: env.NEO4J_URI,
      username: env.NEO4J_USER,
    },
  };
}

async function startDockerServices(rootDir, env) {
  const args = ['compose', 'up', '-d', ...DATA_SERVICES];

  try {
    await runOnce('docker', args, { cwd: rootDir, env }, 'Docker Compose');
  } catch (error) {
    log('Docker Compose', `docker compose failed, trying docker-compose: ${error.message}`);
    await runOnce('docker-compose', ['up', '-d', ...DATA_SERVICES], { cwd: rootDir, env }, 'Docker Compose');
  }

  await Promise.all([
    waitForContainerHealthy('opencrab-neo4j', 'Neo4j'),
    waitForContainerHealthy('opencrab-mongodb', 'MongoDB'),
    waitForContainerHealthy('opencrab-postgres', 'PostgreSQL'),
    waitForContainerHealthy('opencrab-chromadb', 'ChromaDB'),
  ]);

  const dataServicePorts = [
    ['Neo4j', Number(env.NEO4J_BOLT_HOST_PORT)],
    ['MongoDB', Number(env.MONGODB_HOST_PORT)],
    ['PostgreSQL', Number(env.POSTGRES_HOST_PORT)],
    ['ChromaDB', Number(env.CHROMA_HOST_PORT)],
  ];

  await Promise.all(
    dataServicePorts.map(([name, port]) => waitForTcp('127.0.0.1', port, name)),
  );
  await waitForHttp(`http://127.0.0.1:${env.CHROMA_HOST_PORT}/api/v2/heartbeat`, 'ChromaDB heartbeat');
  await waitForNeo4jBolt(rootDir, env);
}

async function startFastApi(rootDir, env) {
  if (await isApiHealthy()) {
    log('FastAPI', 'already healthy');
    return;
  }

  if (isManagedServiceRunning('fastapi')) {
    log('FastAPI', 'process is already running; waiting for health');
    await waitForJson(
      `${API_URL}/api/status`,
      (data) => data && data.ok === true && areStoresHealthy(data),
      'FastAPI',
      60000,
    );
    return;
  }

  if (await waitForExistingFastApi()) {
    return;
  }

  const python = getPythonPath(rootDir);
  if (!fs.existsSync(python)) {
    throw new Error(`Python virtualenv not found: ${python}`);
  }

  spawnManaged(
    python,
    ['-m', 'uvicorn', 'apps.api.main:app', '--host', '127.0.0.1', '--port', String(API_PORT)],
    { cwd: rootDir, env },
    'FastAPI',
    {
      serviceKey: 'fastapi',
      restart: true,
      shouldSkipRestart: isApiHealthy,
    },
  );

  await waitForJson(
    `${API_URL}/api/status`,
    (data) => data && data.ok === true && areStoresHealthy(data),
    'FastAPI',
    180000,
  );
}

async function ensureLocalServices() {
  if (ensureLocalServicesPromise) {
    return ensureLocalServicesPromise;
  }

  ensureLocalServicesPromise = (async () => {
    const rootDir = getRootDir();
    if (!activeServiceEnv) {
      loadEnvFile(userEnvPath(app));
      loadEnvFile(path.join(rootDir, '.env.local'));
      activeServiceEnv = buildServiceEnv();
    }

    log('Local Services', 'ensuring Neo4j and data stores are running');
    await startDockerServices(rootDir, activeServiceEnv);
    await startFastApi(rootDir, activeServiceEnv);
    const status = await getLocalServicesStatus(activeServiceEnv);
    if (!status.ok) {
      throw new Error('Local services started, but one or more services are not healthy yet.');
    }
    log('Local Services', 'ready for ingest');
    return status;
  })().finally(() => {
    ensureLocalServicesPromise = null;
  });

  return ensureLocalServicesPromise;
}

async function startNext(rootDir, env) {
  if (await isWebHealthy()) {
    log('Next.js', 'already healthy');
    return;
  }

  if (isManagedServiceRunning('next')) {
    log('Next.js', 'process is already running; waiting for health');
    await waitForHttp(`${WEB_URL}/dashboard`, 'Next.js', 60000);
    return;
  }

  const webDir = path.join(rootDir, 'apps', 'web');
  if (app.isPackaged) {
    const nextBin = path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');
    const command = fs.existsSync(path.join(webDir, '.next')) ? 'start' : 'dev';
    spawnManaged(
      process.execPath,
      [nextBin, command, '--hostname', '127.0.0.1', '--port', String(WEB_PORT)],
      { cwd: webDir, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } },
      'Next.js',
      {
        serviceKey: 'next',
        restart: true,
        shouldSkipRestart: isWebHealthy,
      },
    );
  } else {
    spawnManaged(
      'npm',
      ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(WEB_PORT)],
      { cwd: webDir, env, shell: true },
      'Next.js',
      {
        serviceKey: 'next',
        restart: true,
        shouldSkipRestart: isWebHealthy,
      },
    );
  }

  await waitForHttp(`${WEB_URL}/dashboard`, 'Next.js', 180000);
}

async function startNeo4jMcpServer(rootDir, env) {
  const commandLine = (env.NEO4J_MCP_SERVER_COMMAND || '').trim();
  if (!commandLine) {
    log('Neo4j MCP', 'external neo4j-mcp-server is not configured; OpenCrab MCP bridge will be checked');
    return;
  }

  const commandParts = splitCommandLine(commandLine);
  const extraArgs = splitCommandLine(env.NEO4J_MCP_SERVER_ARGS || '');
  const command = commandParts.shift();
  if (!command) {
    log('Neo4j MCP', 'NEO4J_MCP_SERVER_COMMAND is empty after parsing');
    return;
  }

  spawnManaged(command, [...commandParts, ...extraArgs], { cwd: rootDir, env }, 'Neo4j MCP', {
    serviceKey: 'neo4j-mcp',
    restart: true,
  });

  if (env.NEO4J_MCP_SERVER_HEALTH_URL) {
    await waitForHttp(env.NEO4J_MCP_SERVER_HEALTH_URL, 'Neo4j MCP', 60000);
  }
}

async function checkMcpIntegration(env) {
  const mcpUrl = env.OPENCRAB_MCP_URL || `${API_URL}/mcp`;
  const displayUrl = redactMcpUrl(mcpUrl);
  const mcpHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  const authToken = env.OPENCRAB_MCP_API_KEY || (env.OPENCRAB_MCP_URL ? '' : env.OPENCRAB_API_KEY);

  if (authToken) {
    mcpHeaders.Authorization = `Bearer ${authToken}`;
  }

  const info = await waitForJson(mcpUrl, isMcpInfo, 'OpenCrab MCP', 30000, undefined, displayUrl);

  const tools = await waitForJson(
    mcpUrl,
    (data) => Array.isArray(data?.result?.tools) && data.result.tools.length > 0,
    'OpenCrab MCP tools',
    30000,
    {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    },
    displayUrl,
  );

  log('OpenCrab MCP', `endpoint ${displayUrl} exposes ${tools.result.tools.length} tools (${info.transport || info.version || 'local'})`);
}

async function runInitialIngest(rootDir, env) {
  if (env.OPENCRAB_DESKTOP_SEED === '0') {
    log('Initial ingest', 'skipped by OPENCRAB_DESKTOP_SEED=0');
    return;
  }

  const markerPath = path.join(app.getPath('userData'), 'initial-ingest.done');
  if (fs.existsSync(markerPath)) {
    log('Initial ingest', 'already completed');
    return;
  }

  const python = getPythonPath(rootDir);
  const seedScript = path.join(rootDir, 'scripts', 'seed_ontology.py');
  if (!fs.existsSync(seedScript)) {
    log('Initial ingest', `seed script not found: ${seedScript}`);
    return;
  }

  let output = '';
  await new Promise((resolve) => {
    const proc = spawn(python, [seedScript], {
      cwd: rootDir,
      env,
      shell: false,
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      log('Initial ingest', 'timed out; continuing startup');
      treeKill(proc.pid, 'SIGKILL');
      resolve();
    }, 180000);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (text.trim()) log('Initial ingest', text.trim());
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (text.trim()) log('Initial ingest ERR', text.trim());
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && output.includes('Seed complete')) {
        fs.mkdirSync(path.dirname(markerPath), { recursive: true });
        fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
        log('Initial ingest', 'completed');
      } else {
        log('Initial ingest', `finished without completion marker, code=${code}`);
      }
      resolve();
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      log('Initial ingest ERR', error.message);
      resolve();
    });
  });
}

async function startServices() {
  const rootDir = getRootDir();
  loadEnvFile(userEnvPath(app));
  loadEnvFile(path.join(rootDir, '.env.local'));

  activeServiceEnv = buildServiceEnv();
  const controlPort = await startControlServer({
    app,
    shell,
    rootDir,
    log,
    ensureLocalServices,
    getLocalServicesStatus: () => getLocalServicesStatus(activeServiceEnv),
  });
  activeServiceEnv.NEXT_PUBLIC_DESKTOP_CONTROL_URL = `http://127.0.0.1:${controlPort}`;

  const serviceEnv = activeServiceEnv;

  await ensureLocalServices();
  await startNeo4jMcpServer(rootDir, serviceEnv);
  await checkMcpIntegration(serviceEnv);
  await runInitialIngest(rootDir, serviceEnv);
  await startNext(rootDir, serviceEnv);
  startServiceMonitor();
}

function startServiceMonitor() {
  if (serviceMonitorInterval) {
    return;
  }

  serviceMonitorInterval = setInterval(async () => {
    if (serviceMonitorRunning || isQuitting || !activeServiceEnv) {
      return;
    }

    serviceMonitorRunning = true;
    try {
      const rootDir = getRootDir();
      const status = await getLocalServicesStatus(activeServiceEnv);
      if (!status.ok) {
        log('Supervisor', 'local service health check failed; ensuring services are running');
        await ensureLocalServices();
      }

      if (!(await isWebHealthy())) {
        log('Supervisor', 'web UI health check failed; restarting Next.js');
        await startNext(rootDir, activeServiceEnv);
      }
    } catch (error) {
      log('Supervisor ERR', error && error.message ? error.message : String(error));
    } finally {
      serviceMonitorRunning = false;
    }
  }, SERVICE_MONITOR_INTERVAL_MS);
}

function compareVersions(left, right) {
  const a = String(left || '').replace(/^v/i, '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right || '').replace(/^v/i, '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

async function checkForUpdates(showNoUpdate = false) {
  try {
    const response = await fetchWithTimeout(UPDATE_RELEASE_API_URL, 10000, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `OpenCrab Desktop/${app.getVersion()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub release check failed: ${response.status} ${response.statusText}`);
    }

    const release = await response.json();
    const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
    const currentVersion = app.getVersion();

    if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
      if (lastNotifiedUpdateVersion === latestVersion) {
        return;
      }
      lastNotifiedUpdateVersion = latestVersion;
      log('Updater', `new release available: ${latestVersion}`);
      const result = await dialog.showMessageBox(mainWindow || undefined, {
        type: 'info',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'OpenCrab update available',
        message: `OpenCrab ${latestVersion} is available.`,
        detail: `Current version: ${currentVersion}\nOpen the release page to download the latest installer.`,
      });

      if (result.response === 0) {
        await shell.openExternal(release.html_url || UPDATE_RELEASE_PAGE_URL);
      }
    } else if (showNoUpdate) {
      await dialog.showMessageBox(mainWindow || undefined, {
        type: 'info',
        title: 'OpenCrab is up to date',
        message: `OpenCrab ${currentVersion} is the latest available version.`,
      });
    }
  } catch (error) {
    log('Updater ERR', error && error.message ? error.message : String(error));
    if (showNoUpdate) {
      await dialog.showMessageBox(mainWindow || undefined, {
        type: 'warning',
        title: 'Update check failed',
        message: 'OpenCrab could not check for updates.',
        detail: error && error.message ? error.message : String(error),
      });
    }
  }
}

function startUpdateMonitor() {
  if (updateCheckInterval) {
    return;
  }

  setTimeout(() => checkForUpdates(false), 10000);
  updateCheckInterval = setInterval(() => checkForUpdates(false), UPDATE_CHECK_INTERVAL_MS);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function loadDashboard() {
  if (!mainWindow) {
    return;
  }

  mainWindow.loadURL(`${WEB_URL}/dashboard`);
}

function showStartupError(error) {
  if (!mainWindow) {
    return;
  }

  const message = String(error?.message || error || 'Unknown startup error');
  const html = LOADING_HTML.replace(
    'OpenCrab is starting',
    'OpenCrab could not start',
  ).replace(
    'Starting Neo4j, the local API, and the desktop workspace. First launch can take a little longer while services warm up.',
    `Startup failed. ${message.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character])}`,
  );
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

app.on('ready', async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  createWindow();

  try {
    await startServices();
    loadDashboard();
    startUpdateMonitor();
  } catch (error) {
    console.error('Failed to start OpenCrab Desktop:', error);
    showStartupError(error);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serviceMonitorInterval) {
    clearInterval(serviceMonitorInterval);
  }
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }
  log('Shutdown', 'cleaning up child processes');
  for (const proc of processes) {
    if (proc.pid) {
      try {
        treeKill(proc.pid, 'SIGKILL');
      } catch (error) {
        log('Shutdown ERR', `failed to kill ${proc.pid}: ${error.message}`);
      }
    }
  }
});
