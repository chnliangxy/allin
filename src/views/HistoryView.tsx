import { useEffect, useState } from 'react'
import type { GameConfig, GameState, Session } from '../poker/engine'
import type { SummaryRow } from './SessionSummaryView'

type HistoryFile = { name: string; mtimeMs: number; size: number }

type HistoryRecord = {
  version: number
  session: Session
  config: GameConfig
  players: SummaryRow[]
  snapshot: GameState
}

function HistoryView() {
  const [files, setFiles] = useState<HistoryFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<HistoryRecord | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/history')
        const data = (await res.json()) as unknown
        if (
          !res.ok ||
          typeof data !== 'object' ||
          data === null ||
          !('files' in data) ||
          !Array.isArray((data as { files?: unknown }).files)
        ) {
          if (!cancelled) setError('读取历史记录失败')
          return
        }
        const next = (data as { files: unknown[] }).files
          .map((f) => {
            if (typeof f !== 'object' || f === null) return null
            const r = f as { name?: unknown; mtimeMs?: unknown; size?: unknown }
            if (typeof r.name !== 'string' || typeof r.mtimeMs !== 'number' || typeof r.size !== 'number') return null
            return { name: r.name, mtimeMs: r.mtimeMs, size: r.size }
          })
          .filter((v): v is HistoryFile => !!v)
        if (!cancelled) setFiles(next)
      } catch {
        if (!cancelled) setError('读取历史记录失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const openFile = async (name: string) => {
    setSelected(null)
    setSelectedName(name)
    setError(null)
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(name)}`)
      const data = (await res.json()) as unknown
      if (!res.ok) {
        setError('读取文件失败')
        return
      }
      if (typeof data !== 'object' || data === null) {
        setError('文件格式无效')
        return
      }
      setSelected(data as HistoryRecord)
    } catch {
      setError('读取文件失败')
    }
  }

  return (
    <div className="panel">
      <div className="panel-title">历史记录</div>
      <div className="actions">
        <button onClick={() => window.location.reload()} disabled={loading}>
          刷新
        </button>
      </div>

      {loading ? <div className="banner">加载中…</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      <div className="history">
        <div className="history-list">
          {files.length === 0 && !loading ? <div className="banner">暂无历史记录</div> : null}
          {files.map((f) => (
            <button
              key={f.name}
              className={selectedName === f.name ? 'history-item active' : 'history-item'}
              onClick={() => void openFile(f.name)}
            >
              <div className="history-name">{f.name}</div>
              <div className="history-meta">
                {new Date(f.mtimeMs).toLocaleString()} · {f.size}B
              </div>
            </button>
          ))}
        </div>

        <div className="history-detail">
          {selected ? (
            <>
              <div className="panel-title">详情</div>
              <div className="home-meta">
                <div className="label">开始时间</div>
                <div className="value">{new Date(selected.session.startedAt).toLocaleString()}</div>
                <div className="label">结束时间</div>
                <div className="value">
                  {selected.session.endedAt ? new Date(selected.session.endedAt).toLocaleString() : '—'}
                </div>
                <div className="label">盲注</div>
                <div className="value">
                  {selected.config.smallBlind}/{selected.config.bigBlind}（前注 {selected.config.ante}）
                </div>
              </div>

              <div className="summary-table">
                <div className="summary-head">
                  <div>玩家</div>
                  <div>初始</div>
                  <div>补码</div>
                  <div>最终</div>
                  <div>净值</div>
                </div>
                {selected.players.map((r) => (
                  <div key={r.seat} className="summary-row">
                    <div>
                      #{r.seat + 1} {r.name}
                    </div>
                    <div>{r.initial}</div>
                    <div>{r.rebuy}</div>
                    <div>{r.final}</div>
                    <div className={r.net >= 0 ? 'net pos' : 'net neg'}>{r.net}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="banner">选择一条记录查看详情</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default HistoryView

