'use client'

import { useState } from 'react'
import type { OcNode } from '../lib/api'

const PARA_FOLDERS = [
  { key: '00_Inbox', label: '00_Inbox', icon: 'IN' },
  { key: '01_Projects', label: '01_Projects', icon: 'PR' },
  { key: '02_Areas', label: '02_Areas', icon: 'AR' },
  { key: '03_Resources', label: '03_Resources', icon: 'RS' },
  { key: '04_Outputs', label: '04_Outputs', icon: 'OU' },
  { key: '05_System', label: '05_System', icon: 'SY' },
  { key: 'Daily Notes', label: 'Daily Notes', icon: 'DN' },
  { key: '99_Archive', label: '99_Archive', icon: 'AZ' },
]

const SPACE_DOT: Record<string, string> = {
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

interface Props {
  nodes: OcNode[]
  selectedId: string | null
  onNodeSelect: (id: string) => void
  onIngestClick: () => void
  connected: boolean
  apiKey: string
  onApiKeyChange: (key: string) => void
}

export default function FileExplorer({
  nodes,
  selectedId,
  onNodeSelect,
  onIngestClick,
  connected,
  apiKey,
  onApiKeyChange,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '03_Resources': true })
  const [showKey, setShowKey] = useState(false)

  function nodesForFolder(folderKey: string): OcNode[] {
    return nodes.filter((node) => {
      const source = (node.properties?.source_id as string) || (node.properties?.folder as string) || ''
      return source.includes(folderKey) || node.space === folderKey.toLowerCase().replace(/\d+_/, '')
    })
  }

  const spaceGroups: Record<string, OcNode[]> = {}
  nodes.forEach((node) => {
    if (!spaceGroups[node.space]) spaceGroups[node.space] = []
    spaceGroups[node.space].push(node)
  })

  function toggle(key: string) {
    setExpanded((previous) => ({ ...previous, [key]: !previous[key] }))
  }

  return (
    <div
      style={{
        width: 260,
        minWidth: 260,
        background: '#1a1a1a',
        borderRight: '1px solid rgba(248,197,55,0.15)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid rgba(248,197,55,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#f8c537', fontWeight: 700, fontSize: 13, letterSpacing: '0.05em' }}>
            OPENCRAB
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: connected ? '#8ec07c' : '#fb4934',
                boxShadow: connected ? '0 0 6px #8ec07c' : 'none',
              }}
            />
            <span style={{ fontSize: 10, color: '#7c6f64' }}>{connected ? 'connected' : 'offline'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#7c6f64' }}>Key</span>
          <input
            type={showKey ? 'text' : 'password'}
            className="input-dark mono"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder="API key"
            style={{ fontSize: 11, padding: '4px 8px' }}
          />
          <button
            onClick={() => setShowKey((previous) => !previous)}
            style={{
              background: 'none',
              border: 'none',
              color: '#7c6f64',
              cursor: 'pointer',
              fontSize: 12,
              padding: '0 2px',
            }}
          >
            {showKey ? 'hide' : 'show'}
          </button>
        </div>
      </div>

      <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(248,197,55,0.12)' }}>
        <button className="btn-gold" style={{ width: '100%', fontSize: 12 }} onClick={onIngestClick}>
          + Ingest
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {PARA_FOLDERS.map((folder) => {
          const folderNodes = nodesForFolder(folder.key)
          const isExpanded = expanded[folder.key]
          return (
            <div key={folder.key}>
              <div
                onClick={() => toggle(folder.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 14px',
                  cursor: 'pointer',
                  color: '#bdae93',
                  fontSize: 12,
                  userSelect: 'none',
                }}
                onMouseEnter={(event) => (event.currentTarget.style.background = '#252525')}
                onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 10, color: '#555', width: 10 }}>{isExpanded ? 'v' : '>'}</span>
                <span style={{ fontSize: 10, color: '#7c6f64', width: 18 }}>{folder.icon}</span>
                <span style={{ flex: 1 }}>{folder.label}</span>
                {folderNodes.length > 0 && (
                  <span className="badge" style={{ fontSize: 10 }}>
                    {folderNodes.length}
                  </span>
                )}
              </div>
              {isExpanded && (
                <div>
                  {folderNodes.length === 0 ? (
                    <div style={{ padding: '2px 14px 2px 36px', fontSize: 11, color: '#555' }}>Empty</div>
                  ) : (
                    folderNodes.map((node) => (
                      <div
                        key={node.id}
                        onClick={() => onNodeSelect(node.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 14px 3px 36px',
                          cursor: 'pointer',
                          background: selectedId === node.id ? 'rgba(248,197,55,0.1)' : 'transparent',
                          fontSize: 11,
                          color: selectedId === node.id ? '#f8c537' : '#bdae93',
                        }}
                        onMouseEnter={(event) => {
                          if (selectedId !== node.id) event.currentTarget.style.background = '#252525'
                        }}
                        onMouseLeave={(event) => {
                          if (selectedId !== node.id) event.currentTarget.style.background = 'transparent'
                        }}
                      >
                        <div
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: SPACE_DOT[node.space] ?? '#666',
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {node.id}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}

        <div style={{ margin: '8px 14px 4px', borderTop: '1px solid rgba(248,197,55,0.1)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', marginBottom: 4 }}>ALL SPACES</div>
        </div>
        {Object.entries(spaceGroups).map(([space, spaceNodes]) => (
          <div key={space}>
            <div
              onClick={() => toggle(`space_${space}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 14px',
                cursor: 'pointer',
                color: '#bdae93',
                fontSize: 11,
                userSelect: 'none',
              }}
              onMouseEnter={(event) => (event.currentTarget.style.background = '#252525')}
              onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: SPACE_DOT[space] ?? '#666',
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, color: SPACE_DOT[space] ?? '#bdae93' }}>{space}</span>
              <span className="badge" style={{ fontSize: 10 }}>
                {spaceNodes.length}
              </span>
            </div>
            {expanded[`space_${space}`] &&
              spaceNodes.map((node) => (
                <div
                  key={node.id}
                  onClick={() => onNodeSelect(node.id)}
                  style={{
                    padding: '2px 14px 2px 32px',
                    cursor: 'pointer',
                    fontSize: 10,
                    color: selectedId === node.id ? '#f8c537' : '#7c6f64',
                    background: selectedId === node.id ? 'rgba(248,197,55,0.08)' : 'transparent',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.id}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
