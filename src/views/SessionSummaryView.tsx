import type { GameState } from '../poker/engine'
import type { SaveStatus } from '../uiTypes'

type SummaryRow = {
  seat: number
  name: string
  initial: number
  rebuy: number
  final: number
  net: number
}

type Props = {
  state: GameState
  rows: SummaryRow[]
  saveStatus: SaveStatus
  savedFileName: string | null
  onStartNew: () => void
  onSave: () => void
}

function SessionSummaryView(props: Props) {
  const session = props.state.session

  return (
    <div className="panel">
      <div className="panel-title">积分汇总</div>

      {session ? (
        <div className="home-meta">
          <div className="label">本局ID</div>
          <div className="value">{session.id}</div>
          <div className="label">开始时间</div>
          <div className="value">{new Date(session.startedAt).toLocaleString()}</div>
          {session.endedAt ? (
            <>
              <div className="label">结束时间</div>
              <div className="value">{new Date(session.endedAt).toLocaleString()}</div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="summary-table">
        <div className="summary-head">
          <div>玩家</div>
          <div>初始</div>
          <div>补码</div>
          <div>最终</div>
          <div>净值</div>
        </div>
        {props.rows.map((r) => (
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

      <div className="actions">
        <button className="primary" onClick={props.onStartNew}>
          开始新一局游戏
        </button>
        <button onClick={props.onSave} disabled={props.saveStatus === 'saving'}>
          {props.saveStatus === 'saving' ? '保存中…' : '保存到历史'}
        </button>
      </div>

      {props.saveStatus === 'saved' ? (
        <div className="banner">已保存：{props.savedFileName ?? ''}</div>
      ) : props.saveStatus === 'error' ? (
        <div className="banner error">保存失败</div>
      ) : null}
    </div>
  )
}

export type { SummaryRow }
export default SessionSummaryView

