const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080'
const DESKTOP_BASE = process.env.NEXT_PUBLIC_DESKTOP_CONTROL_URL || ''

function desktopBase() {
  if (DESKTOP_BASE) return DESKTOP_BASE
  if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
    return window.location.origin
  }
  return 'http://127.0.0.1:18273'
}

function headers(apiKey?: string) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) h.Authorization = `Bearer ${apiKey}`
  return h
}

export interface OcNode {
  id: string
  space: string
  node_type: string
  properties: Record<string, unknown>
  degree: number
}

export interface OcEdge {
  from_id: string
  to_id: string
  relation: string
  from_space: string
  to_space: string
}

export interface QueryResult {
  node_id: string | null
  score: number
  text: string | null
  metadata: Record<string, unknown>
}

export type SourceType = 'obsidian' | 'notion' | 'gdrive' | 'github'
export type IngestTarget = 'local' | 'cloud' | 'both'
export type IngestResearchDepth = 'quick' | 'standard' | 'deep' | 'exhaustive'
export type IngestResearchField =
  | 'subject'
  | 'resource'
  | 'evidence'
  | 'concept'
  | 'claim'
  | 'community'
  | 'outcome'
  | 'lever'
  | 'policy'

export interface DesktopStatus {
  ok: boolean
  mcpUrlConfigured: boolean
  mcpUrl: string
  mcpConnected?: boolean
  mcpToolsCount?: number
  mcpToolNames?: string[]
  mcpIngestAvailable?: boolean
  oauthPending?: boolean
  apiUrl?: string
  localMcpUrl?: string
  localApiKey?: string
}

export interface AgentAssetResult {
  label: string
  path?: string
  status?: string
}

export interface CodexStatus {
  ok: boolean
  available: boolean
  path: string
  version: string
  message: string
}

export interface CodexTaskResult {
  ok: boolean
  taskId: string
  status: 'starting' | 'running' | 'completed' | 'failed' | 'timed_out' | string
  phase: string
  startedAt: string
  updatedAt: string
  completedAt?: string
  taskFile: string
  outputFile: string
  cwd: string
  codexPath: string
  model: string
  reasoningEffort: string
  permissionMode: string
  ingestResearchDepth?: IngestResearchDepth | string
  ingestResearchFields?: string[]
  progress: string[]
  messages?: Array<{
    id: string
    at: string
    role: 'user' | 'system' | 'codex' | 'stderr' | 'final' | 'error' | string
    text: string
  }>
  finalMessage: string
  error?: string
  exitCode?: number | null
  packZipPath?: string
  packRecord?: GeneratedPack | null
}

export interface PackSettings {
  ok: boolean
  outputDir: string
  defaultOutputDir: string
  canceled?: boolean
}

export interface GeneratedPack {
  id: string
  taskId: string
  name: string
  zipPath: string
  outputDir: string
  workDir: string
  createdAt: string
  size: number
  fileCount: number
  status: string
  exists?: boolean
}

export interface LocalServicesStatus {
  ok: boolean
  api?: {
    ok: boolean
    status: number
    stores?: Record<string, unknown>
    error?: string
  }
  containers?: Record<string, {
    name: string
    running: boolean
    healthy: boolean
    status: string
    error?: string
  }>
  neo4j?: {
    browserUrl: string
    boltUrl: string
    username: string
  }
}

export interface UpdateStatus {
  ok: boolean
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseUrl: string
  releaseName?: string
  publishedAt?: string
  error?: string
  assets?: Array<{
    name: string
    size: number
    downloadUrl: string
  }>
}

export async function getStatus(): Promise<{ ok: boolean; version?: string; vectorCount?: number }> {
  try {
    const r = await fetch(`${BASE}/api/status`, { cache: 'no-store' })
    if (!r.ok) return { ok: false }
    const d = await r.json()
    return { ok: true, version: d.version }
  } catch {
    return { ok: false }
  }
}

export async function getDetailedStatus(apiKey: string): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`${BASE}/status`, { headers: headers(apiKey), cache: 'no-store' })
    if (!r.ok) return {}
    return r.json()
  } catch {
    return {}
  }
}

