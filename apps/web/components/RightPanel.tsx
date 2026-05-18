'use client'

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { AgentAssetResult, CodexStatus, CodexTaskResult, DesktopStatus, GeneratedPack, IngestResearchDepth, IngestResearchField, IngestTarget, LocalServicesStatus, OcNode, SourceType, UpdateStatus } from '../lib/api'
import {
  checkDesktopUpdate,
  getGeneratedPacks,
  getCodexTask,
  getCodexStatus,
  getDesktopStatus,
  getLocalServicesStatus,
  getPackSettings,
  ingestDesktopSource,
  ingestGeneratedPack,
  installAgentAssets,
  openDockerInstall,
  openGeneratedPack,
  openDesktopRelease,
  query,
  restartLocalServices,
  restartWebUi,
  runCodexTask,
  saveDesktopMcpUrl,
  saveDesktopMcpUrlFromClipboard,
  savePackSettings,
  selectPackOutputDir,
  setDesktopStorageMode,
  startDesktopOAuth,
  startLocalServices,
  testDesktopMcpConnection,
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
const INGEST_RESEARCH_FIELD_OPTIONS: Array<{ id: IngestResearchField; label: string; prompt: string }> = [
  { id: 'subject', label: 'Subject', prompt: 'Who or what is this about?' },
  { id: 'resource', label: 'Resource', prompt: 'What original sources support this?' },
  { id: 'evidence', label: 'Evidence', prompt: 'What concrete facts or observations exist?' },
  { id: 'concept', label: 'Concept', prompt: 'What core concepts define this domain?' },
  { id: 'claim', label: 'Claim', prompt: 'What claims or interpretations are possible?' },
  { id: 'community', label: 'Community', prompt: 'Which people or groups are related?' },
  { id: 'outcome', label: 'Outcome', prompt: 'What result is produced?' },
  { id: 'lever', label: 'Lever', prompt: 'What changes the result?' },
  { id: 'policy', label: 'Policy', prompt: 'What rules or constraints apply?' },
]
const DEFAULT_INGEST_RESEARCH_FIELDS = INGEST_RESEARCH_FIELD_OPTIONS.map((field) => field.id)
const RESEARCH_PRESETS: Record<IngestResearchDepth, { sources: number; evidence: number; rounds: number; social: number; label: string }> = {
  quick: { sources: 10, evidence: 1, rounds: 2, social: 2, label: 'Quick' },
  standard: { sources: 30, evidence: 2, rounds: 4, social: 6, label: 'Standard' },
  deep: { sources: 70, evidence: 3, rounds: 7, social: 12, label: 'Deep' },
  exhaustive: { sources: 120, evidence: 4, rounds: 12, social: 25, label: 'Exhaustive' },
}
const INGEST_TARGET_OPTIONS: Array<{ value: IngestTarget; label: string }> = [
  { value: 'local-api-cloud-mcp', label: 'Local API + Cloud MCP' },
  { value: 'local-api', label: 'Local API only' },
  { value: 'local-mcp', label: 'Local MCP only' },
  { value: 'cloud-mcp', label: 'OpenCrab Cloud MCP only' },
  { value: 'local-mcp-cloud-mcp', label: 'Local MCP + Cloud MCP' },
  { value: 'cloud-mcp-local-api', label: 'Cloud MCP then Local API' },
]

function ingestTargetUsesCloud(target: IngestTarget) {
  return target.includes('cloud')
}

function ingestTargetUsesLocal(target: IngestTarget) {
  return target.includes('local')
}

function ingestTargetLabel(target: IngestTarget) {
  return INGEST_TARGET_OPTIONS.find((option) => option.value === target)?.label ?? target
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
  const [tab, setTab] = useState<'detail' | 'query' | 'ingest' | 'agent' | 'ops'>('detail')
  const [panelWidth, setPanelWidth] = useState(380)
  const [queryText, setQueryText] = useState('')
  const [queryResults, setQueryResults] = useState<{ node_id: string | null; score?: number; text?: string | null }[]>([])
  const [querying, setQuerying] = useState(false)
  const [ingestTarget, setIngestTarget] = useState<IngestTarget>('local-api-cloud-mcp')
  const [ingestSourceType, setIngestSourceType] = useState<SourceType>('obsidian')
  const [ingestToken, setIngestToken] = useState('')
  const [ingestQuery, setIngestQuery] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [ingestPhase, setIngestPhase] = useState<'idle' | 'starting' | 'importing' | 'cloud'>('idle')
  const [startingServices, setStartingServices] = useState(false)
  const [serviceStatus, setServiceStatus] = useState<LocalServicesStatus | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null)
  const [mcpUrlInput, setMcpUrlInput] = useState('')
  const [mcpApiKeyInput, setMcpApiKeyInput] = useState('')
  const [mcpConnectionMessage, setMcpConnectionMessage] = useState('')
  const [agentTarget, setAgentTarget] = useState('both')
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentResults, setAgentResults] = useState<AgentAssetResult[]>([])
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null)
  const [codexPrompt, setCodexPrompt] = useState('')
  const [codexModel, setCodexModel] = useState('gpt-5.5')
  const [codexReasoning, setCodexReasoning] = useState('high')
  const [codexPermission, setCodexPermission] = useState('yolo')
  const [codexEnsureServices, setCodexEnsureServices] = useState(true)
  const [codexUseResearch, setCodexUseResearch] = useState(true)
  const [codexUseVision, setCodexUseVision] = useState(true)
  const [codexPackageOutput, setCodexPackageOutput] = useState(true)
  const [codexIngestDepth, setCodexIngestDepth] = useState<IngestResearchDepth>('standard')
  const [codexSourceCount, setCodexSourceCount] = useState(RESEARCH_PRESETS.standard.sources)
  const [codexEvidencePerClaim, setCodexEvidencePerClaim] = useState(RESEARCH_PRESETS.standard.evidence)
  const [codexSearchRounds, setCodexSearchRounds] = useState(RESEARCH_PRESETS.standard.rounds)
  const [codexSocialSourceCount, setCodexSocialSourceCount] = useState(RESEARCH_PRESETS.standard.social)
  const [codexIngestFields, setCodexIngestFields] = useState<IngestResearchField[]>(DEFAULT_INGEST_RESEARCH_FIELDS)
  const [packOutputDir, setPackOutputDir] = useState('')
  const [packBusy, setPackBusy] = useState(false)
  const [packIngestingPath, setPackIngestingPath] = useState('')
  const [generatedPacks, setGeneratedPacks] = useState<GeneratedPack[]>([])
  const [codexBusy, setCodexBusy] = useState(false)
  const [codexResult, setCodexResult] = useState<CodexTaskResult | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [opsBusy, setOpsBusy] = useState(false)
  const codexLogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void refreshDesktopStatus()
    void refreshLocalServices()
    void refreshCodexStatus()
    void refreshPackSettings()
    void refreshGeneratedPacks()
    const timer = setInterval(() => void refreshLocalServices(), 15000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const saved = Number(localStorage.getItem('opencrab_right_panel_width') || '')
    if (Number.isFinite(saved) && saved >= 320) {
      setPanelWidth(Math.min(saved, Math.max(360, window.innerWidth - 320)))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('opencrab_right_panel_width', String(panelWidth))
  }, [panelWidth])

  useEffect(() => {
    if (!codexBusy || !codexResult?.taskId || isCodexTerminalStatus(codexResult.status)) {
      return
    }

    let cancelled = false
    const poll = async () => {
      try {
        const task = await getCodexTask(codexResult.taskId)
        if (cancelled) return
        setCodexResult(task)
        if (isCodexTerminalStatus(task.status)) {
          setCodexBusy(false)
          showToast(task.status === 'completed' ? 'Codex task complete' : task.error || `Codex task ${task.status}`, task.status === 'completed' ? 'success' : 'error')
          await refreshCodexStatus()
          await refreshLocalServices()
          await refreshGeneratedPacks()
        }
      } catch (error) {
        if (!cancelled) {
          showToast(String(error), 'error')
        }
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), 1500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [codexBusy, codexResult?.taskId])

  useEffect(() => {
    const node = codexLogRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [codexResult?.messages?.length, codexResult?.finalMessage])

  function isCodexTerminalStatus(status?: string) {
    return status === 'completed' || status === 'failed' || status === 'timed_out' || status === 'canceled'
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  function beginPanelResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelWidth
    const maxWidth = Math.max(360, window.innerWidth - 320)
    const onMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(320, Math.min(maxWidth, startWidth + startX - moveEvent.clientX))
      setPanelWidth(nextWidth)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function applyResearchPreset(depth: IngestResearchDepth) {
    const preset = RESEARCH_PRESETS[depth]
    setCodexIngestDepth(depth)
    setCodexSourceCount(preset.sources)
    setCodexEvidencePerClaim(preset.evidence)
    setCodexSearchRounds(preset.rounds)
    setCodexSocialSourceCount(preset.social)
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

  async function refreshPackSettings() {
    try {
      const settings = await getPackSettings()
      setPackOutputDir(settings.outputDir)
    } catch {
      setPackOutputDir('')
    }
  }

  async function refreshGeneratedPacks() {
    try {
      const packs = await getGeneratedPacks()
      setGeneratedPacks(packs)
    } catch {
      setGeneratedPacks([])
    }
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
    const wantsLocal = ingestTargetUsesLocal(ingestTarget)
    const wantsCloud = ingestTargetUsesCloud(ingestTarget)
    setIngestPhase(wantsLocal ? 'starting' : 'cloud')
    try {
      if (wantsLocal) {
        const status = await startLocalServices()
        setServiceStatus(status)
      }
      setIngestPhase(wantsCloud && !wantsLocal ? 'cloud' : 'importing')
      await ingestDesktopSource(ingestTarget, apiKey, ingestSourceType, ingestToken, {
        sourceId: ingestQuery || undefined,
        title: ingestQuery || 'Desktop ingest',
      })
      showToast(`Ingest complete (${ingestTargetLabel(ingestTarget)})`)
      setIngestToken('')
      setIngestQuery('')
      if (wantsLocal) onRefresh()
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
      showToast(`MCP ready: ${result.tools} tools${result.mcpIngestAvailable ? ', ingest ready' : ''}`)
      setMcpConnectionMessage(`Connected: ${result.tools} tools, ingest ${result.mcpIngestAvailable ? 'ready' : 'missing'}`)
      setMcpUrlInput('')
      setMcpApiKeyInput('')
      await refreshDesktopStatus()
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setAgentBusy(false)
    }
  }

  async function handleSaveMcpUrlFromClipboard() {
    setAgentBusy(true)
    try {
      const result = await saveDesktopMcpUrlFromClipboard(mcpApiKeyInput.trim())
      showToast(`MCP ready: ${result.tools} tools${result.mcpIngestAvailable ? ', ingest ready' : ''}`)
      setMcpConnectionMessage(`Connected from clipboard: ${result.tools} tools, ingest ${result.mcpIngestAvailable ? 'ready' : 'missing'}`)
      setMcpApiKeyInput('')
      await refreshDesktopStatus()
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setAgentBusy(false)
    }
  }

  async function handleTestMcpUrl() {
    setAgentBusy(true)
    try {
      const result = await testDesktopMcpConnection(mcpApiKeyInput.trim())
      const sampleTools = (result.toolNames || []).slice(0, 5).join(', ')
      setMcpConnectionMessage(`Last test: ${result.tools} tools, ingest ${result.mcpIngestAvailable ? 'ready' : 'missing'}${sampleTools ? ` (${sampleTools})` : ''}`)
      showToast(`MCP test complete: ${result.tools} tools`)
      await refreshDesktopStatus()
    } catch (error) {
      setMcpConnectionMessage(String(error))
      showToast(String(error), 'error')
    } finally {
      setAgentBusy(false)
    }
  }

  async function handleOAuthStart() {
    setAgentBusy(true)
    try {
      const result = await startDesktopOAuth()
      showToast(result.mode === 'oauth' ? 'OAuth browser opened' : 'Browser login opened')
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
        useResearchSkill: codexUseResearch,
        useVisionSkill: codexUseVision,
        packageOutput: codexPackageOutput,
        packOutputDir,
        ingestResearchDepth: codexIngestDepth,
        ingestResearchFields: codexIngestFields,
        ingestSourceCount: codexSourceCount,
        ingestEvidencePerClaim: codexEvidencePerClaim,
        ingestSearchRounds: codexSearchRounds,
        ingestSocialSourceCount: codexSocialSourceCount,
      })
      setCodexResult(result)
      showToast('Codex task started')
    } catch (error) {
      showToast(String(error), 'error')
      setCodexBusy(false)
    }
  }

  async function handleCheckUpdate() {
    setOpsBusy(true)
    try {
      const status = await checkDesktopUpdate()
      setUpdateStatus(status)
      showToast(status.hasUpdate ? `Update available: ${status.latestVersion}` : 'OpenCrab is up to date')
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setOpsBusy(false)
    }
  }

  async function handleOpenRelease() {
    setOpsBusy(true)
    try {
      await openDesktopRelease(updateStatus?.releaseUrl)
      showToast('Release page opened')
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setOpsBusy(false)
    }
  }

  async function handleRestartServices() {
    setOpsBusy(true)
    try {
      const status = await restartLocalServices({ includeData: true, includeApi: true, includeMcp: true })
      setServiceStatus(status)
      showToast('Local services restarted')
      onRefresh()
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setOpsBusy(false)
    }
  }

  async function handleRestartWebUi() {
    setOpsBusy(true)
    try {
      await restartWebUi()
      showToast('Web UI restarted')
      setTimeout(() => window.location.reload(), 1000)
    } catch (error) {
      showToast(String(error), 'error')
      setOpsBusy(false)
    }
  }

  async function handleOpenDockerInstall() {
    setOpsBusy(true)
    try {
      await openDockerInstall()
      showToast('Docker install page opened')
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setOpsBusy(false)
    }
  }

  async function handleSetStorageMode(mode: 'auto' | 'local' | 'docker') {
    setOpsBusy(true)
    try {
      const status = await setDesktopStorageMode(mode)
      setServiceStatus(status)
      showToast(`Storage mode: ${status.storageMode ?? mode}`)
      onRefresh()
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setOpsBusy(false)
    }
  }

  async function handleSelectPackOutputDir() {
    setPackBusy(true)
    try {
      const settings = await selectPackOutputDir()
      if (!settings.canceled) {
        setPackOutputDir(settings.outputDir)
        showToast('Pack folder saved')
      }
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setPackBusy(false)
    }
  }

  async function handleSavePackOutputDir() {
    if (!packOutputDir.trim()) return
    setPackBusy(true)
    try {
      const settings = await savePackSettings(packOutputDir.trim())
      setPackOutputDir(settings.outputDir)
      showToast('Pack folder saved')
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setPackBusy(false)
    }
  }

  async function handleOpenPack(path: string) {
    try {
      await openGeneratedPack(path)
    } catch (error) {
      showToast(String(error), 'error')
    }
  }

  async function handleIngestGeneratedPack(path: string) {
    setPackIngestingPath(path)
    try {
      const wantsLocal = ingestTargetUsesLocal(ingestTarget)
      if (wantsLocal) {
        await startLocalServices()
      }
      await ingestGeneratedPack(path, apiKey, ingestTarget)
      await refreshGeneratedPacks()
      if (wantsLocal) onRefresh()
      showToast(`Generated pack ingested (${ingestTargetLabel(ingestTarget)})`)
    } catch (error) {
      showToast(String(error), 'error')
    } finally {
      setPackIngestingPath('')
    }
  }

  function toggleCodexIngestField(field: IngestResearchField) {
    setCodexIngestFields((current) => (
      current.includes(field)
        ? current.length > 1 ? current.filter((item) => item !== field) : current
        : [...current, field]
    ))
  }

  function formatBytes(bytes?: number) {
    const value = bytes || 0
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / 1024 / 1024).toFixed(1)} MB`
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

  const ingestNeedsCloud = ingestTargetUsesCloud(ingestTarget)
  const cloudIngestReady = Boolean(desktopStatus?.mcpUrlConfigured && desktopStatus?.mcpIngestAvailable)
  const cloudStatusText = !desktopStatus?.mcpUrlConfigured
    ? 'not connected'
    : desktopStatus?.mcpIngestAvailable
      ? `ingest ready (${desktopStatus.mcpToolsCount ?? 0} tools)`
      : `connected, ingest tool missing (${desktopStatus.mcpToolsCount ?? 0} tools)`
  const storageMode = serviceStatus?.storageMode ?? 'local'
  const usingLocalStorage = storageMode === 'local'
  const localStackLabel = usingLocalStorage ? 'Local storage' : 'Docker stack'
  const graphLabel = usingLocalStorage ? 'Local graph' : 'Neo4j'
  const graphLocation = usingLocalStorage
    ? serviceStatus?.localDataDir ?? 'local data directory'
    : serviceStatus?.neo4j?.boltUrl ?? 'bolt://localhost:7688'
  const dockerMessage = serviceStatus?.docker?.message || ''

  return (
    <div
      style={{
        width: panelWidth,
        minWidth: panelWidth,
        flexBasis: panelWidth,
        flexShrink: 0,
        background: '#1a1a1a',
        borderLeft: '1px solid rgba(248,197,55,0.15)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        onMouseDown={beginPanelResize}
        style={{
          position: 'absolute',
          left: -4,
          top: 0,
          width: 8,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 5,
        }}
      />
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(248,197,55,0.15)' }}>
        {(['detail', 'query', 'ingest', 'agent', 'ops'] as const).map((item) => (
          <button
            key={item}
            className={`tab ${tab === item ? 'active' : ''}`}
            onClick={() => setTab(item)}
            style={{ flex: 1, fontSize: 11 }}
          >
            {item === 'detail' ? 'Node' : item === 'query' ? 'Query' : item === 'ingest' ? 'Ingest' : item === 'agent' ? 'Agent' : 'Ops'}
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
                  {graphLabel} {serviceStatus?.ok ? 'ready' : 'not ready'}
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
                {graphLocation}
              </div>
              {usingLocalStorage && (
                <div style={{ marginTop: 5, color: '#8ec07c', lineHeight: 1.4 }}>
                  Docker is optional in local mode. Use Docker mode only when you need Neo4j Browser and the full external database stack.
                </div>
              )}
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#7c6f64', display: 'block', marginBottom: 4 }}>Ingest target</label>
              <select
                className="input-dark"
                value={ingestTarget}
                onChange={(event) => setIngestTarget(event.target.value as IngestTarget)}
                style={{ fontSize: 12 }}
              >
                {INGEST_TARGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div style={{ marginTop: 5, color: cloudIngestReady ? '#8ec07c' : '#fb4934', fontSize: 10, lineHeight: 1.4 }}>
                OpenCrab MCP: {cloudStatusText}
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
                Text / evidence
              </label>
              <textarea
                className="input-dark mono"
                value={ingestToken}
                onChange={(event) => setIngestToken(event.target.value)}
                placeholder="Paste text, notes, evidence, or pack content to ingest"
                style={{ fontSize: 11, height: 90 }}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#7c6f64', display: 'block', marginBottom: 4 }}>Source id (optional)</label>
              <input
                className="input-dark"
                value={ingestQuery}
                onChange={(event) => setIngestQuery(event.target.value)}
                placeholder="Stable id for this source"
                style={{ fontSize: 11 }}
              />
            </div>
            <button
              className="btn-gold"
              style={{ width: '100%' }}
              onClick={handleIngest}
              disabled={ingesting || startingServices || !ingestToken.trim() || (ingestNeedsCloud && !cloudIngestReady)}
            >
              {ingestPhase === 'starting' ? 'Starting Neo4j...' : ingestPhase === 'importing' ? 'Importing locally...' : ingestPhase === 'cloud' ? 'Sending to OpenCrab...' : 'Import Data'}
            </button>
            <div style={{ marginTop: 8, fontSize: 10, color: '#555', lineHeight: 1.5 }}>
              Connected source data is converted into GraphRAG-ready ontology records.
            </div>

            <hr className="gold-line" style={{ margin: '14px 0' }} />

            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: '#555', letterSpacing: '0.06em' }}>INGEST QUEUE</span>
                <button className="btn-gold" style={{ fontSize: 10, padding: '3px 7px' }} onClick={refreshGeneratedPacks}>
                  Refresh
                </button>
              </div>
              {generatedPacks.length === 0 ? (
                <div style={{ color: '#555', fontSize: 10, lineHeight: 1.5 }}>
                  Codex-created ZIP packs will appear here automatically.
                </div>
              ) : (
                generatedPacks.map((pack) => (
                  <div
                    key={`${pack.taskId}-${pack.zipPath}`}
                    style={{
                      padding: '8px 9px',
                      marginBottom: 7,
                      background: '#1f1f1f',
                      borderRadius: 4,
                      border: `1px solid ${pack.exists === false ? '#5a2c2c' : '#2e2e2e'}`,
                      fontSize: 10,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                      <span style={{ color: '#f8c537' }}>{pack.name}</span>
                      <span style={{ color: pack.exists === false ? '#fb4934' : '#8ec07c' }}>
                        {pack.exists === false ? 'missing' : pack.status || 'ready'}
                      </span>
                    </div>
                    <div style={{ color: '#7c6f64', marginBottom: 4 }}>
                      {formatBytes(pack.size)} · {pack.fileCount} files
                    </div>
                    <div className="mono" style={{ color: '#7c6f64', wordBreak: 'break-all', marginBottom: 6 }}>
                      {pack.zipPath}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <button
                        className="btn-gold"
                        style={{ fontSize: 10, padding: '4px 8px' }}
                        onClick={() => handleOpenPack(pack.zipPath)}
                        disabled={pack.exists === false}
                      >
                        Open
                      </button>
                      <button
                        className="btn-gold"
                        style={{ fontSize: 10, padding: '4px 8px' }}
                        onClick={() => handleIngestGeneratedPack(pack.zipPath)}
                        disabled={pack.exists === false || packIngestingPath === pack.zipPath || pack.status === 'ingested' || (ingestNeedsCloud && !cloudIngestReady)}
                      >
                        {packIngestingPath === pack.zipPath ? 'Ingesting...' : pack.status === 'ingested' ? 'Ingested' : 'Ingest ZIP'}
                      </button>
                    </div>
                  </div>
                ))
              )}
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
              <div style={{ color: cloudIngestReady ? '#8ec07c' : '#fb4934', fontSize: 10, marginTop: 4 }}>
                tools: {desktopStatus?.mcpToolsCount ?? 0} · ingest: {desktopStatus?.mcpIngestAvailable ? 'ready' : 'missing'}
              </div>
            </div>

            <button className="btn-gold" style={{ width: '100%', marginBottom: 8 }} onClick={handleOAuthStart} disabled={agentBusy}>
              Open opencrab.sh Login
            </button>

            <div style={{ color: '#7c6f64', fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
              Browser login does not share cookies with the desktop app. Copy your OpenCrab MCP URL after login, then connect it here.
            </div>

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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
              <button className="btn-gold" style={{ fontSize: 10, padding: '5px 8px' }} onClick={handleSaveMcpUrlFromClipboard} disabled={agentBusy}>
                Connect Clipboard
              </button>
              <button className="btn-gold" style={{ fontSize: 10, padding: '5px 8px' }} onClick={handleTestMcpUrl} disabled={agentBusy || !desktopStatus?.mcpUrlConfigured}>
                Test MCP
              </button>
            </div>
            {(mcpConnectionMessage || desktopStatus?.mcpToolNames?.length) && (
              <div
                className="mono"
                style={{
                  padding: '6px 7px',
                  background: '#151515',
                  border: '1px solid #2e2e2e',
                  borderRadius: 4,
                  color: cloudIngestReady ? '#8ec07c' : '#bdae93',
                  fontSize: 10,
                  lineHeight: 1.45,
                  wordBreak: 'break-word',
                  marginBottom: 12,
                }}
              >
                {mcpConnectionMessage || `Tools: ${(desktopStatus?.mcpToolNames || []).slice(0, 6).join(', ')}`}
              </div>
            )}

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
              placeholder="Ask Codex to create ingest files, inspect Neo4j, prepare graph work, or build image packs"
              style={{ marginBottom: 8, height: 96, fontSize: 11 }}
            />

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#7c6f64', display: 'block', marginBottom: 4 }}>Pack ZIP folder</label>
              <input
                className="input-dark mono"
                value={packOutputDir}
                onChange={(event) => setPackOutputDir(event.target.value)}
                placeholder="Default OpenCrab pack folder"
                style={{ fontSize: 10, marginBottom: 6 }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button className="btn-gold" style={{ fontSize: 10, padding: '4px 8px' }} onClick={handleSelectPackOutputDir} disabled={packBusy}>
                  Browse
                </button>
                <button className="btn-gold" style={{ fontSize: 10, padding: '4px 8px' }} onClick={handleSavePackOutputDir} disabled={packBusy || !packOutputDir.trim()}>
                  Save
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#7c6f64', display: 'block', marginBottom: 4 }}>Ingest research</label>
              <select
                className="input-dark"
                value={codexIngestDepth}
                onChange={(event) => applyResearchPreset(event.target.value as IngestResearchDepth)}
                style={{ fontSize: 11, marginBottom: 6 }}
              >
                <option value="quick">Quick preset</option>
                <option value="standard">Standard preset</option>
                <option value="deep">Deep preset</option>
                <option value="exhaustive">Exhaustive preset</option>
              </select>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                <label style={{ fontSize: 10, color: '#7c6f64' }}>
                  Sources
                  <input
                    className="input-dark"
                    type="number"
                    min={1}
                    max={500}
                    value={codexSourceCount}
                    onChange={(event) => setCodexSourceCount(Number(event.target.value))}
                    style={{ fontSize: 10, marginTop: 3 }}
                  />
                </label>
                <label style={{ fontSize: 10, color: '#7c6f64' }}>
                  Evidence
                  <input
                    className="input-dark"
                    type="number"
                    min={1}
                    max={20}
                    value={codexEvidencePerClaim}
                    onChange={(event) => setCodexEvidencePerClaim(Number(event.target.value))}
                    style={{ fontSize: 10, marginTop: 3 }}
                  />
                </label>
                <label style={{ fontSize: 10, color: '#7c6f64' }}>
                  Rounds
                  <input
                    className="input-dark"
                    type="number"
                    min={1}
                    max={50}
                    value={codexSearchRounds}
                    onChange={(event) => setCodexSearchRounds(Number(event.target.value))}
                    style={{ fontSize: 10, marginTop: 3 }}
                  />
                </label>
                <label style={{ fontSize: 10, color: '#7c6f64' }}>
                  Social
                  <input
                    className="input-dark"
                    type="number"
                    min={0}
                    max={200}
                    value={codexSocialSourceCount}
                    onChange={(event) => setCodexSocialSourceCount(Number(event.target.value))}
                    style={{ fontSize: 10, marginTop: 3 }}
                  />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {INGEST_RESEARCH_FIELD_OPTIONS.map((field) => (
                  <label
                    key={field.id}
                    title={field.prompt}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#7c6f64', whiteSpace: 'nowrap' }}
                  >
                    <input
                      type="checkbox"
                      checked={codexIngestFields.includes(field.id)}
                      onChange={() => toggleCodexIngestField(field.id)}
                      style={{ accentColor: '#f8c537' }}
                    />
                    {field.label}
                  </label>
                ))}
              </div>
            </div>

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

            <div style={{ marginBottom: 8 }}>
              <select
                className="input-dark"
                value={codexPermission}
                onChange={(event) => setCodexPermission(event.target.value)}
                style={{ fontSize: 11, marginBottom: 6 }}
              >
                <option value="yolo">desktop full access</option>
                <option value="auto">workspace sandbox</option>
                <option value="review">review sandbox</option>
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#7c6f64', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={codexEnsureServices}
                    onChange={(event) => setCodexEnsureServices(event.target.checked)}
                    style={{ accentColor: '#f8c537' }}
                  />
                  Neo4j
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#7c6f64', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={codexUseResearch}
                    onChange={(event) => setCodexUseResearch(event.target.checked)}
                    style={{ accentColor: '#f8c537' }}
                  />
                  Research
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#7c6f64', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={codexUseVision}
                    onChange={(event) => setCodexUseVision(event.target.checked)}
                    style={{ accentColor: '#f8c537' }}
                  />
                  Vision
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#7c6f64', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={codexPackageOutput}
                    onChange={(event) => setCodexPackageOutput(event.target.checked)}
                    style={{ accentColor: '#f8c537' }}
                  />
                  Zip
                </label>
              </div>
            </div>

            <button
              className="btn-gold"
              style={{ width: '100%', marginBottom: 10 }}
              onClick={handleRunCodexTask}
              disabled={codexBusy || !codexPrompt.trim() || !codexStatus?.available}
            >
              {codexBusy ? `Codex: ${codexResult?.phase || 'starting'}` : 'Run Codex Task'}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: '#f8c537' }}>Task {codexResult.taskId}</span>
                  <span style={{ color: codexResult.status === 'completed' ? '#8ec07c' : codexResult.status === 'failed' || codexResult.status === 'timed_out' ? '#fb4934' : '#bdae93' }}>
                    {codexResult.status}
                  </span>
                </div>
                <div className="mono" style={{ color: '#7c6f64', wordBreak: 'break-all', marginBottom: 6 }}>
                  {codexResult.packZipPath || codexResult.taskFile || codexResult.phase}
                </div>
                <div
                  ref={codexLogRef}
                  style={{
                    maxHeight: 260,
                    overflowY: 'auto',
                    border: '1px solid #2e2e2e',
                    borderRadius: 4,
                    padding: 6,
                    background: '#151515',
                  }}
                >
                  {(codexResult.messages && codexResult.messages.length > 0
                    ? codexResult.messages
                    : codexResult.progress.map((line, index) => ({ id: `${index}`, role: 'codex', text: line, at: '' }))
                  ).map((message) => {
                    const role = message.role || 'codex'
                    const color = role === 'user' ? '#f8c537' : role === 'error' || role === 'stderr' ? '#fb4934' : role === 'final' ? '#faf2d6' : role === 'system' ? '#8ec07c' : '#bdae93'
                    return (
                      <div key={message.id} style={{ marginBottom: 8 }}>
                        <div style={{ color: '#555', fontSize: 9, marginBottom: 2, textTransform: 'uppercase' }}>
                          {role}
                        </div>
                        <div style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {message.text.slice(0, role === 'final' ? 2000 : 900)}
                        </div>
                      </div>
                    )
                  })}
                  {codexBusy && (
                    <div style={{ color: '#7c6f64' }}>
                      Waiting for Codex output...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'ops' && (
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
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ color: serviceStatus?.ok ? '#8ec07c' : '#fb4934' }}>
                  {localStackLabel} {serviceStatus?.ok ? 'healthy' : 'needs attention'}
                </span>
                <button className="btn-gold" style={{ fontSize: 10, padding: '3px 7px' }} onClick={refreshLocalServices} disabled={opsBusy}>
                  Refresh
                </button>
              </div>
              <div className="mono" style={{ color: '#7c6f64', wordBreak: 'break-all', marginBottom: 4 }}>
                API {serviceStatus?.api?.status ?? 'n/a'} / {storageMode} / {graphLocation}
              </div>
              {dockerMessage && (
                <div style={{ color: serviceStatus?.docker?.available ? '#8ec07c' : '#fabd2f', lineHeight: 1.4, marginBottom: 4 }}>
                  Docker: {dockerMessage}
                </div>
              )}
              {serviceStatus?.containers &&
                Object.entries(serviceStatus.containers).map(([name, container]) => (
                  <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                    <span>{name}</span>
                    <span style={{ color: container.running && container.healthy ? '#8ec07c' : '#fb4934' }}>
                      {container.status}
                    </span>
                  </div>
                ))}
            </div>

            <button className="btn-gold" style={{ width: '100%', marginBottom: 8 }} onClick={handleStartServices} disabled={opsBusy || startingServices}>
              {startingServices ? 'Starting...' : 'Start Services'}
            </button>
            <button className="btn-gold" style={{ width: '100%', marginBottom: 8 }} onClick={handleRestartServices} disabled={opsBusy}>
              {opsBusy ? 'Working...' : `Restart ${usingLocalStorage ? 'Local Services' : 'Graph Services'}`}
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
              <button className="btn-gold" style={{ fontSize: 10, padding: '5px 6px' }} onClick={() => handleSetStorageMode('auto')} disabled={opsBusy}>
                Auto
              </button>
              <button className="btn-gold" style={{ fontSize: 10, padding: '5px 6px' }} onClick={() => handleSetStorageMode('local')} disabled={opsBusy}>
                Local
              </button>
              <button className="btn-gold" style={{ fontSize: 10, padding: '5px 6px' }} onClick={() => handleSetStorageMode('docker')} disabled={opsBusy}>
                Docker
              </button>
            </div>
            <button className="btn-gold" style={{ width: '100%', marginBottom: 8 }} onClick={handleOpenDockerInstall} disabled={opsBusy}>
              Install / Open Docker Guide
            </button>
            <button className="btn-gold" style={{ width: '100%', marginBottom: 14 }} onClick={handleRestartWebUi} disabled={opsBusy}>
              Restart Web UI
            </button>

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
              <div style={{ fontSize: 10, color: '#555', marginBottom: 4, letterSpacing: '0.06em' }}>UPDATES</div>
              <div style={{ color: updateStatus?.hasUpdate ? '#f8c537' : '#8ec07c', marginBottom: 4 }}>
                {updateStatus
                  ? updateStatus.hasUpdate
                    ? `OpenCrab ${updateStatus.latestVersion} available`
                    : `Current ${updateStatus.currentVersion}`
                  : 'Not checked'}
              </div>
              {updateStatus?.publishedAt && (
                <div className="mono" style={{ color: '#7c6f64', wordBreak: 'break-all' }}>
                  {new Date(updateStatus.publishedAt).toLocaleString()}
                </div>
              )}
              {updateStatus?.error && <div style={{ color: '#fb4934', marginTop: 4 }}>{updateStatus.error}</div>}
            </div>

            <button className="btn-gold" style={{ width: '100%', marginBottom: 8 }} onClick={handleCheckUpdate} disabled={opsBusy}>
              Check For Updates
            </button>
            <button className="btn-gold" style={{ width: '100%' }} onClick={handleOpenRelease} disabled={opsBusy}>
              Open Release Page
            </button>
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
