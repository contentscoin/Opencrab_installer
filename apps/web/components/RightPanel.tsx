'use client'

import { useEffect, useState } from 'react'
import type { AgentAssetResult, CodexStatus, CodexTaskResult, DesktopStatus, LocalServicesStatus, OcNode, SourceType } from '../lib/api'
import {
  getCodexStatus,
  getDesktopStatus,
  getLocalServicesStatus,
  ingestSource,
  installAgentAssets,
  query,
  runCodexTask,
  saveDesktopMcpUrl,
  startDesktopOAuth,
  startLocalServices,
} from '../lib/api'

const SPACES = ['subject', 'resource', 'concept', 'evidence', 'outcome', 'lever', 'policy', 'claim', 'community']
const SPACE_COLOR: Record<string, string> = {
  subject: '#f8c537',
  resource: '#83a598',
  concept: '#b8bb26',
  evidence: '#bdae93',
  outcome: '#fb4934',
  lever: '#d3869b',
  policy: '#fabd2f',
  claim: '#fe8019',
  community: '#8ec07c',
}

interface GraphControls {
  nodeSize: number
  linkStrength: number
  centerForce: number
  repelForce: number
  searchTerm: string
  hiddenSpaces: string[]
}

interface Props {
  selectedNode: OcNode | null
  controls: GraphControls
  onControlChange: (c: Partial<GraphControls>) => void
  apiKey: string
  onRefresh: () => void
}