export async function query(apiKey: string, question: string, topK = 5) {
  const r = await fetch(`${BASE}/api/query`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ question, limit: topK }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail || 'Query failed')
  }
  return r.json()
}

export async function ingestSource(
  apiKey: string,
  sourceType: SourceType,
  text: string,
  opts: {
    sourceId?: string
    sourceUrl?: string
    query?: string
    maxItems?: number
  } = {},
) {
  const r = await fetch(`${BASE}/api/ingest`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      text,
      source_id: opts.sourceId,
      metadata: {
        source_type: sourceType,
        source_url: opts.sourceUrl,
        query: opts.query,
        max_items: opts.maxItems ?? 25,
      },
    }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail || 'Ingest failed')
  }
  return r.json()
}

export async function ingestCloudSource(
  sourceType: SourceType | string,
  text: string,
  opts: {
    sourceId?: string
    sourceUrl?: string
    title?: string
    metadata?: Record<string, unknown>
  } = {},
): Promise<{ ok: boolean; tool?: string; tools?: number; result?: Record<string, unknown> }> {
  const r = await fetch(`${desktopBase()}/desktop/cloud/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      sourceType,
      sourceId: opts.sourceId,
      sourceUrl: opts.sourceUrl,
      title: opts.title,
      metadata: opts.metadata ?? {},
    }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'OpenCrab cloud ingest failed')
  }
  return data
}

export async function startLocalServices(): Promise<LocalServicesStatus> {
  const r = await fetch(`${desktopBase()}/desktop/services/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'ingest' }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false || data.status?.ok === false) {
    throw new Error(data.error || 'Failed to start local Neo4j services')
  }
  return data.status
}

export async function restartLocalServices(input: {
  includeData?: boolean
  includeApi?: boolean
  includeMcp?: boolean
  includeWeb?: boolean
} = {}): Promise<LocalServicesStatus> {
  const r = await fetch(`${desktopBase()}/desktop/services/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false || data.status?.ok === false) {
    throw new Error(data.error || 'Failed to restart local services')
  }
  return data.status
}

export async function restartWebUi(): Promise<{ ok: boolean; url: string }> {
  const r = await fetch(`${desktopBase()}/desktop/web/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to restart web UI')
  }
  return data.status
}

