const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_CONTROL_PORT = 18273;
const OAUTH_PROTOCOL = 'opencrab';
const SERVER_NAME = 'opencrab';
const SKILL_NAME = 'opencrab-mcp';
const DEFAULT_CODEX_MODEL = 'gpt-5.5';
const DEFAULT_CODEX_REASONING = 'high';
const DEFAULT_CODEX_PERMISSION = 'auto';
const CODEX_TASK_TIMEOUT_MS = 30 * 60 * 1000;

let controlServer;
let pendingOAuth = null;

function userEnvPath(app) {
  return path.join(app.getPath('userData'), '.env.local');
}

function homeEnvPath() {
  return path.join(os.homedir(), '.opencrab', 'opencrab.env');
}

function rootEnvPath(rootDir) {
  return path.join(rootDir, '.env.local');
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function updateEnvFile(filePath, updates) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const lines = readText(filePath).split(/\r?\n/).filter((line, index, arr) => line || index < arr.length - 1);
  const seen = new Set();
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      return line;
    }
    const key = trimmed.slice(0, trimmed.indexOf('=')).trim();
    if (!Object.prototype.hasOwnProperty.call(updates, key)) {
      return line;
    }
    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      next.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(filePath, `${next.filter((line) => line !== undefined).join('\n').trim()}\n`, 'utf8');
}

function validateMcpUrlFormat(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MCP URL is not a valid URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('MCP URL must start with http:// or https://.');
  }

  return parsed.toString();
}

