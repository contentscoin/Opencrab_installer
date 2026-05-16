const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080'
const DESKTOP_BASE = process.env.NEXT_PUBLIC_DESKTOP_CONTROL_URL || 'http://127.0.0.1:18273'

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

export interface DesktopStatus {
  ok: boolean
  mcpUrlConfigured: boolean
  mcpUrl: string
  oauthPending?: boolean
}

export interface AgentAssetResult {
  label: string
  path?: string
  status?: string
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
  accessToken: string,
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
      source_type: sourceType,
      access_token: accessToken,
      source_id: opts.sourceId,
      source_url: opts.sourceUrl,
      query: opts.query,
      max_items: opts.maxItems ?? 25,
    }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail || 'Ingest failed')
  }
  return r.json()
}

export async function startLocalServices(): Promise<LocalServicesStatus> {
  const r = await fetch(`${DESKTOP_BASE}/desktop/services/start`, {
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

export async function getLocalServicesStatus(): Promise<LocalServicesStatus> {
  const r = await fetch(`${DESKTOP_BASE}/desktop/services/status`, { cache: 'no-store' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to read local service status')
  }
  return data.status
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
    const r = await fetch(`${DESKTOP_BASE}/desktop/status`, { cache: 'no-store' })
    if (!r.ok) return { ok: false, mcpUrlConfigured: false, mcpUrl: '' }
    return r.json()
  } catch {
    return { ok: false, mcpUrlConfigured: false, mcpUrl: '' }
  }
}

export async function saveDesktopMcpUrl(url: string, apiKey = ''): Promise<{ mcpUrl: string; tools: number }> {
  const r = await fetch(`${DESKTOP_BASE}/desktop/mcp-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, apiKey }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to save MCP URL')
  }
  return { mcpUrl: data.mcpUrl, tools: data.tools }
}

export async function startDesktopOAuth(): Promise<{ authUrl: string }> {
  const r = await fetch(`${DESKTOP_BASE}/desktop/oauth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to start OAuth')
  }
  return { authUrl: data.authUrl }
}

export async function installAgentAssets(target: string): Promise<AgentAssetResult[]> {
  const r = await fetch(`${DESKTOP_BASE}/desktop/agent-assets/install`, {
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