export async function getLocalServicesStatus(): Promise<LocalServicesStatus> {
  const r = await fetch(`${desktopBase()}/desktop/services/status`, { cache: 'no-store' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to read local service status')
  }
  return data.status
}

export async function checkDesktopUpdate(): Promise<UpdateStatus> {
  const r = await fetch(`${desktopBase()}/desktop/update/check`, { cache: 'no-store' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to check for updates')
  }
  return data
}

export async function openDesktopRelease(url?: string): Promise<{ ok: boolean; url?: string }> {
  const r = await fetch(`${desktopBase()}/desktop/update/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to open release page')
  }
  return data
}

export async function openExternalUrl(url: string): Promise<{ ok: boolean; url?: string }> {
  const r = await fetch(`${desktopBase()}/desktop/open-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to open URL')
  }
  return data
}

export async function getNodes(apiKey: string): Promise<OcNode[]> {
  try {
    const r = await fetch(`${BASE}/api/nodes`, { headers: headers(apiKey), cache: 'no-store' })
    if (!r.ok) return []
    const d = await r.json()
    return d.nodes ?? []
  } catch {
    return []
  }
}

export async function getEdges(apiKey: string): Promise<OcEdge[]> {
  try {
    const r = await fetch(`${BASE}/api/edges`, { headers: headers(apiKey), cache: 'no-store' })
    if (!r.ok) return []
    const d = await r.json()
    return d.edges ?? []
  } catch {
    return []
  }
}

export async function getDesktopStatus(): Promise<DesktopStatus> {
  try {
    const r = await fetch(`${desktopBase()}/desktop/status`, { cache: 'no-store' })
    if (!r.ok) return { ok: false, mcpUrlConfigured: false, mcpUrl: '' }
    return r.json()
  } catch {
    return { ok: false, mcpUrlConfigured: false, mcpUrl: '' }
  }
}

export async function saveDesktopMcpUrl(url: string, apiKey = ''): Promise<{ mcpUrl: string; tools: number; mcpIngestAvailable?: boolean }> {
  const r = await fetch(`${desktopBase()}/desktop/mcp-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, apiKey }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to save MCP URL')
  }
  return { mcpUrl: data.mcpUrl, tools: data.tools, mcpIngestAvailable: data.mcpIngestAvailable }
}

export async function saveDesktopMcpUrlFromClipboard(apiKey = ''): Promise<{ mcpUrl: string; tools: number; mcpIngestAvailable?: boolean }> {
  const r = await fetch(`${desktopBase()}/desktop/mcp-url/clipboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to save MCP URL from clipboard')
  }
  return { mcpUrl: data.mcpUrl, tools: data.tools, mcpIngestAvailable: data.mcpIngestAvailable }
}

export async function startDesktopOAuth(): Promise<{ authUrl: string; mode?: string }> {
  const r = await fetch(`${desktopBase()}/desktop/oauth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to start OAuth')
  }
  return { authUrl: data.authUrl, mode: data.mode }
}

export async function installAgentAssets(target: string): Promise<AgentAssetResult[]> {
  const r = await fetch(`${desktopBase()}/desktop/agent-assets/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to install agent assets')
  }
  return data.results ?? []
}

export async function getCodexStatus(): Promise<CodexStatus> {
  try {
    const r = await fetch(`${desktopBase()}/desktop/codex/status`, { cache: 'no-store' })
    if (!r.ok) {
      return { ok: false, available: false, path: '', version: '', message: 'Codex status unavailable' }
    }
    return r.json()
  } catch {
    return { ok: false, available: false, path: '', version: '', message: 'Desktop control server unavailable' }
  }
}

export async function runCodexTask(input: {
  prompt: string
  model?: string
  reasoningEffort?: string
  permissionMode?: string
  ensureServices?: boolean
  useResearchSkill?: boolean
  useVisionSkill?: boolean
  packageOutput?: boolean
  packOutputDir?: string
  ingestResearchDepth?: IngestResearchDepth
  ingestResearchFields?: IngestResearchField[]
}): Promise<CodexTaskResult> {
  const r = await fetch(`${desktopBase()}/desktop/codex/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Codex task failed')
  }
  return data
}

export async function getCodexTask(taskId: string): Promise<CodexTaskResult> {
  const r = await fetch(`${desktopBase()}/desktop/codex/task?id=${encodeURIComponent(taskId)}`, { cache: 'no-store' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Codex task status unavailable')
  }
  return data
}

export async function getPackSettings(): Promise<PackSettings> {
  const r = await fetch(`${desktopBase()}/desktop/packs/settings`, { cache: 'no-store' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Pack settings unavailable')
  }
  return data
}

export async function savePackSettings(outputDir: string): Promise<PackSettings> {
  const r = await fetch(`${desktopBase()}/desktop/packs/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputDir }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to save pack output folder')
  }
  return data
}

export async function selectPackOutputDir(): Promise<PackSettings> {
  const r = await fetch(`${desktopBase()}/desktop/packs/select-output-dir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to select pack output folder')
  }
  return data
}

export async function getGeneratedPacks(): Promise<GeneratedPack[]> {
  const r = await fetch(`${desktopBase()}/desktop/packs`, { cache: 'no-store' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Generated pack list unavailable')
  }
  return data.packs ?? []
}

export async function openGeneratedPack(path: string): Promise<{ ok: boolean; path: string }> {
  const r = await fetch(`${desktopBase()}/desktop/packs/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to open generated pack')
  }
  return data
}

export async function ingestGeneratedPack(path: string, apiKey: string, target: IngestTarget = 'local'): Promise<{ ok: boolean; pack: GeneratedPack; result: Record<string, unknown> }> {
  const r = await fetch(`${desktopBase()}/desktop/packs/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, apiKey, target }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to ingest generated pack')
  }
  return data
}