function redactMcpUrl(url) {
  return url.replace(/(\/api\/mcp\/)[^/?#]+/, '$1<token>');
}

function currentMcpUrl() {
  return (process.env.OPENCRAB_MCP_URL || '').trim();
}

async function testMcpUrl(url, apiKey = '') {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP tools/list failed with ${response.status}: ${text.slice(0, 240)}`);
  }

  const data = text ? JSON.parse(text) : {};
  const tools = data?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('MCP endpoint did not return tools.');
  }

  return tools;
}

async function saveMcpUrl(app, rootDir, value, apiKey = '') {
  const url = validateMcpUrlFormat(value);
  const tools = await testMcpUrl(url, apiKey);
  const updates = { OPENCRAB_MCP_URL: url };
  if (apiKey) {
    updates.OPENCRAB_MCP_API_KEY = apiKey;
  }

  updateEnvFile(userEnvPath(app), updates);
  updateEnvFile(homeEnvPath(), updates);
  if (!app.isPackaged) {
    updateEnvFile(rootEnvPath(rootDir), updates);
  }

  process.env.OPENCRAB_MCP_URL = url;
  if (apiKey) {
    process.env.OPENCRAB_MCP_API_KEY = apiKey;
  }

  return { url, tools };
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function oauthRedirectUri(controlPort) {
  return `${OAUTH_PROTOCOL}://oauth/callback`;
}

function buildOAuthUrl(controlPort) {
  const authorizeUrl = process.env.OPENCRAB_OAUTH_AUTHORIZE_URL || 'https://opencrab.sh/sign-in';
  const state = randomBase64Url(18);
  const verifier = randomBase64Url(48);
  const redirectUri = oauthRedirectUri(controlPort);
  pendingOAuth = {
    state,
    verifier,
    redirectUri,
    createdAt: Date.now(),
  };

  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', process.env.OPENCRAB_OAUTH_CLIENT_ID || 'opencrab-desktop');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', sha256Base64Url(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('desktop_callback', redirectUri);
  url.searchParams.set('loopback_callback', `http://127.0.0.1:${controlPort}/desktop/oauth/callback`);
  return url.toString();
}

function extractMcpUrl(payload) {
  return payload.mcp_url || payload.mcpUrl || payload.opencrab_mcp_url || payload.endpoint || payload.url || '';
}

async function exchangeOAuthCode(code) {
  const tokenUrl = process.env.OPENCRAB_OAUTH_TOKEN_URL || 'https://opencrab.sh/api/oauth/token';
  if (!pendingOAuth) {
    throw new Error('No pending OAuth flow exists.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.OPENCRAB_OAUTH_CLIENT_ID || 'opencrab-desktop',
    redirect_uri: pendingOAuth.redirectUri,
    code_verifier: pendingOAuth.verifier,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with ${response.status}: ${text.slice(0, 240)}`);
  }

  return text ? JSON.parse(text) : {};
}

async function handleOAuthCallback(app, rootDir, rawUrl) {
  const callbackUrl = new URL(rawUrl);
  const state = callbackUrl.searchParams.get('state') || '';
  if (pendingOAuth?.state && state && state !== pendingOAuth.state) {
    throw new Error('OAuth callback state did not match.');
  }

  let mcpUrl = extractMcpUrl(Object.fromEntries(callbackUrl.searchParams.entries()));
  const code = callbackUrl.searchParams.get('code');
  if (!mcpUrl && code) {
    const payload = await exchangeOAuthCode(code);
    mcpUrl = extractMcpUrl(payload);
  }

  if (!mcpUrl) {
    throw new Error('OAuth callback did not include an OpenCrab MCP URL.');
  }

  const result = await saveMcpUrl(app, rootDir, mcpUrl, callbackUrl.searchParams.get('api_key') || '');
  pendingOAuth = null;
  return result;
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function tomlString(value) {
  return JSON.stringify(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeManagedBlock(filePath, startMarker, endMarker, block) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const nextBlock = `${startMarker}\n${block.trimEnd()}\n${endMarker}`;

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${nextBlock}\n`, 'utf8');
    return;
  }

  const current = fs.readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
  if (pattern.test(current)) {
    fs.writeFileSync(filePath, current.replace(pattern, nextBlock), 'utf8');
    return;
  }

  const separator = current.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(filePath, `${current}${separator}${nextBlock}\n`, 'utf8');
}

function copyDirectory(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

function bridgeSource(rootDir) {
  return path.join(rootDir, 'scripts', 'opencrab_mcp_bridge.mjs');
}

function skillSource(rootDir) {
  return path.join(rootDir, 'skills', SKILL_NAME);
}

function prepareProjectMcp(rootDir) {
  const targetDir = path.join(rootDir, '.opencrab', 'mcp');
  fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, 'opencrab_mcp_bridge.mjs');
  fs.copyFileSync(bridgeSource(rootDir), targetFile);
  return targetFile;
}

function installProjectSkill(rootDir) {
  const target = path.join(rootDir, '.agents', 'skills', SKILL_NAME);
  copyDirectory(skillSource(rootDir), target);
  return target;
}

function writeCodexProjectConfig(rootDir, serverFile) {
  const configFile = path.join(rootDir, '.codex', 'config.toml');
  const serverPath = posixRelative(rootDir, serverFile);
  const block = `
[mcp_servers.opencrab]
command = "node"
args = [${tomlString(serverPath)}]
cwd = "."
env_vars = ["OPENCRAB_MCP_URL", "OPENCRAB_MCP_API_KEY"]
`;
  writeManagedBlock(configFile, '# BEGIN OpenCrab MCP', '# END OpenCrab MCP', block);
  return configFile;
}

function writeClaudeProjectConfig(rootDir, serverFile) {
  const configFile = path.join(rootDir, '.mcp.json');
  const serverPath = posixRelative(rootDir, serverFile);
  let config = {};

  if (fs.existsSync(configFile)) {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  }

  config.mcpServers = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {};
  config.mcpServers.opencrab = {
    command: 'node',
    args: [serverPath],
  };

  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configFile;
}

function prepareHomeMcp(rootDir) {
  const targetDir = path.join(os.homedir(), '.opencrab', 'mcp');
  fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, 'opencrab_mcp_bridge.mjs');
  fs.copyFileSync(bridgeSource(rootDir), targetFile);
  return targetFile;
}

function installGlobalSkill(rootDir, client) {
  const parent = client === 'claude'
    ? path.join(os.homedir(), '.claude', 'skills')
    : path.join(os.homedir(), '.agents', 'skills');
  const target = path.join(parent, SKILL_NAME);
  copyDirectory(skillSource(rootDir), target);
  return target;
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  return result.status === 0;
}

function isFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function listDirs(parent) {
  try {
    return fs.readdirSync(parent)
      .map((entry) => path.join(parent, entry))
      .filter((entry) => fs.statSync(entry).isDirectory());
  } catch {
    return [];
  }
}

function expandHome(input) {
  if (input === '~') return os.homedir();
  if (input.startsWith(`~${path.sep}`)) return path.join(os.homedir(), input.slice(2));
  return input;
}

function pathEntries(pathValue) {
  return (pathValue || process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultPathEntries() {
  const entries = process.platform === 'win32'
    ? [
        process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '',
        'C:\\Program Files\\nodejs',
      ]
    : [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
      ];
  return entries.filter(Boolean);
}

function mergePath(pathValue, extraEntries = []) {
  const seen = new Set();
  const merged = [];
  const add = (entry) => {
    const normalized = String(entry || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(normalized);
  };

  extraEntries.forEach(add);
  pathEntries(pathValue).forEach(add);
  defaultPathEntries().forEach(add);
  return merged.join(path.delimiter);
}

function parseEnvironmentVariables(input) {
  const env = {};
  for (const rawLine of String(input || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

function buildCodexProcessEnv(extraInput = '', overrides = {}) {
  const parsed = parseEnvironmentVariables(extraInput);
  const basePath = parsed.PATH || overrides.PATH || process.env.PATH || '';
  return {
    ...process.env,
    ...overrides,
    ...parsed,
    PATH: mergePath(basePath),
  };
}

function findCodexCli(customPath = '', pathValue = '') {
  const custom = String(customPath || '').trim();
  if (custom && isFile(expandHome(custom))) return expandHome(custom);

  const names = process.platform === 'win32'
    ? ['codex.exe', 'codex.cmd', 'codex.ps1', 'codex']
    : ['codex'];

  for (const entry of pathEntries(pathValue)) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (isFile(candidate)) return candidate;
    }
  }

  const home = os.homedir();
  const nvmBins = listDirs(path.join(home, '.nvm', 'versions', 'node'))
    .map((dir) => path.join(dir, 'bin', process.platform === 'win32' ? 'codex.cmd' : 'codex'));
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm', 'codex.cmd'),
        path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm', 'codex.exe'),
      ]
    : [
        '/opt/homebrew/bin/codex',
        '/usr/local/bin/codex',
        path.join(home, '.npm-global', 'bin', 'codex'),
        ...nvmBins,
      ];

  return candidates.find(isFile) || '';
}

function resolveCodexSpawnTarget(codexPath, args) {
  if (process.platform !== 'win32' || !/codex\.cmd$/i.test(codexPath)) {
    return { command: codexPath, args, shell: process.platform === 'win32' };
  }

  const codexJs = path.join(path.dirname(codexPath), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (!fs.existsSync(codexJs)) {
    return { command: codexPath, args, shell: true };
  }

  return { command: 'node', args: [codexJs, ...args], shell: false };
}

function normalizeCodexReasoning(value) {
  const allowed = new Set(['low', 'medium', 'high', 'xhigh']);
  const normalized = String(value || DEFAULT_CODEX_REASONING).trim().toLowerCase();
  return allowed.has(normalized) ? normalized : DEFAULT_CODEX_REASONING;
}

function normalizeCodexPermission(value) {
  const allowed = new Set(['review', 'auto', 'yolo']);
  const normalized = String(value || DEFAULT_CODEX_PERMISSION).trim().toLowerCase();
  return allowed.has(normalized) ? normalized : DEFAULT_CODEX_PERMISSION;
}

function normalizeCodexModel(value) {
  const normalized = String(value || DEFAULT_CODEX_MODEL).trim();
  return /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : DEFAULT_CODEX_MODEL;
}

function normalizeTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return CODEX_TASK_TIMEOUT_MS;
  return Math.max(10000, Math.min(parsed, 2 * 60 * 60 * 1000));
}

function redactSensitiveText(value) {
  let next = String(value || '');
  const secrets = [
    process.env.OPENCRAB_MCP_URL,
    process.env.OPENCRAB_MCP_API_KEY,
  ].filter(Boolean);
  for (const secret of secrets) {
    next = next.split(secret).join('<redacted>');
  }
  next = next.replace(/(\/api\/mcp\/)[^/?#\s"'<>)]*/g, '$1<token>');
  return next;
}

function formatProgressLine(line) {
  const cleaned = String(line || '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').trim();
  if (!cleaned) return '';
  if (/^user$/i.test(cleaned) || /^codex$/i.test(cleaned)) return '';
  if (/^tokens used\b/i.test(cleaned)) return cleaned;
  if (/^OpenAI Codex\b/i.test(cleaned)) return cleaned;
  if (/^workdir:/i.test(cleaned)) return cleaned;
  if (/^model:/i.test(cleaned)) return cleaned;
  if (/^approval:/i.test(cleaned)) return cleaned;
  if (/^sandbox:/i.test(cleaned)) return cleaned;
  if (/^session id:/i.test(cleaned)) return cleaned;
  if (/\bERROR\b/.test(cleaned)) return cleaned;
  if (/^(read|write|edit|apply|patch|search|run|exec|open|thinking|reasoning|update|create|delete|move|list|find|scan|inspect|build|test|verify|commit|tag|push|install|copy|generate|ingest)\b/i.test(cleaned)) return cleaned.slice(0, 240);
  if (/^(reading|writing|editing|applying|searching|running|executing|opening|creating|deleting|moving|listing|finding|scanning|inspecting|building|testing|verifying|committing|tagging|pushing|installing|copying|generating|ingesting)\b/i.test(cleaned)) return cleaned.slice(0, 240);
  if (/^(rg|sed|cat|ls|git|npm|node|tsc|mkdir|cp|mv|python|python3|gh|codex|docker)\b/i.test(cleaned)) return cleaned.slice(0, 240);
  if (/^[A-Za-z0-9_./~:-]+\.(ts|tsx|js|jsx|css|json|md|py|cypher|csv|yml|yaml):?\d*/.test(cleaned)) return cleaned.slice(0, 240);
  return '';
}

function getCodexWorkspace(app, rootDir, requestedCwd = '') {
  const cwd = String(requestedCwd || '').trim();
  if (cwd && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
    return cwd;
  }

  if (!app.isPackaged) {
    return rootDir;
  }

  const workspace = path.join(app.getPath('userData'), 'codex-workspace');
  fs.mkdirSync(path.join(workspace, 'opencrab_data', 'ingest'), { recursive: true });
  return workspace;
}

function getCodexStatus(rootDir, serviceEnv = {}) {
  const env = buildCodexProcessEnv('', serviceEnv);
  const codexPath = findCodexCli(process.env.OPENCRAB_CODEX_CLI_PATH || '', env.PATH);
  if (!codexPath) {
    return {
      ok: true,
      available: false,
      path: '',
      version: '',
      message: 'Codex CLI not found. Install @openai/codex and run codex login.',
    };
  }

  const result = spawnSync(codexPath, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env,
  });

  return {
    ok: true,
    available: result.status === 0,
    path: codexPath,
    version: (result.stdout || result.stderr || '').trim(),
    message: result.status === 0 ? 'Codex CLI ready' : redactSensitiveText(result.stderr || result.stdout || 'Codex CLI check failed'),
  };
}

function createCodexTaskFile(app, taskContext) {
  const taskId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBase64Url(4)}`;
  const taskDir = path.join(app.getPath('userData'), 'codex-tasks');
  fs.mkdirSync(taskDir, { recursive: true });
  const taskFile = path.join(taskDir, `opencrab-codex-task-${taskId}.md`);
  const content = buildCodexTaskContent({ ...taskContext, taskId, taskFile });
  fs.writeFileSync(taskFile, content, 'utf8');
  return { taskId, taskFile, content };
}

function buildCodexTaskContent({
  task,
  taskId,
  taskFile,
  rootDir,
  cwd,
  serviceStatus,
  serviceEnv,
  mcpUrl,
}) {
  const neo4j = serviceStatus?.neo4j || {};
  const localMcp = 'http://127.0.0.1:8080/mcp';
  const configuredMcp = mcpUrl || serviceEnv.OPENCRAB_MCP_URL || localMcp;
  const ingestDir = path.join(cwd, 'opencrab_data', 'ingest');

  return `# OpenCrab Codex Task

Task ID: ${taskId}
Task file: ${taskFile}
Workspace: ${cwd}
OpenCrab runtime root: ${rootDir}

## User Request

${task}

## Local OpenCrab Context

- FastAPI: http://127.0.0.1:8080
- Local MCP: ${localMcp}
- Configured MCP: ${configuredMcp ? redactMcpUrl(configuredMcp) : 'not configured'}
- Neo4j Browser: ${neo4j.browserUrl || serviceEnv.NEO4J_BROWSER_URL || 'http://localhost:7475'}
- Neo4j Bolt: ${neo4j.boltUrl || serviceEnv.NEO4J_URI || 'bolt://localhost:7688'}
- Neo4j user: ${neo4j.username || serviceEnv.NEO4J_USER || 'neo4j'}
- Neo4j password: ${serviceEnv.NEO4J_PASSWORD || 'opencrab'}
- Default ingest output directory: ${ingestDir}

## Operating Instructions

- You are Codex running from OpenCrab Desktop, modeled after the Codexian CLI workflow.
- Use the local OpenCrab services and Neo4j connection when the task involves graph, ontology, or ingest work.
- If creating ingest files, put them under the default ingest output directory unless the user explicitly names another path.
- Prefer structured files such as Markdown, JSONL, CSV, or Cypher with clear source metadata.
- Use the OpenCrab MCP endpoint through the configured environment variables when useful.
- Do not print raw MCP URLs, API tokens, or secrets in your final answer.
- Keep changes scoped to the user's request.
`;
}

async function runCodexTask({ app, rootDir, log, ensureLocalServices, getLocalServicesStatus, getServiceEnv, body }) {
  const task = String(body.prompt || body.task || '').trim();
  if (!task) {
    throw new Error('Codex task prompt is required.');
  }

  const serviceEnv = getServiceEnv ? { ...getServiceEnv() } : {};
  let serviceStatus = null;
  if (body.ensureServices !== false && ensureLocalServices) {
    serviceStatus = await ensureLocalServices();
  } else if (getLocalServicesStatus) {
    serviceStatus = await getLocalServicesStatus();
  }

  const env = buildCodexProcessEnv(String(body.environmentVariables || ''), serviceEnv);
  const codexPath = findCodexCli(String(body.codexPath || process.env.OPENCRAB_CODEX_CLI_PATH || ''), env.PATH);
  if (!codexPath) {
    throw new Error('Codex CLI not found. Install with `npm install -g @openai/codex`, then run `codex login`.');
  }

  env.PATH = mergePath(env.PATH, [path.dirname(codexPath)]);
  const cwd = getCodexWorkspace(app, rootDir, body.cwd);
  fs.mkdirSync(path.join(cwd, 'opencrab_data', 'ingest'), { recursive: true });

  const model = normalizeCodexModel(body.model || process.env.OPENCRAB_CODEX_MODEL);
  const reasoning = normalizeCodexReasoning(body.reasoningEffort || process.env.OPENCRAB_CODEX_REASONING);
  const permission = normalizeCodexPermission(body.permissionMode || process.env.OPENCRAB_CODEX_PERMISSION);
  const timeoutMs = normalizeTimeoutMs(body.timeoutMs);
  const { taskId, taskFile, content } = createCodexTaskFile(app, {
    task,
    rootDir,
    cwd,
    serviceStatus,
    serviceEnv: env,
    mcpUrl: currentMcpUrl(),
  });
  const outputPath = path.join(path.dirname(taskFile), `opencrab-codex-result-${taskId}.md`);

  env.OPENCRAB_CODEX_TASK_FILE = taskFile;
  env.OPENCRAB_CODEX_TASK_ID = taskId;
  env.OPENCRAB_CODEX_WORKSPACE = cwd;
  env.OPENCRAB_DESKTOP_ROOT = rootDir;

  const args = [
    'exec',
    '--color',
    'never',
    '--output-last-message',
    outputPath,
    '--skip-git-repo-check',
    '--cd',
    cwd,
    '--model',
    model,
    '--config',
    `model_reasoning_effort="${reasoning}"`,
  ];

  if (permission === 'yolo') {
    args.splice(1, 0, '--dangerously-bypass-approvals-and-sandbox');
  } else if (permission === 'auto') {
    args.splice(1, 0, '--full-auto');
  } else {
    args.splice(1, 0, '--sandbox', 'workspace-write');
  }

  const spawnTarget = resolveCodexSpawnTarget(codexPath, args);
  const progress = [];
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let lastProgress = '';
  let timedOut = false;

  log('Codex Task', `starting ${taskId} with ${path.basename(codexPath)} in ${cwd}`);

  await new Promise((resolve, reject) => {
    const child = spawn(spawnTarget.command, spawnTarget.args, {
      env,
      cwd,
      shell: spawnTarget.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Best effort only.
      }
    }, timeoutMs);

    child.stdin?.end(content);

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const formatted = formatProgressLine(line);
        if (formatted && formatted !== lastProgress) {
          lastProgress = formatted;
          progress.push(redactSensitiveText(formatted));
          if (progress.length > 120) progress.shift();
          log('Codex Task', redactSensitiveText(formatted));
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Codex task timed out after ${Math.round(timeoutMs / 1000)}s.`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`Codex exited with code ${code}: ${redactSensitiveText(stderrBuffer || stdoutBuffer).slice(0, 2000)}`));
        return;
      }
      resolve();
    });
  });

  const finalMessage = fs.existsSync(outputPath)
    ? redactSensitiveText(fs.readFileSync(outputPath, 'utf8').trim())
    : '';

  log('Codex Task', `completed ${taskId}`);

  return {
    ok: true,
    taskId,
    taskFile,
    outputFile: outputPath,
    cwd,
    codexPath,
    model,
    reasoningEffort: reasoning,
    permissionMode: permission,
    progress,
    finalMessage,
  };
}

