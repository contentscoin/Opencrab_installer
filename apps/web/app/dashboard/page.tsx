'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import FileExplorer from '../../components/FileExplorer'
import RightPanel from '../../components/RightPanel'
import type { DesktopStatus, OcNode, OcEdge } from '../../lib/api'
import { getDesktopStatus, getNodes, getEdges, getStatus, openExternalUrl, saveDesktopMcpUrl, saveDesktopMcpUrlFromClipboard, startDesktopOAuth } from '../../lib/api'

const GraphView = dynamic(() => import('../../components/GraphView'), { ssr: false })

interface GraphControls {
  nodeSize: number
  linkStrength: number
  centerForce: number
  repelForce: number
  searchTerm: string
  hiddenSpaces: string[]
}

export default function DashboardPage() {
  const [apiKey, setApiKey] = useState('')
  const [nodes, setNodes] = useState<OcNode[]>([])
  const [edges, setEdges] = useState<OcEdge[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [workspaceTab, setWorkspaceTab] = useState<'graph' | 'cloud'>('graph')
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null)
  const [cloudMcpUrl, setCloudMcpUrl] = useState('')
  const [cloudApiKey, setCloudApiKey] = useState('')
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudMessage, setCloudMessage] = useState('')
  const [controls, setControls] = useState<GraphControls>({
    nodeSize: 1,
    linkStrength: 0.3,
    centerForce: 0.1,
    repelForce: 200,
    searchTerm: '',
    hiddenSpaces: [],
  })
  const [showIngest, setShowIngest] = useState(false)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadApiKey = async () => {
      const saved = localStorage.getItem('oc_api_key') || process.env.NEXT_PUBLIC_OPENCRAB_API_KEY || ''
      try {
        const status = await getDesktopStatus()
        if (!cancelled) setDesktopStatus(status)
        const nextKey = status.localApiKey || saved
        if (!cancelled && nextKey) {
          setApiKey(nextKey)
          localStorage.setItem('oc_api_key', nextKey)
        }
      } catch {
        if (!cancelled) setApiKey(saved)
      }
    }

    void loadApiKey()
    return () => {
      cancelled = true
    }
  }, [])

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    localStorage.setItem('oc_api_key', key)
  }

  const fetchData = useCallback(async () => {
    const ok = await getStatus()
    setConnected(ok.ok)
    if (!apiKey) return

    const [nextNodes, nextEdges] = await Promise.all([getNodes(apiKey), getEdges(apiKey)])
    setNodes(nextNodes.filter((node) => !controls.hiddenSpaces.includes(node.space)))
    setEdges(nextEdges)
  }, [apiKey, controls.hiddenSpaces])

  useEffect(() => {
    fetchData()
    refreshTimer.current = setInterval(fetchData, 30000)
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current)
    }
  }, [fetchData])

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null

  function handleNodeClick(node: OcNode) {
    setSelectedId(node.id)
  }

  function handleControlChange(partial: Partial<GraphControls>) {
    setControls((previous) => ({ ...previous, ...partial }))
  }

  async function handleOpenCloud(url = 'https://opencrab.sh') {
    await openExternalUrl(url)
  }

  async function refreshDesktopCloudStatus() {
    const status = await getDesktopStatus()
    setDesktopStatus(status)
  }

  async function handleCloudLogin() {
    setCloudBusy(true)
    try {
      const result = await startDesktopOAuth()
      setCloudMessage(result.mode === 'oauth' ? 'OAuth login opened. Waiting for callback.' : 'Browser login opened. Copy your MCP URL after login, then connect it here.')
      setTimeout(() => void refreshDesktopCloudStatus(), 2500)
    } catch (error) {
      setCloudMessage(String(error))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleSaveCloudMcpUrl() {
    if (!cloudMcpUrl.trim()) return
    setCloudBusy(true)
    try {
      const result = await saveDesktopMcpUrl(cloudMcpUrl.trim(), cloudApiKey.trim())
      setCloudMcpUrl('')
      setCloudApiKey('')
      setCloudMessage(`MCP connected with ${result.tools} tools${result.mcpIngestAvailable ? ', ingest ready' : ''}.`)
      await refreshDesktopCloudStatus()
    } catch (error) {
      setCloudMessage(String(error))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleSaveCloudMcpUrlFromClipboard() {
    setCloudBusy(true)
    try {
      const result = await saveDesktopMcpUrlFromClipboard(cloudApiKey.trim())
      setCloudApiKey('')
      setCloudMessage(`MCP connected with ${result.tools} tools${result.mcpIngestAvailable ? ', ingest ready' : ''}.`)
      await refreshDesktopCloudStatus()
    } catch (error) {
      setCloudMessage(String(error))
    } finally {
      setCloudBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        background: '#111',
        overflow: 'hidden',
      }}
    >
      <FileExplorer
        nodes={nodes}
        selectedId={selectedId}
        onNodeSelect={(id) => setSelectedId(id)}
        onIngestClick={() => setShowIngest(true)}
        connected={connected}
        apiKey={apiKey}
        onApiKeyChange={handleApiKeyChange}
      />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: 'rgba(17,17,17,0.9)',
            borderBottom: '1px solid rgba(248,197,55,0.12)',
          }}
        >
          <span style={{ fontSize: 12, color: '#555' }}>Graph View</span>
          <span style={{ fontSize: 11, color: '#3a3a3a' }}>|</span>
          <button
            className={`tab ${workspaceTab === 'graph' ? 'active' : ''}`}
            onClick={() => setWorkspaceTab('graph')}
            style={{ fontSize: 11, padding: '4px 8px', borderBottomWidth: 1 }}
          >
            Local
          </button>
          <button
            className={`tab ${workspaceTab === 'cloud' ? 'active' : ''}`}
            onClick={() => setWorkspaceTab('cloud')}
            style={{ fontSize: 11, padding: '4px 8px', borderBottomWidth: 1 }}
          >
            opencrab.sh
          </button>
          <span style={{ fontSize: 11, color: '#3a3a3a' }}>|</span>
          <span style={{ fontSize: 11, color: '#7c6f64' }}>
            {workspaceTab === 'graph' ? `${nodes.length} nodes / ${edges.length} edges` : 'cloud workspace'}
          </span>
          <div style={{ flex: 1 }} />
          {workspaceTab === 'graph' ? (
            <>
              <input
                className="input-dark"
                value={controls.searchTerm}
                onChange={(event) => handleControlChange({ searchTerm: event.target.value })}
                placeholder="Search nodes"
                style={{ width: 180, fontSize: 11, padding: '4px 10px' }}
              />
              <button className="btn-gold" style={{ fontSize: 11, padding: '4px 10px' }} onClick={fetchData}>
                Refresh
              </button>
            </>
          ) : (
            <>
              <button className="btn-gold" style={{ fontSize: 11, padding: '4px 10px' }} onClick={refreshDesktopCloudStatus}>
                Refresh
              </button>
              <button
                className="btn-gold"
                onClick={() => handleOpenCloud()}
                style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}
              >
                Open Browser
              </button>
              <button className="btn-gold" style={{ fontSize: 11, padding: '4px 10px' }} onClick={handleCloudLogin} disabled={cloudBusy}>
                Login
              </button>
            </>
          )}
        </div>

        <div style={{ position: 'absolute', inset: 0, paddingTop: 42 }}>
          {workspaceTab === 'graph' ? (
            <GraphView
              nodes={nodes}
              edges={edges}
              selectedId={selectedId}
              searchTerm={controls.searchTerm}
              nodeSize={controls.nodeSize}
              linkStrength={controls.linkStrength}
              centerForce={controls.centerForce}
              repelForce={controls.repelForce}
              onNodeClick={handleNodeClick}
            />
          ) : (
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                background: '#111',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              }}
            >
              <div
                style={{
                  width: 'min(680px, 100%)',
                  border: '1px solid rgba(248,197,55,0.24)',
                  borderRadius: 8,
                  background: '#171717',
                  padding: 18,
                  boxShadow: '0 18px 60px rgba(0,0,0,0.28)',
                }}
              >
                <div style={{ fontSize: 13, color: '#f8c537', fontWeight: 700, marginBottom: 6 }}>OpenCrab Cloud Connection</div>
                <div style={{ fontSize: 12, lineHeight: 1.55, color: '#bdae93', marginBottom: 14 }}>
                  opencrab.sh login runs in your system browser. Browser cookies are not shared with the desktop app, so connect the app with your OpenCrab MCP URL after login.
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <button className="btn-gold" style={{ fontSize: 11, padding: '7px 10px' }} onClick={handleCloudLogin} disabled={cloudBusy}>
                    Login in Browser
                  </button>
                  <button className="btn-gold" style={{ fontSize: 11, padding: '7px 10px' }} onClick={() => handleOpenCloud()}>
                    Open opencrab.sh
                  </button>
                  <button className="btn-gold" style={{ fontSize: 11, padding: '7px 10px' }} onClick={handleSaveCloudMcpUrlFromClipboard} disabled={cloudBusy}>
                    Connect Copied MCP URL
                  </button>
                </div>

                <div style={{ fontSize: 10, color: '#555', marginBottom: 4, letterSpacing: '0.06em' }}>MCP ENDPOINT</div>
                <div style={{ color: desktopStatus?.mcpUrlConfigured ? '#8ec07c' : '#fb4934', fontSize: 11, wordBreak: 'break-all', marginBottom: 10 }}>
                  {desktopStatus?.mcpUrlConfigured ? desktopStatus.mcpUrl : 'not connected'}
                </div>
                <div style={{ color: desktopStatus?.mcpIngestAvailable ? '#8ec07c' : '#fb4934', fontSize: 10, marginBottom: 10 }}>
                  tools: {desktopStatus?.mcpToolsCount ?? 0} · ingest: {desktopStatus?.mcpIngestAvailable ? 'ready' : 'missing'}
                </div>

                <input
                  className="input-dark mono"
                  value={cloudMcpUrl}
                  onChange={(event) => setCloudMcpUrl(event.target.value)}
                  placeholder="Paste https://opencrab.sh/api/mcp/..."
                  type="password"
                  style={{ fontSize: 11, marginBottom: 6 }}
                />
                <input
                  className="input-dark mono"
                  value={cloudApiKey}
                  onChange={(event) => setCloudApiKey(event.target.value)}
                  placeholder="Bearer token (optional)"
                  type="password"
                  style={{ fontSize: 11, marginBottom: 10 }}
                />
                <button className="btn-gold" style={{ width: '100%', marginBottom: 10 }} onClick={handleSaveCloudMcpUrl} disabled={cloudBusy || !cloudMcpUrl.trim()}>
                  Save MCP URL
                </button>

                {cloudMessage && (
                  <div style={{ color: cloudMessage.startsWith('Error') ? '#fb4934' : '#8ec07c', fontSize: 11, lineHeight: 1.45 }}>
                    {cloudMessage}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {workspaceTab === 'graph' && (
          <div
            style={{
              position: 'absolute',
              top: 50,
              right: 10,
              zIndex: 10,
              background: 'rgba(17,17,17,0.85)',
              border: '1px solid rgba(248,197,55,0.15)',
              borderRadius: 6,
              padding: '8px 12px',
            }}
          >
            {[
              ['Landscape', '#5ea85b'],
              ['AI', '#e38b2c'],
              ['Alex', '#d97ab5'],
              ['Fallback', '#7c6f64'],
            ].map(([label, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: 10, color: '#bdae93' }}>{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <RightPanel
        selectedNode={selectedNode}
        controls={controls}
        onControlChange={handleControlChange}
        apiKey={apiKey}
        onRefresh={fetchData}
      />

      {showIngest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setShowIngest(false)}
        >
          <div
            style={{
              background: '#1a1a1a',
              border: '1px solid rgba(248,197,55,0.3)',
              borderRadius: 8,
              padding: 24,
              width: 480,
              maxWidth: '90vw',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ color: '#f8c537', fontWeight: 700, marginBottom: 16 }}>Ingest Data</div>
            <p style={{ color: '#7c6f64', fontSize: 12, marginBottom: 16 }}>
              Use the ingest tab on the right panel to connect an external source and populate the graph.
            </p>
            <button className="btn-gold" onClick={() => setShowIngest(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