export default function RightPanel({ selectedNode, controls, onControlChange, apiKey, onRefresh }: Props) {
  const [tab, setTab] = useState<'detail' | 'query' | 'ingest' | 'agent'>('detail')
  const [queryText, setQueryText] = useState('')
  const [queryResults, setQueryResults] = useState<{ node_id: string | null; score?: number; text?: string | null }[]>([])
  const [querying, setQuerying] = useState(false)
  const [ingestSourceType, setIngestSourceType] = useState<SourceType>('obsidian')
  const [ingestToken, setIngestToken] = useState('')
  const [ingestQuery, setIngestQuery] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [ingestPhase, setIngestPhase] = useState<'idle' | 'starting' | 'importing'>('idle')
  const [startingServices, setStartingServices] = useState(false)
  const [serviceStatus, setServiceStatus] = useState<LocalServicesStatus | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null)
  const [mcpUrlInput, setMcpUrlInput] = useState('')
  const [mcpApiKeyInput, setMcpApiKeyInput] = useState('')
  const [agentTarget, setAgentTarget] = useState('both')
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentResults, setAgentResults] = useState<AgentAssetResult[]>([])
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null)
  const [codexPrompt, setCodexPrompt] = useState('')
  const [codexModel, setCodexModel] = useState('gpt-5.5')
  const [codexReasoning, setCodexReasoning] = useState('high')
  const [codexPermission, setCodexPermission] = useState('auto')
  const [codexEnsureServices, setCodexEnsureServices] = useState(true)
  const [codexBusy, setCodexBusy] = useState(false)
  const [codexResult, setCodexResult] = useState<CodexTaskResult | null>(null)

  useEffect(() => {
    void refreshDesktopStatus()
    void refreshLocalServices()
    void refreshCodexStatus()
    const timer = setInterval(() => void refreshLocalServices(), 15000)
    return () => clearInterval(timer)
  }, [])

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function refreshDesktopStatus() {
    const status = await getDesktopStatus()
    setDesktopStatus(status)
  }

  async function refreshLocalServices() {
    try {
      const status = await getLocalServicesStatus()
      setServiceStatus(status)
    } catch {
      setServiceStatus(null)
    }
  }

  async function refreshCodexStatus() {
    const status = await getCodexStatus()
    setCodexStatus(status)
  }

  async function handleQuery() {
    if (!queryText.trim()) return
    setQuerying(true)
    try {
      const res = await query(apiKey, queryText)
      setQueryResults(res.results ?? res.hits ?? res.chunks ?? [])
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setQuerying(false)
    }
  }

  async function handleIngest() {
    if (!ingestToken.trim()) return
    setIngesting(true)
    setIngestPhase('starting')
    try {
      const status = await startLocalServices()
      setServiceStatus(status)
      setIngestPhase('importing')
      await ingestSource(apiKey, ingestSourceType, ingestToken, { query: ingestQuery || undefined })
      showToast('Ingest complete')
      setIngestToken('')
      setIngestQuery('')
      onRefresh()
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setIngesting(false)
      setIngestPhase('idle')
    }
  }

  async function handleStartServices() {
    setStartingServices(true)
    try {
      const status = await startLocalServices()
      setServiceStatus(status)
      showToast('Neo4j ready')
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setStartingServices(false)
    }
  }

  async function handleSaveMcpUrl() {
    if (!mcpUrlInput.trim()) return
    setAgentBusy(true)
    try {
      const result = await saveDesktopMcpUrl(mcpUrlInput.trim(), mcpApiKeyInput.trim())
      showToast(`MCP ready: ${result.tools} tools`)
      setMcpUrlInput('')
      setMcpApiKeyInput('')
      await refreshDesktopStatus()
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setAgentBusy(false)
    }
  }

  async function handleOAuthStart() {
    setAgentBusy(true)
    try {
      await startDesktopOAuth()
      showToast('OAuth browser opened')
      setTimeout(() => void refreshDesktopStatus(), 2500)
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setAgentBusy(false)
    }
  }

  async function handleInstallAgentAssets() {
    setAgentBusy(true)
    try {
      const results = await installAgentAssets(agentTarget)
      setAgentResults(results)
      showToast('Agent assets installed')
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setAgentBusy(false)
    }
  }

  async function handleRunCodexTask() {
    if (!codexPrompt.trim()) return
    setCodexBusy(true)
    setCodexResult(null)
    try {
      const result = await runCodexTask({
        prompt: codexPrompt.trim(),
        model: codexModel,
        reasoningEffort: codexReasoning,
        permissionMode: codexPermission,
        ensureServices: codexEnsureServices,
      })
      setCodexResult(result)
      showToast('Codex task complete')
      await refreshCodexStatus()
      await refreshLocalServices()
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setCodexBusy(false)
    }
  }

  function toggleSpace(space: string) {
    const hidden = controls.hiddenSpaces
    onControlChange({
      hiddenSpaces: hidden.includes(space) ? hidden.filter((item) => item !== space) : [...hidden, space],
    })
  }

  const slider = (label: string, key: keyof GraphControls, min: number, max: number, step: number) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#bdae93' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#f8c537', fontFamily: 'monospace' }}>
          {(controls[key] as number).toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={controls[key] as number}
        onChange={(event) => onControlChange({ [key]: parseFloat(event.target.value) })}
        style={{ width: '100%', accentColor: '#f8c537', cursor: 'pointer' }}
      />
    </div>
  )

  return (
    <div
      style={{
        width: 260,
        minWidth: 260,
        background: '#1a1a1a',
        borderLeft: '1px solid rgba(248,197,55,0.15)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(248,197,55,0.15)' }}>
        {(['detail', 'query', 'ingest', 'agent'] as const).map((item) => (
          <button
            key={item}
            className={`tab ${tab === item ? 'active' : ''}`}
            onClick={() => setTab(item)}
            style={{ flex: 1, fontSize: 11 }}
          >
            {item === 'detail' ? 'Node' : item === 'query' ? 'Query' : item === 'ingest' ? 'Ingest' : 'Agent'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {tab === 'detail' &&
          (selectedNode ? (
            <div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, letterSpacing: '0.06em' }}>NODE ID</div>
                <div className="mono" style={{ fontSize: 12, color: '#faf2d6', wordBreak: 'break-all' }}>
                  {selectedNode.id}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <span
                  className="badge"
                  style={{ background: `${SPACE_COLOR[selectedNode.space]}22`, color: SPACE_COLOR[selectedNode.space] }}
                >
                  {selectedNode.space}
                </span>
                <span className="badge">{selectedNode.node_type}</span>
                <span className="badge">{selectedNode.degree} links</span>
              </div>
              <hr className="gold-line" />
              <div style={{ fontSize: 10, color: '#555', marginBottom: 6, letterSpacing: '0.06em' }}>PROPERTIES</div>
              {Object.entries(selectedNode.properties).map(([key, value]) => (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '4px 0',
                    borderBottom: '1px solid #222',
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: '#7c6f64', minWidth: 80, flexShrink: 0 }}>{key}</span>
                  <span style={{ color: '#bdae93', wordBreak: 'break-all' }}>{String(value)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#555', fontSize: 12, marginTop: 20, textAlign: 'center' }}>
              Select a graph node to inspect its details.
            </div>
          ))}

        {tab === 'query' && (
          <div>
            <textarea
              className="input-dark"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Ask anything about the graph"
              style={{ marginBottom: 8, height: 80, fontSize: 12 }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.metaKey) handleQuery()
              }}
            />
            <button className="btn-gold" style={{ width: '100%', marginBottom: 12 }} onClick={handleQuery} disabled={querying}>
              {querying ? 'Searching...' : 'Run Query'}
            </button>
            <div>
              {queryResults.map((result, index) => (
                <div
                  key={index}
                  style={{
                    padding: '8px 10px',
                    marginBottom: 6,
                    background: '#1f1f1f',
                    borderRadius: 4,
                    border: '1px solid #2e2e2e',
                    fontSize: 11,
                  }}
                >
                  <div style={{ color: '#f8c537', marginBottom: 2 }}>{result.node_id ?? 'unknown'}</div>
                  <div style={{ color: '#bdae93', fontSize: 10, marginBottom: 4 }}>
                    {result.text ? `${result.text.slice(0, 100)}...` : 'No preview'}
                  </div>
                  <div style={{ color: '#555', fontSize: 10 }}>score: {result.score?.toFixed(3) ?? 'n/a'}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'ingest' && (
          <div>
            <div
              style={{
                border: '1px solid #2e2e2e',
                borderRadius: 4,
                padding: 8,
                marginBottom: 10,
                fontSize: 11,
                color: '#bdae93',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ color: serviceStatus?.ok ? '#8ec07c' : '#fb4934' }}>
                  Neo4j {serviceStatus?.ok ? 'ready' : 'not ready'}
                </span>
                <button
                  className="btn-gold"
                  style={{ fontSize: 11, padding: '4px 8px' }}
                  onClick={handleStartServices}
                  disabled={startingServices || ingesting}
                >
                  {startingServices ? 'Starting...' : 'Start'}
                </button>
              </div>
              <div className="mono" style={{ marginTop: 6, color: '#7c6f64', wordBreak: 'break-all' }}>
                {serviceStatus?.neo4j?.boltUrl ?? 'bolt://localhost:7688'}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#7c6f64', display: 'block', marginBottom: 4 }}>Source type</label>
              <select
                className="input-dark"
                value={ingestSourceType}
                onChange={(event) => setIngestSourceType(event.target.value as SourceType)}
                style={{ fontSize: 12 }}
              >
                <option value="obsidian">Obsidian</option>
                <option value="notion">Notion</option>
                <option value="gdrive">Google Drive</option>
                <option value="github">GitHub</option>
              </select>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#7c6f64', display: 'block', marginBottom: 4 }}>
                Access token {ingestSourceType === 'obsidian' && '(Obsidian Sync API key)'}
              </label>
              <input
                className="input-dark mono"
                value={ingestToken}
                onChange={(event) => setIngestToken(event.target.value)}
                placeholder="Enter API token"
                type="password"
                style={{ fontSize: 11 }}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#7c6f64', display: 'block', marginBottom: 4 }}>Search query (optional)</label>
              <input
                className="input-dark"
                value={ingestQuery}
                onChange={(event) => setIngestQuery(event.target.value)}
                placeholder="Filter imported data"
                style={{ fontSize: 11 }}
              />
            </div>
            <button
              className="btn-gold"
              style={{ width: '100%' }}
              onClick={handleIngest}
              disabled={ingesting || startingServices || !ingestToken.trim()}
            >
              {ingestPhase === 'starting' ? 'Starting Neo4j...' : ingestPhase === 'importing' ? 'Importing...' : 'Import Data'}
            </button>
            <div style={{ marginTop: 8, fontSize: 10, color: '#555', lineHeight: 1.5 }}>
              Connected source data is converted into GraphRAG-ready ontology records.
            </div>
          </div>
        )}

        {tab === 'agent' && (
          <div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 4, letterSpacing: '0.06em' }}>MCP ENDPOINT</div>
              <div style={{ color: desktopStatus?.mcpUrlConfigured ? '#8ec07c' : '#fb4934', fontSize: 11, wordBreak: 'break-all' }}>
                {desktopStatus?.mcpUrlConfigured ? desktopStatus.mcpUrl : 'not connected'}
              </div>
            </div>

            <button className="btn-gold" style={{ width: '100%', marginBottom: 8 }} onClick={handleOAuthStart} disabled={agentBusy}>
              Connect OAuth
            </button>

            <input
              className="input-dark mono"
              value={mcpUrlInput}
              onChange={(event) => setMcpUrlInput(event.target.value)}
              placeholder="Paste OpenCrab MCP URL"
              type="password"
              style={{ fontSize: 11, marginBottom: 6 }}
            />
            <input
              className="input-dark mono"
              value={mcpApiKeyInput}
              onChange={(event) => setMcpApiKeyInput(event.target.value)}
              placeholder="Bearer token (optional)"
              type="password"
              style={{ fontSize: 11, marginBottom: 8 }}
            />
            <button className="btn-gold" style={{ width: '100%', marginBottom: 14 }} onClick={handleSaveMcpUrl} disabled={agentBusy || !mcpUrlInput.trim()}>
              Save MCP URL
            </button>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#7c6f64', display: 'block', marginBottom: 4 }}>Install target</label>
              <select className="input-dark" value={agentTarget} onChange={(event) => setAgentTarget(event.target.value)} style={{ fontSize: 12 }}>
                <option value="both">User: Codex + Claude + Plugin</option>
                <option value="plugin">Codex plugin</option>
                <option value="codex">User: Codex</option>
                <option value="claude">User: Claude</option>
                <option value="project-both">Project: Codex + Claude</option>
                <option value="project">Project: Codex</option>
                <option value="project-claude">Project: Claude</option>
              </select>
            </div>
            <button
              className="btn-gold"
              style={{ width: '100%', marginBottom: 10 }}
              onClick={handleInstallAgentAssets}
              disabled={agentBusy || !desktopStatus?.mcpUrlConfigured}
            >
              {agentBusy ? 'Working...' : 'Install Agent Assets'}
            </button>

            {agentResults.length > 0 && (
              <div>
                {agentResults.map((result, index) => (
                  <div
                    key={`${result.label}-${index}`}
                    style={{
                      padding: '7px 8px',
                      marginBottom: 6,
                      background: '#1f1f1f',
                      borderRadius: 4,
                      border: '1px solid #2e2e2e',
                      fontSize: 10,
                    }}
                  >
                    <div style={{ color: '#f8c537', marginBottom: 2 }}>{result.label}</div>
                    <div className="mono" style={{ color: '#7c6f64', wordBreak: 'break-all' }}>
                      {result.path ?? result.status ?? 'done'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <hr className="gold-line" style={{ margin: '14px 0' }} />

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 4, letterSpacing: '0.06em' }}>CODEX CLI</div>
              <div style={{ color: codexStatus?.available ? '#8ec07c' : '#fb4934', fontSize: 11, wordBreak: 'break-all' }}>
                {codexStatus?.available ? codexStatus.version || codexStatus.path : codexStatus?.message || 'checking...'}
              </div>
            </div>

            <textarea
              className="input-dark"
              value={codexPrompt}
              onChange={(event) => setCodexPrompt(event.target.value)}
              placeholder="Ask Codex to create ingest files, inspect Neo4j, or prepare graph work"
              style={{ marginBottom: 8, height: 96, fontSize: 11 }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
              <select className="input-dark" value={codexModel} onChange={(event) => setCodexModel(event.target.value)} style={{ fontSize: 11 }}>
                <option value="gpt-5.5">gpt-5.5</option>
                <option value="gpt-5.4">gpt-5.4</option>
                <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                <option value="gpt-5.3-codex">gpt-5.3-codex</option>
              </select>
              <select
                className="input-dark"
                value={codexReasoning}
                onChange={(event) => setCodexReasoning(event.target.value)}
                style={{ fontSize: 11 }}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="xhigh">xhigh</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <select
                className="input-dark"
                value={codexPermission}
                onChange={(event) => setCodexPermission(event.target.value)}
                style={{ fontSize: 11 }}
              >
                <option value="review">review</option>
                <option value="auto">auto</option>
                <option value="yolo">yolo</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#7c6f64', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={codexEnsureServices}
                  onChange={(event) => setCodexEnsureServices(event.target.checked)}
                  style={{ accentColor: '#f8c537' }}
                />
                Neo4j
              </label>
            </div>

            <button
              className="btn-gold"
              style={{ width: '100%', marginBottom: 10 }}
              onClick={handleRunCodexTask}
              disabled={codexBusy || !codexPrompt.trim() || !codexStatus?.available}
            >
              {codexBusy ? 'Running Codex...' : 'Run Codex Task'}
            </button>

            {codexResult && (
              <div
                style={{
                  padding: '8px 9px',
                  background: '#1f1f1f',
                  borderRadius: 4,
                  border: '1px solid #2e2e2e',
                  fontSize: 10,
                }}
              >
                <div style={{ color: '#f8c537', marginBottom: 4 }}>Task {codexResult.taskId}</div>
                <div className="mono" style={{ color: '#7c6f64', wordBreak: 'break-all', marginBottom: 6 }}>
                  {codexResult.taskFile}
                </div>
                {codexResult.progress.slice(-5).map((line, index) => (
                  <div key={`${line}-${index}`} style={{ color: '#bdae93', marginBottom: 3 }}>
                    {line}
                  </div>
                ))}
                {codexResult.finalMessage && (
                  <div style={{ color: '#faf2d6', whiteSpace: 'pre-wrap', marginTop: 6 }}>
                    {codexResult.finalMessage.slice(0, 1200)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <hr className="gold-line" style={{ marginTop: 16 }} />
        <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', marginBottom: 10 }}>GRAPH SETTINGS</div>

        <div style={{ marginBottom: 12 }}>
          <input
            className="input-dark"
            value={controls.searchTerm}
            onChange={(event) => onControlChange({ searchTerm: event.target.value })}
            placeholder="Search nodes"
            style={{ fontSize: 11 }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#7c6f64', marginBottom: 6 }}>Space filters</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {SPACES.map((space) => {
              const hidden = controls.hiddenSpaces.includes(space)
              return (
                <button
                  key={space}
                  onClick={() => toggleSpace(space)}
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                    borderRadius: 10,
                    cursor: 'pointer',
                    background: hidden ? '#1f1f1f' : `${SPACE_COLOR[space]}22`,
                    color: hidden ? '#555' : SPACE_COLOR[space],
                    border: `1px solid ${hidden ? '#333' : SPACE_COLOR[space]}`,
                    textDecoration: hidden ? 'line-through' : 'none',
                  }}
                >
                  {space}
                </button>
              )
            })}
          </div>
        </div>

        {slider('Node size', 'nodeSize', 0.5, 3, 0.1)}
        {slider('Link strength', 'linkStrength', 0.1, 1, 0.05)}
        {slider('Center force', 'centerForce', 0.01, 1, 0.01)}
        {slider('Repel force', 'repelForce', 50, 500, 10)}
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}