function registerCodexMcp(serverFile) {
  if (!commandExists('codex')) {
    return 'codex command not found; wrote files only';
  }
  const result = spawnSync('codex', ['mcp', 'add', SERVER_NAME, '--', 'node', serverFile], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return result.status === 0 ? 'registered' : `registration failed: ${(result.stderr || result.stdout || '').trim()}`;
}

function registerClaudeMcp(serverFile) {
  if (!commandExists('claude')) {
    return 'claude command not found; wrote files only';
  }
  const result = spawnSync('claude', ['mcp', 'add', '--transport', 'stdio', SERVER_NAME, '--', 'node', serverFile], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return result.status === 0 ? 'registered' : `registration failed: ${(result.stderr || result.stdout || '').trim()}`;
}

function writePluginMarketplace(pluginDir) {
  const marketplaceFile = path.join(os.homedir(), '.agents', 'plugins', 'marketplace.json');
  fs.mkdirSync(path.dirname(marketplaceFile), { recursive: true });

  let marketplace = {
    name: 'local-opencrab',
    interface: { displayName: 'Local OpenCrab' },
    plugins: [],
  };
  if (fs.existsSync(marketplaceFile)) {
    marketplace = JSON.parse(fs.readFileSync(marketplaceFile, 'utf8'));
    marketplace.interface = marketplace.interface || { displayName: 'Local Plugins' };
    marketplace.plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  }

  const entry = {
    name: SERVER_NAME,
    source: {
      source: 'local',
      path: `./plugins/${SERVER_NAME}`,
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    },
    category: 'Productivity',
  };
  const existingIndex = marketplace.plugins.findIndex((item) => item.name === SERVER_NAME);
  if (existingIndex >= 0) marketplace.plugins[existingIndex] = entry;
  else marketplace.plugins.push(entry);

  fs.writeFileSync(marketplaceFile, `${JSON.stringify(marketplace, null, 2)}\n`, 'utf8');
  return marketplaceFile;
}

function createPlugin(rootDir) {
  const pluginDir = path.join(os.homedir(), 'plugins', SERVER_NAME);
  const manifestDir = path.join(pluginDir, '.codex-plugin');
  fs.rmSync(pluginDir, { recursive: true, force: true });
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'mcp'), { recursive: true });

  fs.copyFileSync(bridgeSource(rootDir), path.join(pluginDir, 'mcp', 'opencrab_mcp_bridge.mjs'));
  copyDirectory(skillSource(rootDir), path.join(pluginDir, 'skills', SKILL_NAME));

  fs.writeFileSync(path.join(pluginDir, '.mcp.json'), `${JSON.stringify({
    mcpServers: {
      opencrab: {
        command: 'node',
        args: ['./mcp/opencrab_mcp_bridge.mjs'],
      },
    },
  }, null, 2)}\n`, 'utf8');

  fs.writeFileSync(path.join(manifestDir, 'plugin.json'), `${JSON.stringify({
    name: SERVER_NAME,
    version: '1.0.0',
    description: 'OpenCrab ontology GraphRAG MCP tools and agent skill.',
    author: {
      name: 'OpenCrab',
      email: 'shineyw21@gmail.com',
      url: 'https://opencrab.sh/',
    },
    homepage: 'https://opencrab.sh/',
    repository: 'https://github.com/reallygood83/opencrab',
    license: 'MIT',
    keywords: ['opencrab', 'mcp', 'ontology', 'graphrag', 'skills'],
    skills: './skills/',
    mcpServers: './.mcp.json',
    interface: {
      displayName: 'OpenCrab',
      shortDescription: 'Ontology GraphRAG through your OpenCrab MCP URL',
      longDescription: 'Connect Codex to OpenCrab ontology graph search, document evidence, marketplace packs, workflows, and text ingest through a configured MCP endpoint.',
      developerName: 'OpenCrab',
      category: 'Productivity',
      capabilities: ['Interactive', 'Write'],
      websiteURL: 'https://opencrab.sh/',
      privacyPolicyURL: 'https://opencrab.sh/privacy',
      termsOfServiceURL: 'https://opencrab.sh/terms',
      defaultPrompt: [
        'Search my OpenCrab graph for relevant evidence.',
        'Run an OpenCrab workflow for this task.',
        'Ingest this text into OpenCrab.',
      ],
      brandColor: '#F8C537',
      screenshots: [],
    },
  }, null, 2)}\n`, 'utf8');

  return {
    pluginDir,
    marketplaceFile: writePluginMarketplace(pluginDir),
  };
}

function installAgentAssets(app, rootDir, target = 'project-both') {
  const mcpUrl = currentMcpUrl();
  if (!mcpUrl) {
    throw new Error('OPENCRAB_MCP_URL is not configured.');
  }

  updateEnvFile(homeEnvPath(), { OPENCRAB_MCP_URL: mcpUrl });

  const results = [];
  if (target === 'project' || target === 'project-both') {
    const serverFile = prepareProjectMcp(rootDir);
    results.push({ label: 'Project MCP bridge', path: serverFile });
    results.push({ label: 'Project Codex config', path: writeCodexProjectConfig(rootDir, serverFile) });
    results.push({ label: 'Project skill', path: installProjectSkill(rootDir) });
  }

  if (target === 'project-claude' || target === 'project-both') {
    const serverFile = path.join(rootDir, '.opencrab', 'mcp', 'opencrab_mcp_bridge.mjs');
    if (!fs.existsSync(serverFile)) prepareProjectMcp(rootDir);
    results.push({ label: 'Project Claude MCP config', path: writeClaudeProjectConfig(rootDir, serverFile) });
  }

  if (target === 'codex' || target === 'both') {
    const serverFile = prepareHomeMcp(rootDir);
    results.push({ label: 'Codex skill', path: installGlobalSkill(rootDir, 'codex') });
    results.push({ label: 'Codex MCP', status: registerCodexMcp(serverFile), path: serverFile });
  }

  if (target === 'claude' || target === 'both') {
    const serverFile = prepareHomeMcp(rootDir);
    results.push({ label: 'Claude skill', path: installGlobalSkill(rootDir, 'claude') });
    results.push({ label: 'Claude MCP', status: registerClaudeMcp(serverFile), path: serverFile });
  }

  if (target === 'plugin' || target === 'both') {
    const plugin = createPlugin(rootDir);
    results.push({ label: 'Codex plugin', path: plugin.pluginDir });
    results.push({ label: 'Codex plugin marketplace', path: plugin.marketplaceFile });
  }

  return results;
}

function previewAgentAssets(rootDir) {
  return {
    mcpUrlConfigured: Boolean(currentMcpUrl()),
    mcpUrl: currentMcpUrl() ? redactMcpUrl(currentMcpUrl()) : '',
    project: {
      skill: path.join(rootDir, '.agents', 'skills', SKILL_NAME),
      codexConfig: path.join(rootDir, '.codex', 'config.toml'),
      claudeConfig: path.join(rootDir, '.mcp.json'),
      bridge: path.join(rootDir, '.opencrab', 'mcp', 'opencrab_mcp_bridge.mjs'),
    },
    user: {
      env: homeEnvPath(),
      bridge: path.join(os.homedir(), '.opencrab', 'mcp', 'opencrab_mcp_bridge.mjs'),
      codexSkill: path.join(os.homedir(), '.agents', 'skills', SKILL_NAME),
      claudeSkill: path.join(os.homedir(), '.claude', 'skills', SKILL_NAME),
      plugin: path.join(os.homedir(), 'plugins', SERVER_NAME),
      marketplace: path.join(os.homedir(), '.agents', 'plugins', 'marketplace.json'),
    },
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function createControlHandler({
  app,
  shell,
  rootDir,
  log,
  ensureLocalServices,
  getLocalServicesStatus,
  getServiceEnv,
  restartLocalServices,
  restartWebUi,
  checkForUpdates,
  openReleasePage,
  getPort,
}) {
  return async (request, response) => {
    if (request.method === 'OPTIONS') {
      sendJson(response, 200, { ok: true });
      return;
    }

    try {
      const url = new URL(request.url || '/', `http://127.0.0.1:${getPort()}`);
      if (request.method === 'GET' && url.pathname === '/desktop/status') {
        const configuredUrl = currentMcpUrl();
        sendJson(response, 200, {
          ok: true,
          mcpUrlConfigured: Boolean(configuredUrl),
          mcpUrl: configuredUrl ? redactMcpUrl(configuredUrl) : '',
          oauthPending: Boolean(pendingOAuth),
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/desktop/agent-assets/preview') {
        sendJson(response, 200, { ok: true, preview: previewAgentAssets(rootDir) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/desktop/services/status') {
        const status = getLocalServicesStatus ? await getLocalServicesStatus() : { ok: false };
        sendJson(response, 200, { ok: true, status });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/desktop/codex/status') {
        sendJson(response, 200, getCodexStatus(rootDir, getServiceEnv ? getServiceEnv() : {}));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/desktop/update/check') {
        const status = checkForUpdates ? await checkForUpdates() : { ok: false, error: 'Update checker is not available.' };
        sendJson(response, status.ok === false ? 500 : 200, status);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/desktop/oauth/callback') {
        const result = await handleOAuthCallback(app, rootDir, url.toString());
        sendJson(response, 200, { ok: true, mcpUrl: redactMcpUrl(result.url), tools: result.tools.length });
        return;
      }

      const body = await readJsonBody(request);

      if (request.method === 'POST' && url.pathname === '/desktop/mcp-url') {
        const result = await saveMcpUrl(app, rootDir, String(body.url || ''), String(body.apiKey || ''));
        sendJson(response, 200, { ok: true, mcpUrl: redactMcpUrl(result.url), tools: result.tools.length });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/desktop/oauth/start') {
        const authUrl = buildOAuthUrl(getPort());
        await shell.openExternal(authUrl);
        sendJson(response, 200, { ok: true, authUrl });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/desktop/services/start') {
        const status = ensureLocalServices ? await ensureLocalServices() : { ok: false };
        sendJson(response, 200, { ok: true, status });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/desktop/services/restart') {
        if (!restartLocalServices) {
          sendJson(response, 500, { ok: false, error: 'Service restart is not available.' });
          return;
        }
        const status = await restartLocalServices({
          includeData: body.includeData !== false,
          includeApi: body.includeApi !== false,
          includeMcp: body.includeMcp !== false,
          includeWeb: body.includeWeb === true,
        });
        sendJson(response, 200, { ok: true, status });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/desktop/web/restart') {
        if (!restartWebUi) {
          sendJson(response, 500, { ok: false, error: 'Web UI restart is not available.' });
          return;
        }
        const status = await restartWebUi();
        sendJson(response, 200, { ok: true, status });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/desktop/update/open') {
        const result = openReleasePage
          ? await openReleasePage(String(body.url || ''))
          : await shell.openExternal(String(body.url || 'https://github.com/contentscoin/Opencrab_installer/releases/latest')).then(() => ({ ok: true }));
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/desktop/agent-assets/install') {
        const results = installAgentAssets(app, rootDir, String(body.target || 'project-both'));
        sendJson(response, 200, { ok: true, results });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/desktop/codex/task') {
        const result = await runCodexTask({
          app,
          rootDir,
          log,
          ensureLocalServices,
          getLocalServicesStatus,
          getServiceEnv,
          body,
        });
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      log('Desktop Control ERR', message);
      sendJson(response, 500, { ok: false, error: message });
    }
  };
}

function startControlServer({
  app,
  shell,
  rootDir,
  log,
  ensureLocalServices,
  getLocalServicesStatus,
  getServiceEnv,
  restartLocalServices,
  restartWebUi,
  checkForUpdates,
  openReleasePage,
}) {
  if (controlServer) {
    return Promise.resolve(controlServer.address()?.port || DEFAULT_CONTROL_PORT);
  }

  const basePort = Number(process.env.OPENCRAB_DESKTOP_CONTROL_PORT || DEFAULT_CONTROL_PORT);
  const maxAttempts = 20;
  let activePort = basePort;

  return new Promise((resolve, reject) => {
    const tryListen = (port, attempt) => {
      activePort = port;
      const server = http.createServer(createControlHandler({
        app,
        shell,
        rootDir,
        log,
        ensureLocalServices,
        getLocalServicesStatus,
        getServiceEnv,
        restartLocalServices,
        restartWebUi,
        checkForUpdates,
        openReleasePage,
        getPort: () => activePort,
      }));

      server.once('error', (error) => {
        if (error && error.code === 'EADDRINUSE' && attempt < maxAttempts - 1) {
          log('Desktop Control', `port ${port} is already in use; trying ${port + 1}`);
          try {
            server.close(() => tryListen(port + 1, attempt + 1));
          } catch {
            tryListen(port + 1, attempt + 1);
          }
          return;
        }
        reject(error);
      });

      server.listen(port, '127.0.0.1', () => {
        controlServer = server;
        log('Desktop Control', `ready on http://127.0.0.1:${port}`);
        resolve(port);
      });
    };

    tryListen(basePort, 0);
  });
}

function registerProtocolHandler(app, rootDir, log, focusWindow) {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(OAUTH_PROTOCOL, process.execPath, [path.join(rootDir, 'apps', 'desktop', 'main.js')]);
  } else {
    app.setAsDefaultProtocolClient(OAUTH_PROTOCOL);
  }

  const handleUrl = (rawUrl) => {
    if (!rawUrl || !rawUrl.startsWith(`${OAUTH_PROTOCOL}://`)) return;
    handleOAuthCallback(app, rootDir, rawUrl)
      .then((result) => log('OAuth', `connected ${redactMcpUrl(result.url)} (${result.tools.length} tools)`))
      .catch((error) => log('OAuth ERR', error && error.message ? error.message : String(error)));
  };

  app.on('open-url', (event, rawUrl) => {
    event.preventDefault();
    handleUrl(rawUrl);
  });

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    log('Single Instance', 'another OpenCrab instance is already running; exiting this instance');
    app.quit();
    return false;
  }

  if (gotLock) {
    app.on('second-instance', (_event, argv) => {
      const callbackUrl = argv.find((item) => item.startsWith(`${OAUTH_PROTOCOL}://`));
      handleUrl(callbackUrl);
      if (focusWindow) {
        focusWindow();
      }
    });
  }

  process.argv.forEach(handleUrl);
  return true;
}

module.exports = {
  homeEnvPath,
  getCodexStatus,
  previewAgentAssets,
  redactMcpUrl,
  registerProtocolHandler,
  runCodexTask,
  saveMcpUrl,
  startControlServer,
  testMcpUrl,
  userEnvPath,
};
